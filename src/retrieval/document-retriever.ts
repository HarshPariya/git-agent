import { embedText } from "../ingestion/embedder.js";
import { query as dbQuery } from "../db/postgres.js";
import { rerankResults } from "./reranker.js";
import { inMemoryDocumentStore } from "../ingestion/document-indexer.js";

export interface DocumentSearchRequest {
  readonly query: string;
  readonly tenantId: string;
  readonly documentIds?: readonly string[] | undefined;
  readonly limit?: number | undefined;
}

export interface DocumentSearchResult {
  readonly id: string;
  readonly documentId: string;
  readonly filename: string;
  readonly pageNumber?: number | undefined;
  readonly section?: string | undefined;
  readonly content: string;
  readonly score: number;
}

const SUMMARY_PATTERNS = [
  "what is in document",
  "what is in this document",
  "what is this document about",
  "what is in the pdf",
  "what is this pdf about",
  "summarize",
  "summary",
  "overview",
  "what does this document contain",
  "describe the document",
  "contents of",
  "what is in pdf",
  "what is in doc",
];

const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "can", "does", "for", "from", "has", "in",
  "is", "it", "of", "on", "please", "the", "this", "to", "what", "where",
  "which", "who", "why", "with", "document", "pdf", "docx", "file",
]);

/** Pick a useful lexical probe instead of words such as "what" or "the". */
export function getDocumentSearchKeyword(searchQuery: string): string {
  const words = searchQuery
    .toLowerCase()
    .match(/[a-z0-9_$-]+/g) ?? [];
  const keyword = words.find((word) => word.length > 2 && !QUERY_STOP_WORDS.has(word)) ?? "";

  // File/module questions are commonly phrased in the plural ("where are agents")
  // while the document contains a singular path such as agent.py.
  if (keyword.length > 4 && keyword.endsWith("s") && !keyword.endsWith("ss")) {
    return keyword.slice(0, -1);
  }

  return keyword;
}

export function extractDocumentSearchTerms(searchQuery: string): string[] {
  const rawTerms = searchQuery.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|[a-z0-9_$-]+/g) ?? [];
  const terms = rawTerms.filter(
    (term) => !QUERY_STOP_WORDS.has(term) && (term.length >= 2 || /^\d+$/.test(term)),
  );
  return [...new Set(terms.flatMap((term) =>
    term.length > 4 && term.endsWith("s") && !term.endsWith("ss")
      ? [term, term.slice(0, -1)]
      : [term],
  ))];
}

