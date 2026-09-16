import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPending } from "../../lib/conversations/service";
import { countPendingChunks, listDocuments, listEntries, MAX_DOCUMENTS, MAX_FILE_BYTES } from "../../lib/kb/service";
import { listPendingProposals } from "../../lib/learning/service";
import { Tabs } from "../tabs";
import { KnowledgeView } from "./knowledge-view";

export default async function Page() {
  // La base de conocimiento se lee en cada request, no al compilar.
  await connection();
  const [entries, documents, pending, config, waiting, proposals] = await Promise.all([
    listEntries(),
    listDocuments(),
    countPendingChunks(),
    getConfig(),
    countPending(),
    listPendingProposals(),
  ]);

  return (
    <>
      <Tabs active="conocimiento" pending={waiting} />
      <KnowledgeView
        entries={entries}
        documents={documents}
        proposals={proposals}
        pending={pending}
        hasKey={config.apiKeyMask !== null}
        maxDocuments={MAX_DOCUMENTS}
        maxFileBytes={MAX_FILE_BYTES}
      />
    </>
  );
}
