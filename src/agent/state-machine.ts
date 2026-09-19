/**
 * 16 Canonical Lifecycle States defined in AI Git Debugging Agent Specification
 */
export type CanonicalLifecycleState =
  | "CREATED"
  | "TRIAGING"
  | "CONTEXT_GATHERING"
  | "SEARCHING"
  | "ANALYZING"
  | "HYPOTHESIS"
  | "EVIDENCE"
  | "ROOT_CAUSE"
  | "FIX_PLANNING"
  | "CRITIC_REVIEW"
  | "PATCH_PROPOSED"
  | "WAITING_APPROVAL"
  | "PATCHING"
  | "TESTING"
  | "VERIFYING"
  | "COMPLETED";

export type TerminalLifecycleState = "FAILED" | "CANCELLED" | "BLOCKED" | "ABORTED";

export type AgentState =
  | CanonicalLifecycleState
  | TerminalLifecycleState
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
  | "RESOLVING_CONFLICTS";

export interface StateTransitionEvent {
  readonly from: AgentState;
  readonly to: AgentState;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export type StateListener = (event: StateTransitionEvent) => void;

const TERMINAL_STATES = new Set<AgentState>(["COMPLETED", "FAILED", "CANCELLED", "BLOCKED", "ABORTED"]);

/**
 * Maps any internal granular state to its primary canonical lifecycle state
 */
export function mapToCanonicalLifecycle(state: AgentState): CanonicalLifecycleState | TerminalLifecycleState {
  switch (state) {
    case "IDLE":
    case "INITIALIZING":
      return "CREATED";
    case "ISOLATING_DEFECT":
      return "TRIAGING";
    case "SCANNING_REPOSITORY":
    case "MAPPING_DEPENDENCIES":
      return "CONTEXT_GATHERING";
    case "QUERYING_CODE_GRAPH":
    case "EXTRACTING_CALL_GRAPH":
    case "INDEXING_GRAPHRAG":
      return "SEARCHING";
    case "ANALYZING_GIT_HISTORY":
    case "INSPECTING_GIT_DIFF":
    case "TRACING_BLAME":
    case "REPRODUCING_BEHAVIOR":
      return "ANALYZING";
    case "GENERATING_HYPOTHESES":
    case "RANKING_HYPOTHESES":
      return "HYPOTHESIS";
    case "GATHERING_EVIDENCE":
    case "EVALUATING_HYPOTHESIS":
      return "EVIDENCE";
    case "DIAGNOSING_ROOT_CAUSE":
      return "ROOT_CAUSE";
    case "SYNTHESIZING_PATCH":
      return "FIX_PLANNING";
    case "VALIDATING_PATCH_SAFETY":
      return "CRITIC_REVIEW";
    case "REVIEWING_DIFF":
      return "PATCH_PROPOSED";
    case "SIMULATING_DRY_RUN":
      return "WAITING_APPROVAL";
    case "RESOLVING_CONFLICTS":
      return "PATCHING";
    case "EXECUTING_TARGETED_TESTS":
      return "TESTING";
    case "MONITORING_CI":
      return "VERIFYING";
    case "COMMITTING_CHANGES":
    case "CREATING_PULL_REQUEST":
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
    case "ABORTED":
      return "CANCELLED";
    case "BLOCKED":
      return "BLOCKED";
    default:
      return state;
  }
}

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
