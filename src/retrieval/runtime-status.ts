export type RetrievalComponentState = "initializing" | "ready" | "degraded" | "unavailable";

export interface RetrievalRuntimeStatus {
  graph: RetrievalComponentState;
  vector: RetrievalComponentState;
  files: number;
  chunks: number;
  lastRefreshAt?: string;
  lastError?: string;
}

const status: RetrievalRuntimeStatus = {
  graph: "initializing",
  vector: "initializing",
  files: 0,
  chunks: 0,
};

export const updateRetrievalRuntimeStatus = (update: Partial<RetrievalRuntimeStatus>): void => {
  Object.assign(status, update);
};

export const getRetrievalRuntimeStatus = (): Readonly<RetrievalRuntimeStatus> => ({ ...status });
