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
