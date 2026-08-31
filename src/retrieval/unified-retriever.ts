import type { RetrievalRequest, RetrievalResult, Retriever } from "./types.js";
import { CodeRetriever } from "./retriever.js";
import { DocumentRetriever } from "./document-retriever.js";

export interface UnifiedRetrievalRequest extends RetrievalRequest {
  readonly tenantId: string;
  readonly documentIds?: readonly string[] | undefined;
  readonly mode?: "code" | "document" | "mixed" | "general" | "system" | undefined;
}

export interface UnifiedRetrievalResult extends RetrievalResult {
  readonly sourceType: "code" | "document";
  readonly documentId?: string | undefined;
  readonly pageNumber?: number | undefined;
}

export class UnifiedRetriever implements Retriever {
  private readonly codeRetriever: CodeRetriever;
  private readonly documentRetriever: DocumentRetriever;

  constructor(codeRetriever: CodeRetriever) {
    this.codeRetriever = codeRetriever;
    this.documentRetriever = new DocumentRetriever();
  }

  async search(request: UnifiedRetrievalRequest): Promise<readonly UnifiedRetrievalResult[]> {
    const tenantId = request.tenantId || "default-tenant";
    const effectiveMode = request.mode ?? (request.documentIds && request.documentIds.length > 0 ? "document" : "general");
    const results: UnifiedRetrievalResult[] = [];

    let codeResults: readonly any[] = [];
    let docResults: readonly any[] = [];

    if (effectiveMode === "document") {
      // DOCUMENT mode: document vector/hybrid retrieval ONLY. Zero code candidates, zero GraphRAG.
      docResults = await this.documentRetriever
        .search({
          query: request.query,
          tenantId,
          ...(request.documentIds !== undefined && { documentIds: request.documentIds }),
          limit: request.limit ?? 10,
        })
        .catch(() => []);
    } else if (effectiveMode === "code") {
      // CODE mode: code vector + GraphRAG search ONLY. Zero document search.
      codeResults = await this.codeRetriever
        .search({
          query: request.query,
          limit: request.limit ?? 10,
        })
        .catch(() => []);
    } else if (effectiveMode === "mixed") {
      // MIXED mode: both code and document retrieval.
      const [cr, dr] = await Promise.all([
        this.codeRetriever
          .search({
            query: request.query,
            limit: request.limit ?? 10,
          })
          .catch(() => []),
        this.documentRetriever
          .search({
            query: request.query,
            tenantId,
            ...(request.documentIds !== undefined && { documentIds: request.documentIds }),
            limit: request.limit ?? 10,
          })
          .catch(() => []),
      ]);
      codeResults = cr;
      docResults = dr;
    } else {
      // GENERAL / SYSTEM mode has no repository or uploaded-document evidence.
      codeResults = [];
      docResults = [];
    }

    for (const r of codeResults) {
      results.push({
        content: r.content,
        source: r.source,
        score: r.score,
        sourceType: "code",
        ...(r.metadata !== undefined && { metadata: r.metadata }),
      });
    }

    for (const r of docResults) {
      results.push({
        content: r.content,
        source: r.filename,
        score: r.score,
        sourceType: "document",
        documentId: r.documentId,
        ...(r.pageNumber !== undefined && { pageNumber: r.pageNumber }),
        metadata: {
          pageNumber: String(r.pageNumber ?? 1),
          section: r.section ?? "",
        },
      });
    }

    // Sort by highest similarity score
    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
