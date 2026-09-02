-- Migration 002: Document RAG Schema & Tenant Isolation
-- Support for secure document uploads (.pdf, .docx, .txt, .md) and vector search

-- 1. Documents Metadata Table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'indexed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Document Chunks Storage Table
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  page_number INTEGER,
  section TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding VECTOR(384) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tenant & Document Scoping Indexes
CREATE INDEX IF NOT EXISTS idx_documents_tenant_user ON documents(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant_doc ON document_chunks(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- 4. HNSW Vector Index for Document Embeddings
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops);
