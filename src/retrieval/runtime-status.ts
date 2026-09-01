export type RetrievalComponentState = "initializing" | "ready" | "degraded" | "unavailable";

export interface RetrievalRuntimeStatus {
  graph: RetrievalComponentState;
  vector: RetrievalComponentState;
  files: number;
  chunks: number;
  lastRefreshAt?: string | undefined;
  lastError?: string | undefined;
}

const status: RetrievalRuntimeStatus = {
  graph: "initializing",
  vector: "initializing",
  files: 0,
  chunks: 0,
};

export function updateRetrievalRuntimeStatus(update: Partial<RetrievalRuntimeStatus>): void {
  Object.assign(status, update);
}

export function getRetrievalRuntimeStatus(): Readonly<RetrievalRuntimeStatus> {
  return { ...status };
}
