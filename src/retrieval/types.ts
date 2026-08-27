export interface RetrievalRequest {
  readonly query: string;
  readonly tenantId?: string;
  readonly limit?: number;
}

export interface RetrievalResult {
  readonly content: string;
  readonly source: string;
  readonly page?: number;
  readonly score: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface Retriever {
  search(request: RetrievalRequest): Promise<readonly RetrievalResult[]>;
}
