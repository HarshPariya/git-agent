export interface RetrievalEvalCase {
  readonly id: string;
  readonly query: string;
  readonly expectedNames: string[];
  readonly description?: string;
}

export const retrievalEvalDataset: readonly RetrievalEvalCase[] = [
  { id: "normalize-id", query: "Where is normalizeId used?", expectedNames: ["normalizeId"] },
  { id: "graph-traversal", query: "How does graph traversal work?", expectedNames: ["traverseGraph", "getNeighbors"] },
  { id: "graph-construction", query: "Where is the code graph built?", expectedNames: ["buildGraph"] },
  { id: "incoming-relationships", query: "How are incoming graph relationships retrieved?", expectedNames: ["getIncoming"] },
  { id: "outgoing-relationships", query: "How are outgoing graph relationships retrieved?", expectedNames: ["getOutgoing"] },
  { id: "entity-search", query: "How do we find graph entities by name?", expectedNames: ["findEntitiesByName"] },
  { id: "entity-extraction", query: "How are code entities extracted?", expectedNames: ["extractEntities", "extractEntitiesFromFile"] },
  { id: "relationship-extraction", query: "How are relationships extracted from source code?", expectedNames: ["extractRelationships", "extractRelationshipsFromFile"] },
  { id: "vector-similarity", query: "How is cosine similarity calculated?", expectedNames: ["cosineSimilarity"] },
  { id: "hybrid-search", query: "How are vector and graph search combined?", expectedNames: ["hybridSearch"] },
  { id: "reranking", query: "How are retrieval results reranked?", expectedNames: ["rerankResults"] },
  { id: "repository-parser", query: "How is the repository parsed?", expectedNames: ["parseRepository", "scanRepository"] },
  { id: "graph-neighbors-nl", query: "Which function walks both incoming and outgoing edges?", expectedNames: ["getNeighbors", "traverseGraph"] },
  { id: "hybrid-fusion-nl", query: "Where do we combine semantic similarity with graph relevance?", expectedNames: ["hybridSearch"] },
  { id: "relationship-resolution-nl", query: "Which function resolves relationships between code entities?", expectedNames: ["extractRelationships", "extractRelationshipsFromFile"] },
  { id: "db-persistence-nl", query: "What code persists embeddings into PostgreSQL?", expectedNames: ["upsertChunks"] },
  { id: "incremental-hash-nl", query: "Which function skips unchanged chunks during re-indexing?", expectedNames: ["upsertChunks"] },
];
