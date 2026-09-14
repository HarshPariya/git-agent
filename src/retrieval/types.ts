export interface RetrievalRequest {
  readonly query: string;
  readonly tenantId?: string;
  readonly limit?: number;
  readonly mode?: "code" | "general" | "system";
}

export interface RetrievalResult {
  readonly content: string;
  readonly source: string;
  readonly page?: number;
  readonly score: number;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly sourceType?: "code";
}

export type SymbolReferenceKind = "definition" | "call" | "import" | "reference";

export interface SymbolReferenceEvidence {
  readonly symbol: string;
  readonly kind: SymbolReferenceKind;
  readonly source: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

export interface SymbolReferenceReport {
  readonly symbol: string;
  readonly definitions: readonly SymbolReferenceEvidence[];
  readonly references: readonly SymbolReferenceEvidence[];
}

export interface Retriever {
  search(request: RetrievalRequest): Promise<readonly RetrievalResult[]>;
  findSymbolReferences?(symbol: string): Promise<SymbolReferenceReport>;
}
