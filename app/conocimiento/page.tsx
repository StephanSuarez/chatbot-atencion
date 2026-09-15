import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPendingChunks, listDocuments, listEntries, MAX_DOCUMENTS, MAX_FILE_BYTES } from "../../lib/kb/service";
import { Tabs } from "../tabs";
import { KnowledgeView } from "./knowledge-view";

export default async function Page() {
  // La base de conocimiento se lee en cada request, no al compilar.
  await connection();
  const [entries, documents, pending, config] = await Promise.all([
    listEntries(),
    listDocuments(),
    countPendingChunks(),
    getConfig(),
  ]);

  return (
    <>
      <Tabs active="conocimiento" />
      <KnowledgeView
        entries={entries}
        documents={documents}
        pending={pending}
        hasKey={config.apiKeyMask !== null}
        maxDocuments={MAX_DOCUMENTS}
        maxFileBytes={MAX_FILE_BYTES}
      />
    </>
  );
}
