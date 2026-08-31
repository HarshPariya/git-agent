import fs from "node:fs/promises";
import path from "node:path";
import type {
  ToolDefinition,
  ToolPermission,
  WriteFileInput,
  WriteFileOutput,
} from "../types/tools.js";

const DEFAULT_PERMISSIONS: readonly ToolPermission[] = ["write"];
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ALLOWED_BYTES = 50_000;
const PROTECTED_FILES = new Set([".env", "package.json", "package-lock.json"]);

const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Relative path of the file to create or write (e.g. 'src/agent/helper.ts').",
    },
    content: {
      type: "string",
      description: "The text content to write into the file.",
    },
    overwrite: {
      type: "boolean",
      description: "Whether to overwrite if file already exists. Defaults to true.",
    },
  },
  required: ["path", "content"],
  additionalProperties: false,
} as const;

const sanitizePath = (baseDir: string, requestedPath: string): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull && (() => { throw new Error("Path contains illegal null bytes"); })();

  const filename = path.basename(requestedPath);
  const isProtected = PROTECTED_FILES.has(filename) || filename.startsWith(".env");
  isProtected && (() => { throw new Error("Access denied: writing to protected system file is disallowed"); })();

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  isEscaping && (() => { throw new Error("Access denied: path escapes workspace root"); })();

  return resolved;
};

const extractString = (data: Record<string, unknown>, keys: readonly string[]): string => {
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key].length > 0) {
      return data[key] as string;
    }
  }
  return "";
};

const parseInput = (input: unknown): WriteFileInput => {
  const isObject = typeof input === "object" && input !== null && !Array.isArray(input);
  !isObject && (() => { throw new Error("Invalid write_file input"); })();

  const data = input as Record<string, unknown>;
  const rawPath = extractString(data, ["path", "filePath", "file_path", "filename", "file"]).trim();
  !rawPath && (() => { throw new Error("File path is required"); })();

  const rawContent = extractString(data, ["content", "text", "file_content", "body", "code"]);
  const overwrite = typeof data.overwrite === "boolean" ? data.overwrite : true;

  return { path: rawPath, content: rawContent, overwrite };
};

export const createWriteFileTool = (
  baseDir: string = process.cwd(),
): ToolDefinition<WriteFileInput, WriteFileOutput> => ({
  name: "write_file",
  description: "Creates or writes text content to a file in the workspace.",
  parameters,
  permissions: DEFAULT_PERMISSIONS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  parseInput,
  execute: async ({ input }) => {
    const filePath = sanitizePath(baseDir, input.path);
    const byteLength = Buffer.byteLength(input.content, "utf8");

    byteLength > MAX_ALLOWED_BYTES &&
      (() => {
        throw new Error(
          `Content size ${byteLength} bytes exceeds limit of ${MAX_ALLOWED_BYTES} bytes`,
        );
      })();

    if (!input.overwrite) {
      try {
        await fs.access(filePath);
        throw new Error(`File '${input.path}' already exists`);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, "utf8");

    return {
      path: input.path,
      created: true,
      bytesWritten: byteLength,
      message: `Successfully wrote ${byteLength} bytes to '${input.path}'.`,
    };
  },
});
