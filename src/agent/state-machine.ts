export type AgentState =
  | "IDLE"
  | "INITIALIZING"
  | "SCANNING_REPOSITORY"
  | "INDEXING_GRAPHRAG"
  | "ANALYZING_GIT_HISTORY"
  | "INSPECTING_GIT_DIFF"
  | "TRACING_BLAME"
  | "QUERYING_CODE_GRAPH"
  | "EXTRACTING_CALL_GRAPH"
  | "MAPPING_DEPENDENCIES"
  | "GENERATING_HYPOTHESES"
  | "RANKING_HYPOTHESES"
  | "GATHERING_EVIDENCE"
  | "EVALUATING_HYPOTHESIS"
  | "ISOLATING_DEFECT"
  | "REPRODUCING_BEHAVIOR"
  | "DIAGNOSING_ROOT_CAUSE"
  | "SYNTHESIZING_PATCH"
  | "VALIDATING_PATCH_SAFETY"
  | "SIMULATING_DRY_RUN"
  | "EXECUTING_TARGETED_TESTS"
  | "REVIEWING_DIFF"
  | "COMMITTING_CHANGES"
  | "CREATING_PULL_REQUEST"
  | "MONITORING_CI"
  | "RESOLVING_CONFLICTS"
  | "COMPLETED"
  | "ABORTED"
  | "FAILED";

export interface StateTransitionEvent {
  readonly from: AgentState;
  readonly to: AgentState;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export type StateListener = (event: StateTransitionEvent) => void;

const TERMINAL_STATES = new Set<AgentState>(["COMPLETED", "ABORTED", "FAILED"]);

export class AgentStateMachine {
  private currentState: AgentState = "IDLE";
  private history: StateTransitionEvent[] = [];
  private listeners: Set<StateListener> = new Set();
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  public getState(): AgentState {
    return this.currentState;
  }

  public getHistory(): readonly StateTransitionEvent[] {
    return [...this.history];
  }

  public transition(to: AgentState, reason?: string, metadata?: Record<string, unknown>): AgentState {
    const from = this.currentState;
    const event: StateTransitionEvent = {
      from,
      to,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...(reason !== undefined && { reason }),
      ...(metadata !== undefined && { metadata }),
    };

    this.currentState = to;
    this.history.push(event);
    this.notifyListeners(event);

    return this.currentState;
  }

  private notifyListeners(event: StateTransitionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err: unknown) {
        console.error("State machine listener error:", err);
      }
    }
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public isTerminal(): boolean {
    return TERMINAL_STATES.has(this.currentState);
  }
}
