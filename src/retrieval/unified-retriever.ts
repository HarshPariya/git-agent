import type { RetrievalRequest, RetrievalResult, Retriever } from "./types.js";
import { CodeRetriever } from "./retriever.js";
import { DocumentRetriever } from "./document-retriever.js";
import { logger } from "../logging/logger.js";

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
      try {
        docResults = await this.documentRetriever.search({
          query: request.query,
          tenantId,
          ...(request.documentIds !== undefined && { documentIds: request.documentIds }),
          limit: request.limit ?? 10,
        });
      } catch (error) {
        logger.error("Document retrieval failed", {
          operation: "retrieval.unified.document",
          metadata: {
            tenantId,
            query: request.query,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        docResults = [];
      }
    } else if (effectiveMode === "code") {
      // CODE mode: code vector + GraphRAG search ONLY. Zero document search.
      try {
        codeResults = await this.codeRetriever.search({
          query: request.query,
          limit: request.limit ?? 10,
        });
      } catch (error) {
        logger.error("Code retrieval failed", {
          operation: "retrieval.unified.code",
          metadata: {
            query: request.query,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        codeResults = [];
      }
    } else if (effectiveMode === "mixed") {
      // MIXED mode: both code and document retrieval.
      const [crResult, drResult] = await Promise.allSettled([
        this.codeRetriever.search({
          query: request.query,
          limit: request.limit ?? 10,
        }),
        this.documentRetriever.search({
          query: request.query,
          tenantId,
          ...(request.documentIds !== undefined && { documentIds: request.documentIds }),
          limit: request.limit ?? 10,
        }),
      ]);

      if (crResult.status === "fulfilled") {
        codeResults = crResult.value;
      } else {
        logger.error("Code retrieval failed in mixed mode", {
          operation: "retrieval.unified.code",
          metadata: {
            query: request.query,
            error: crResult.reason instanceof Error ? crResult.reason.message : String(crResult.reason),
          },
        });
      }

      if (drResult.status === "fulfilled") {
        docResults = drResult.value;
      } else {
        logger.error("Document retrieval failed in mixed mode", {
          operation: "retrieval.unified.document",
          metadata: {
            tenantId,
            query: request.query,
            error: drResult.reason instanceof Error ? drResult.reason.message : String(drResult.reason),
          },
        });
      }
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
