import type { RetrievalRequest, RetrievalResult } from "../retrieval/types.js";
import type { ToolDefinition, ToolPermission } from "./types.js";

const parameters = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "The knowledge query to retrieve.",
    },
    tenantId: {
      type: "string",
      description: "Optional tenant identifier.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of results.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const parseInput = (input: unknown): RetrievalRequest => {
  switch (typeof input) {
    case "object":
      switch (input === null || Array.isArray(input)) {
        case true:
          throw new Error("Invalid knowledge tool input");

        case false: {
          const data = input as Record<string, unknown>;
          const query = data.query;

          switch (typeof query) {
            case "string": {
              const normalizedQuery = query.trim();

              switch (normalizedQuery.length) {
                case 0:
                  throw new Error("Knowledge query must not be empty");

                default: {
                  const tenantId =
                    typeof data.tenantId === "string"
                      ? data.tenantId.trim()
                      : undefined;

                  const limit =
                    typeof data.limit === "number" &&
                    Number.isInteger(data.limit) &&
                    data.limit > 0
                      ? data.limit
                      : undefined;

                  return {
                    query: normalizedQuery,
                    ...(tenantId && { tenantId }),
                    ...(limit !== undefined && { limit }),
                  };
                }
              }
            }

            default:
              throw new Error("Knowledge query must be a string");
          }
        }
      }

    default:
      throw new Error("Invalid knowledge tool input");
  }
};

export type KnowledgeRetriever = (
  request: RetrievalRequest,
) => Promise<readonly RetrievalResult[]>;

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["read"];
const DEFAULT_TIMEOUT_MS = 10_000;

export const createKnowledgeTool = (
  retriever: KnowledgeRetriever,
): ToolDefinition<RetrievalRequest, readonly RetrievalResult[]> => ({
  name: "retrieve_knowledge",
  description:
    "Retrieve relevant knowledge from the connected knowledge system.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: ({ input }) => retriever(input),
});
