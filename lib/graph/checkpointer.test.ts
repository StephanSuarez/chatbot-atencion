// Integración: el checkpointer contra la base de tests, y un grafo real que falla y se reanuda sobre Postgres.
import type { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { emptyCheckpoint, type CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "../db";
import { DbSaver } from "./checkpointer";

const saver = new DbSaver();
const thread = (id: string, checkpointId?: string) => ({ configurable: { thread_id: id, checkpoint_ns: "", checkpoint_id: checkpointId } });
const checkpoint = (id: string, values: Record<string, unknown>) => ({ ...emptyCheckpoint(), id, channel_values: values });
const metadata = (step: number): CheckpointMetadata => ({ source: "loop", step, parents: {} });

const listAll = async (config: Parameters<typeof saver.list>[0], options?: Parameters<typeof saver.list>[1]) => {
  const ids: string[] = [];
  for await (const tuple of saver.list(config, options)) ids.push(tuple.checkpoint.id);
  return ids;
};

beforeEach(async () => {
  await sql`delete from graph_checkpoint_writes`;
  await sql`delete from graph_checkpoints`;
});

describe("guardar y leer", () => {
  it("devuelve el último checkpoint del hilo, con su padre, o uno concreto por id", async () => {
    const first = await saver.put(thread("t1"), checkpoint("0001", { n: 1 }), metadata(0));
    await saver.put(first, checkpoint("0002", { n: 2, texto: "hola" }), metadata(1));

    const latest = await saver.getTuple(thread("t1"));
    expect(latest?.checkpoint.channel_values).toEqual({ n: 2, texto: "hola" });
    expect(latest?.metadata).toEqual(metadata(1));
    expect(latest?.config.configurable?.checkpoint_id).toBe("0002");
    expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe("0001");

    const older = await saver.getTuple(thread("t1", "0001"));
    expect(older?.checkpoint.channel_values).toEqual({ n: 1 });
    expect(older?.parentConfig).toBeUndefined();
  });

  it("sin hilo no hay checkpoint, y sin thread_id no se guarda", async () => {
    expect(await saver.getTuple(thread("nadie"))).toBeUndefined();
    expect(await saver.getTuple({ configurable: {} })).toBeUndefined();
    await expect(saver.put({ configurable: {} }, checkpoint("x", {}), metadata(0))).rejects.toThrow(/thread_id/);
  });

  it("volver a guardar el mismo checkpoint lo reemplaza", async () => {
    await saver.put(thread("t1"), checkpoint("0001", { n: 1 }), metadata(0));
    await saver.put(thread("t1"), checkpoint("0001", { n: 99 }), metadata(0));
    expect((await saver.getTuple(thread("t1")))?.checkpoint.channel_values).toEqual({ n: 99 });
  });

  it("los valores JSON anidados vuelven iguales; una fecha vuelve como texto (el estado no lleva Date)", async () => {
    const values = { lista: [{ a: 1 }, "b", null], anidado: { ok: true, n: 1.5 }, cuando: new Date("2026-09-22T10:00:00Z") };
    await saver.put(thread("t1"), checkpoint("0001", values), metadata(0));
    const loaded = (await saver.getTuple(thread("t1")))?.checkpoint.channel_values;
    expect(loaded).toEqual({ ...values, cuando: "2026-09-22T10:00:00.000Z" });
  });
});

describe("escrituras pendientes", () => {
  it("se leen con su checkpoint; una escritura normal no se pisa y una especial sí", async () => {
    const config = await saver.put(thread("t1"), checkpoint("0001", {}), metadata(0));
    await saver.putWrites(config, [["canal", { v: 1 }], ["otro", "a"]], "tarea-1");
    await saver.putWrites(config, [["canal", { v: 2 }]], "tarea-1");
    await saver.putWrites(config, [["__error__", "primero"]], "tarea-1");
    await saver.putWrites(config, [["__error__", "segundo"]], "tarea-1");

    const { pendingWrites } = (await saver.getTuple(thread("t1")))!;
    expect(pendingWrites).toEqual([
      ["tarea-1", "__error__", "segundo"],
      ["tarea-1", "canal", { v: 1 }],
      ["tarea-1", "otro", "a"],
    ]);
  });

  it("sin checkpoint_id no se pueden guardar", async () => {
    await expect(saver.putWrites(thread("t1"), [["canal", 1]], "tarea")).rejects.toThrow(/checkpoint_id/);
  });
});

describe("listar y borrar", () => {
  it("lista del más reciente al más antiguo, con límite, before y filtro por metadatos", async () => {
    let config: RunnableConfig = thread("t1");
    for (const [id, step] of [["0001", 0], ["0002", 1], ["0003", 2]] as const) {
      config = await saver.put(config, checkpoint(id, { step }), metadata(step));
    }
    await saver.put(thread("t2"), checkpoint("0009", {}), metadata(0));

    expect(await listAll(thread("t1"))).toEqual(["0003", "0002", "0001"]);
    expect(await listAll(thread("t1"), { limit: 2 })).toEqual(["0003", "0002"]);
    expect(await listAll(thread("t1"), { before: thread("t1", "0003") })).toEqual(["0002", "0001"]);
    expect(await listAll(thread("t1"), { filter: { step: 1 } })).toEqual(["0002"]);
    expect(await listAll({ configurable: {} })).toEqual(["0003", "0002", "0001", "0009"]);
  });

  it("borrar el hilo elimina sus checkpoints y escrituras, y no los de otros", async () => {
    const config = await saver.put(thread("t1"), checkpoint("0001", {}), metadata(0));
    await saver.putWrites(config, [["canal", 1]], "tarea");
    await saver.put(thread("t2"), checkpoint("0001", {}), metadata(0));

    await saver.deleteThread("t1");

    expect(await saver.getTuple(thread("t1"))).toBeUndefined();
    expect(await saver.getTuple(thread("t2"))).toBeDefined();
    const [{ n }] = await sql`select count(*)::int as n from graph_checkpoint_writes`;
    expect(n).toBe(0);
  });
});

describe("un grafo real sobre Postgres", () => {
  const State = Annotation.Root({
    n: Annotation<number>,
    log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  });

  it("un turno que falla en un nodo se reanuda desde el último checkpoint, sin repetir los anteriores", async () => {
    const runs = { a: 0, b: 0, c: 0 };
    let failOnce = true;
    const graph = new StateGraph(State)
      .addNode("a", (state) => ({ n: state.n + 1, log: [`a:${++runs.a}`] }))
      .addNode("b", (state) => {
        runs.b++;
        if (failOnce) {
          failOnce = false;
          throw new Error("el proveedor no respondió");
        }
        return { n: state.n * 10, log: ["b"] };
      })
      .addNode("c", () => ({ log: [`c:${++runs.c}`] }))
      .addEdge(START, "a")
      .addConditionalEdges("a", (state) => (state.n > 100 ? "c" : "b"))
      .addEdge("b", "c")
      .addEdge("c", END)
      .compile({ checkpointer: saver });
    const config = thread("mensaje-1");

    await expect(graph.invoke({ n: 1 }, config)).rejects.toThrow("no respondió");
    const paused = await graph.getState(config);
    expect(paused.values).toEqual({ n: 2, log: ["a:1"] });
    expect(paused.next).toEqual(["b"]);

    const result = await graph.invoke(null, config);
    expect(result).toEqual({ n: 20, log: ["a:1", "b", "c:1"] });
    expect(runs).toEqual({ a: 1, b: 2, c: 1 });
    expect((await graph.getState(config)).next).toEqual([]);
  });
});
