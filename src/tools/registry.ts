import type { ToolDefinition, RuntimeTool } from "./types.js";

type RegisteredTool = ToolDefinition<never, unknown>;

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    switch (this.tools.has(tool.name)) {
      case true:
        throw new Error(`Tool already registered: ${tool.name}`);

      case false:
        this.tools.set(tool.name, tool as unknown as RegisteredTool);
        return;
    }
  }

  get<TInput, TOutput>(name: string): ToolDefinition<TInput, TOutput> {
    const tool = this.tools.get(name);

    switch (tool) {
      case undefined:
        throw new Error(`Unknown tool: ${name}`);

      default:
        return tool as unknown as ToolDefinition<TInput, TOutput>;
    }
  }

  getRuntime(name: string): RuntimeTool {
    const tool = this.tools.get(name);

    switch (tool) {
      case undefined:
        throw new Error(`Unknown tool: ${name}`);

      default:
        return {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (input) =>
            tool.execute({
              input: tool.parseInput(input),
            }),
        };
    }
  }

  list(): readonly RuntimeTool[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (input) =>
        tool.execute({
          input: tool.parseInput(input),
        }),
    }));
  }
}
