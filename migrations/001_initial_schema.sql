-- Migration 001: Initial Schema & HNSW Vector Indexing
-- Created for GraphRAG + pgvector Persistent Storage

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Repository Indexing Metadata Table
CREATE TABLE IF NOT EXISTS repository_status (
  repository TEXT PRIMARY KEY,
  repository_hash TEXT NOT NULL,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Code Chunks Storage Table
CREATE TABLE IF NOT EXISTS code_chunks (
  id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  file_path TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  name TEXT,
  language TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(384) NOT NULL,
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. B-Tree Metadata Indexes
CREATE INDEX IF NOT EXISTS idx_code_chunks_repository ON code_chunks(repository);
CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path ON code_chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_chunk_type ON code_chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_code_chunks_language ON code_chunks(language);

-- 5. GIN Metadata JSONB Index
CREATE INDEX IF NOT EXISTS idx_code_chunks_metadata ON code_chunks USING GIN(metadata);

-- 6. HNSW Cosine Vector Distance Index
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding_hnsw ON code_chunks USING hnsw (embedding vector_cosine_ops);
