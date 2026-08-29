import type {
  ToolDefinition,
  RuntimeTool,
  ToolPermission,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types.js";
import { logger } from "../logging/logger.js";

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

  getRuntime(name: string, context: ToolExecutionContext): RuntimeTool {
    const tool = this.tools.get(name);

    switch (tool) {
      case undefined:
        throw new Error(`Unknown tool: ${name}`);

      default:
        this.checkPermissions(tool.permissions, context.userPermissions);
        return {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          permissions: tool.permissions,
          timeoutMs: tool.timeoutMs,
          execute: async (input) =>
            tool.execute({
              input: tool.parseInput(input),
              permissions: context.userPermissions,
            }),
        };
    }
  }

  list(context?: ToolExecutionContext): readonly RuntimeTool[] {
    const userPermissions = context?.userPermissions ?? [];
    return [...this.tools.values()]
      .filter((tool) => this.hasPermission(tool.permissions, userPermissions))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        permissions: tool.permissions,
        timeoutMs: tool.timeoutMs,
        execute: async (input) =>
          tool.execute({
            input: tool.parseInput(input),
            permissions: userPermissions,
          }),
      }));
  }

  private hasPermission(
    required: readonly ToolPermission[],
    user: readonly ToolPermission[],
  ): boolean {
    if (required.length === 0) {
      return true;
    }
    if (user.length === 0) {
      return false;
    }
    return required.every((p) => user.includes(p));
  }

  private checkPermissions(
    required: readonly ToolPermission[],
    user: readonly ToolPermission[],
  ): void {
    if (!this.hasPermission(required, user)) {
      throw new Error(
        `Insufficient permissions for tool. Required: ${required.join(", ")}, User: ${user.join(", ")}`,
      );
    }
  }

  async executeTool<TOutput>(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<TOutput>> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      const result: ToolExecutionResult<TOutput> = {
        toolName: name,
        callId: crypto.randomUUID(),
        success: false,
        output: undefined,
        error: `Unknown tool: ${name}`,
        durationMs: Date.now() - startTime,
      };
      logger.warn("Tool execution failed", {
        operation: "tool.execute",
        metadata: {
          ...result,
          tenantId: context.tenantId,
          sessionId: context.sessionId,
        },
      });
      return result;
    }

    this.checkPermissions(tool.permissions, context.userPermissions);

    logger.info("Tool execution started", {
      operation: "tool.execute",
      metadata: {
        toolName: name,
        timeoutMs: tool.timeoutMs,
        tenantId: context.tenantId,
        sessionId: context.sessionId,
      },
    });

    try {
      const parsedInput = tool.parseInput(input);
      const timeoutMs = tool.timeoutMs ?? 30_000;

      const executePromise = tool.execute({
        input: parsedInput,
        permissions: context.userPermissions,
      });

      const output = await Promise.race([
        executePromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Tool execution timeout")),
            timeoutMs,
          ),
        ),
      ]);

      const result: ToolExecutionResult<TOutput> = {
        toolName: name,
        callId: crypto.randomUUID(),
        success: true,
        output: output as TOutput,
        error: undefined,
        durationMs: Date.now() - startTime,
      };

      logger.info("Tool execution completed", {
        operation: "tool.execute",
        metadata: {
          toolName: name,
          success: true,
          durationMs: result.durationMs,
          tenantId: context.tenantId,
          sessionId: context.sessionId,
        },
      });

      return result;
    } catch (error) {
      const result: ToolExecutionResult<TOutput> = {
        toolName: name,
        callId: crypto.randomUUID(),
        success: false,
        output: undefined,
        error: error instanceof Error ? error.message : "Tool execution failed",
        durationMs: Date.now() - startTime,
      };

      logger.error("Tool execution failed", {
        operation: "tool.execute",
        metadata: {
          toolName: name,
          success: false,
          error: result.error,
          durationMs: result.durationMs,
          tenantId: context.tenantId,
          sessionId: context.sessionId,
        },
      });

      return result;
    }
  }
}
