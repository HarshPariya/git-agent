import type { AgentAction, AgentPlan, PlanRequest } from "../types/agent.js";

export type { AgentAction, AgentPlan, PlanRequest };

interface PlannerRule {
  readonly action: AgentAction;
  readonly reason: string;
  readonly matcher: (q: string) => boolean;
}

/**
 * TOOL_TERMS — exhaustive natural-language phrases that indicate the user wants
 * the agent to use a workspace tool (list, read, write, edit, delete, git, etc).
 * All terms are matched case-insensitively against the normalised question.
 */
const TOOL_TERMS = [
  // --- file structure / listing ---
  "project structure",
  "folder structure",
  "directory structure",
  "file structure",
  "file tree",
  "list files",
  "list directory",
  "list all files",
  "show files",
  "show me files",
  "show directory",
  "show folder",
  "show structure",
  "what files",
  "what's in",
  "whats in",
  "what is in",
  "tell me the structure",
  "tell me all files",
  "tell me what files",
  "give me the structure",
  "whole structure",
  "full structure",
  "entire structure",
  "project files",
  "project layout",
  "project tree",
  "what folders",
  "folder contents",
  "directory contents",
  "contents of",
  "files in",
  "folders in",
  "check my folder",
  "check folder",
  "check files",
  "check directory",
  "check structure",
  "workspace",
  "files exist",
  "codebase structure",
  "codebase layout",

  // --- reading files ---
  "read file",
  "read the file",
  "read this file",
  "read my file",
  "open file",
  "show file",
  "show me file",
  "show me the file",
  "display file",
  "print file",
  "get file",
  "get contents",
  "get the contents",
  "inspect file",
  "inspect",
  "examine file",
  "check file",
  "view file",
  "what does the file",
  "what is in the file",
  "content of",
  "contents of",
  "code in file",
  "see the file",

  // --- writing / creating files ---
  "write file",
  "write to file",
  "write code",
  "write in",
  "create file",
  "create a file",
  "make file",
  "make a file",
  "new file",
  "generate file",
  "generate code",
  "save file",
  "put in file",
  "add to file",

  // --- editing / modifying files ---
  "edit file",
  "edit the file",
  "modify file",
  "modify the file",
  "update file",
  "update the file",
  "change file",
  "change the file",
  "replace in file",
  "replace content",
  "refactor",
  "rename",

  // --- deleting files ---
  "delete file",
  "delete the file",
  "delete folder",
  "remove file",
  "remove the file",
  "remove folder",
  "delete directory",
  "remove directory",
  "purge",

  // --- general action terms ---
  "read",
  "write",
  "create",
  "delete",
  "remove",
  "modify",
  "replace",
  "update",
  "change",
  "edit",
  "run test",
  "execute",
  "calculate",

  // --- git ---
  "git",
  "git status",
  "git log",
  "commit",
  "branch",
  "repository",
  "repo",
  "staged",
  "unstaged",

  // --- generic workspace signals ---
  "folder",
  "directory",
  "search file",
  "search code",
  "find file",
  "locate file",
] as const;

const RETRIEVE_TERMS = [
  "policy",
  "pricing",
  "refund",
  "procedure",
  "guideline",
  "company",
  "documentation on",
  "knowledge base",
] as const;

const HEALTH_TERMS = [
  "health status",
  "is the api healthy",
  "is the application healthy",
  "is the server healthy",
  "is the service healthy",
  "api health",
  "server health",
  "service health",
  "app health",
  "application health",
  "is the api up",
  "is the server up",
  "is the service running",
  "system health",
] as const;

/** Regex: path-like token in the query (e.g. "src/agent/planner.ts") */
const FILE_PATH_REGEX =
  /(?:\.[\\/\\\\]|[a-zA-Z0-9_-]+[\\/\\\\])[a-zA-Z0-9_\-\.\\/]+\.[a-zA-Z0-9]+/i;

/** Regex: explicit filename mention (e.g. "planner.ts", "app.js", "Dockerfile") */
const FILENAME_REGEX = /\b[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{2,6}\b/;

const RULES: readonly PlannerRule[] = [
  {
    action: "direct_answer",
    reason: "The question is an operational health/status inquiry.",
    matcher: (q) => HEALTH_TERMS.some((term) => q.includes(term)),
  },
  {
    action: "tool",
    reason: "The question requires file system, git, or autonomous workspace tools.",
    matcher: (q) =>
      TOOL_TERMS.some((term) => q.includes(term)) ||
      FILE_PATH_REGEX.test(q) ||
      FILENAME_REGEX.test(q),
  },
  {
    action: "retrieve",
    reason: "The question may require external knowledge retrieval.",
    matcher: (q) => RETRIEVE_TERMS.some((term) => q.includes(term)),
  },
];

export const createPlan = ({ question }: PlanRequest): AgentPlan => {
  const normalized = question.trim().toLowerCase();
  const matched = RULES.find((rule) => rule.matcher(normalized));

  return matched
    ? { action: matched.action, reason: matched.reason }
    : { action: "direct_answer", reason: "The question can be answered directly." };
};
