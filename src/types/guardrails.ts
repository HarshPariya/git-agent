import type { RetrievalResult } from "../retrieval/types.js";

export interface InputGuardRequest {
  readonly message: string;
}

export interface InputGuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface OutputGuardRequest {
  readonly response: string;
}

export interface OutputGuardResult {
  readonly allowed: boolean;
  readonly response?: string;
  readonly reason?: string;
}

export interface CitationCheckRequest {
  readonly answer: string;
  readonly sources: readonly RetrievalResult[];
}

export interface CitationCheckResult {
  readonly valid: boolean;
  readonly citations: readonly string[];
  readonly reason: string;
}