function containsExactTerm(content: string, term: string): boolean {
  if (/^[a-z]+$/i.test(term)) {
    // OCR commonly joins adjacent column text (for example RISHABH + BHAI).
    return content.toLowerCase().includes(term.toLowerCase());
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(content);
}

function lexicalScore(content: string, terms: readonly string[]): number {
  return terms.reduce((score, term) => {
    if (!containsExactTerm(content, term)) return score;
    if (/^\d+$/.test(term) || term.includes("@")) return score + 0.75;
    return score + (term.length >= 5 ? 0.55 : 0.3);
  }, 0);
}

export function isDocumentSummaryIntent(query: string): boolean {
  const normalized = query.toLowerCase().trim().replace(/[!?.,]/g, "");
  return SUMMARY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function selectRepresentativeRows<T>(rows: readonly T[], limit: number): T[] {
  if (rows.length <= limit) return [...rows];
  if (limit <= 1) return rows[0] === undefined ? [] : [rows[0]];

  const selected: T[] = [];
  const seen = new Set<number>();
  for (let slot = 0; slot < limit; slot++) {
    const index = Math.round((slot * (rows.length - 1)) / (limit - 1));
    if (!seen.has(index) && rows[index] !== undefined) {
      seen.add(index);
      selected.push(rows[index] as T);
    }
  }
  return selected;
}

export class DocumentRetriever {
  async search({
    query,
    tenantId,
    documentIds,
    limit = 10,
  }: DocumentSearchRequest): Promise<readonly DocumentSearchResult[]> {
    if (!tenantId) {
      throw new Error("Tenant ID is required for document retrieval isolation.");
    }

    const isSummary = isDocumentSummaryIntent(query);
    const significantTerms = extractDocumentSearchTerms(query);
    let vectorCandidateCount = 0;
    let lexicalCandidateCount = 0;

    console.log(
      `[RETRIEVER] query="${query}" tenantId=${tenantId} documentIds=${JSON.stringify(documentIds || [])} isSummary=${isSummary}`,
    );

    let dbRows: Array<{
      id: string;
      document_id: string;
      filename: string;
      page_number: number | null;
      section: string | null;
      content: string;
      similarity: number;
    }> = [];

    try {
      if (isSummary) {
        const filterByDocs = documentIds && documentIds.length > 0;
        const summarySql = filterByDocs
          ? `SELECT id, document_id, filename, page_number, section, content,
                    0.95::float AS similarity
             FROM document_chunks
             WHERE tenant_id = $1 AND document_id = ANY($2::text[])
             ORDER BY document_id, chunk_index;`
          : `SELECT id, document_id, filename, page_number, section, content,
                    0.95::float AS similarity
             FROM document_chunks
             WHERE tenant_id = $1
             ORDER BY document_id, chunk_index;`;
        const summaryResult = await dbQuery<{
          id: string;
          document_id: string;
          filename: string;
          page_number: number | null;
          section: string | null;
          content: string;
          similarity: number;
        }>(summarySql, filterByDocs ? [tenantId, documentIds] : [tenantId]);
        dbRows = selectRepresentativeRows(summaryResult.rows, limit);
      } else {
        const queryVector = await embedText(query);
        const vectorStr = `[${queryVector.join(",")}]`;
        const filterByDocs = documentIds && documentIds.length > 0;
        const vectorSql = filterByDocs
          ? `SELECT id, document_id, filename, page_number, section, content,
                    (1 - (embedding <=> $1::vector)) AS similarity
             FROM document_chunks
             WHERE tenant_id = $2 AND document_id = ANY($3::text[])
             ORDER BY (1 - (embedding <=> $1::vector)) DESC LIMIT $4;`
          : `SELECT id, document_id, filename, page_number, section, content,
                    (1 - (embedding <=> $1::vector)) AS similarity
             FROM document_chunks
             WHERE tenant_id = $2
             ORDER BY (1 - (embedding <=> $1::vector)) DESC LIMIT $3;`;
        const vectorParams = filterByDocs
          ? [vectorStr, tenantId, documentIds, limit * 3]
          : [vectorStr, tenantId, limit * 3];
        const vectorResult = await dbQuery<any>(vectorSql, vectorParams);
        vectorCandidateCount = vectorResult.rows.length;

        let lexicalRows: any[] = [];
        if (significantTerms.length > 0) {
          const patterns = significantTerms.map((term) => `%${term}%`);
          const lexicalSql = filterByDocs
            ? `SELECT id, document_id, filename, page_number, section, content, 0::float AS similarity
               FROM document_chunks
               WHERE tenant_id = $1 AND document_id = ANY($2::text[]) AND content ILIKE ANY($3::text[])
               LIMIT $4;`
            : `SELECT id, document_id, filename, page_number, section, content, 0::float AS similarity
               FROM document_chunks
               WHERE tenant_id = $1 AND content ILIKE ANY($2::text[])
               LIMIT $3;`;
          const lexicalResult = await dbQuery<any>(
            lexicalSql,
            filterByDocs ? [tenantId, documentIds, patterns, limit * 4] : [tenantId, patterns, limit * 4],
          );
          lexicalRows = lexicalResult.rows;
          lexicalCandidateCount = lexicalRows.length;
        }

        const merged = new Map<string, any>();
        for (const row of [...vectorResult.rows, ...lexicalRows]) {
          const existing = merged.get(row.id);
          if (!existing || Number(row.similarity) > Number(existing.similarity)) merged.set(row.id, row);
        }
        dbRows = [...merged.values()];
      }
    } catch (err: any) {
      console.warn("⚠️ Postgres document vector search skipped/fallback:", err?.message || err);
    }

    // In-Memory Document Fallback if DB rows empty
    if (dbRows.length === 0 && inMemoryDocumentStore.length > 0) {
      const queryWords = significantTerms;

      for (const doc of inMemoryDocumentStore) {
        if (doc.tenantId !== tenantId) continue;
        if (documentIds && documentIds.length > 0 && !documentIds.includes(doc.id)) continue;

        for (const chunk of doc.chunks) {
          const contentLower = chunk.content.toLowerCase();
          const keywordScore = lexicalScore(contentLower, queryWords);

          if (keywordScore > 0 || queryWords.length === 0 || isSummary) {
            dbRows.push({
              id: chunk.id,
              document_id: chunk.documentId,
              filename: chunk.filename,
              page_number: chunk.pageNumber ?? 1,
              section: chunk.section ?? null,
              content: chunk.content,
              similarity: 0.5,
            });
            lexicalCandidateCount++;
          }
        }
      }
    }

    // SUMMARY INTENT / DOCUMENT SELECTION FALLBACK: Select representative distributed chunks across document
    if ((isSummary || (documentIds && documentIds.length > 0 && dbRows.length === 0)) && inMemoryDocumentStore.length > 0) {
      const selectedDocs = inMemoryDocumentStore.filter(
        (d) => d.tenantId === tenantId && (!documentIds || documentIds.length === 0 || documentIds.includes(d.id)),
      );

      const representativeRows: Array<{
        id: string;
        document_id: string;
        filename: string;
        page_number: number | null;
        section: string | null;
        content: string;
        similarity: number;
      }> = [];

      for (const doc of selectedDocs) {
        const total = doc.chunks.length;
        if (total === 0) continue;

        const countToPick = Math.min(limit, total);
        const selectedChunks = selectRepresentativeRows(doc.chunks, countToPick);

        for (const chunk of selectedChunks) {
          representativeRows.push({
            id: chunk.id,
            document_id: chunk.documentId,
            filename: chunk.filename,
            page_number: chunk.pageNumber ?? 1,
            section: chunk.section ?? `Section ${chunk.chunkIndex + 1}`,
            content: chunk.content,
            similarity: Math.max(0.8, 0.95 - representativeRows.length * 0.02),
          });
        }
      }

      if (representativeRows.length > 0) {
        dbRows = representativeRows;
      }
    }

    if (dbRows.length === 0) {
      return [];
    }

    const rowMap = new Map<string, typeof dbRows[0]>();
    const queryWords = significantTerms;

    const candidateResults = dbRows.map((row) => {
      rowMap.set(row.id, row);
      const contentLower = row.content.toLowerCase();
      const lexicalBonus = lexicalScore(contentLower, queryWords);

      const exactMatchBonus = contentLower.includes(query.toLowerCase().trim()) ? 0.4 : 0;
      const hybridScore = isSummary
        ? Math.max(0.85, row.similarity)
        : row.similarity + lexicalBonus + exactMatchBonus;

      return {
        name: row.filename,
        filePath: row.filename,
        chunk: {
          id: row.id,
          filePath: row.filename,
          language: "unknown" as const,
          type: "file" as const,
          content: row.content,
          startLine: row.page_number ?? 1,
          endLine: row.page_number ?? 1,
          metadata: { fileName: row.filename, directory: "", imports: [], section: row.section ?? "" },
        },
        hybridScore,
        vectorScore: row.similarity,
        graphScore: 0,
        sources: ["vector" as const],
      };
    });

    // Rerank document results
    const reranked = rerankResults(query, candidateResults, { limit });

    console.log(
      `[DOCUMENT HYBRID] query=${JSON.stringify(query)} terms=${JSON.stringify(significantTerms)} vectorCandidates=${vectorCandidateCount} lexicalCandidates=${lexicalCandidateCount} mergedCandidates=${dbRows.length} rerankedCandidates=${reranked.length}`,
    );

    return reranked.map((item) => {
      const row = item.chunk?.id ? rowMap.get(item.chunk.id) : undefined;
      return {
        id: row?.id ?? item.filePath ?? "doc-chunk",
        documentId: row?.document_id ?? "doc-unknown",
        filename: item.filePath ?? "document",
        ...(row?.page_number != null && { pageNumber: row.page_number }),
        ...(row?.section != null && { section: row.section }),
        content: item.chunk?.content ?? "",
        score: item.rerankScore,
      };
    });
  }
}
