-- Migration: 003_user_insights.sql
-- Description: Create user_insights table for long-term conversation learning & preference persistence

CREATE TABLE IF NOT EXISTS user_insights (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('preference', 'fact', 'guideline')),
  topic TEXT NOT NULL,
  insight TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_insights_unique_topic UNIQUE (tenant_id, user_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_user_insights_tenant_user ON user_insights (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_insights_category ON user_insights (category);
