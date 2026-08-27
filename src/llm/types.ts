export interface LlmRequest {
  readonly instructions: string;
  readonly input: string;
}

export interface LlmResponse {
  readonly id: string;
  readonly model: string;
  readonly text: string;
}

export interface LlmProvider {
  generate(request: LlmRequest): Promise<LlmResponse>;
}
