export interface RetrievalRequest {
  readonly query: string;
  readonly tenantId?: string;
  readonly limit?: number;
  readonly documentIds?: readonly string[] | undefined;
  readonly mode?: "code" | "document" | "mixed" | "general" | "system" | undefined;
}

export interface RetrievalResult {
  readonly content: string;
  readonly source: string;
  readonly page?: number;
  readonly score: number;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly sourceType?: "code" | "document" | undefined;
}

export interface Retriever {
  search(request: RetrievalRequest): Promise<readonly RetrievalResult[]>;
}
