import type { NextFunction, Request, Response } from "express";
import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { AppError } from "../errors/app-error.js";
import { getExecutionPath } from "../git/engine.js";
import { escapeShellArg } from "../git/utils.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

const SCRIPT_NAME_PATTERN = /^[a-zA-Z0-9_@/.:-]+$/;
const ARG_PATTERN = /^[a-zA-Z0-9_@/.:-]+$/;

export interface RepositoryScript {
  readonly name: string;
  readonly command: string;
}

export interface ScriptManifest {
  readonly repositoryId: string;
  readonly directory: string;
  readonly packageManager: string;
  readonly scripts: readonly RepositoryScript[];
}

export interface ScriptRunResult {
  readonly script: string;
  readonly command: string;
  readonly packageManager: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly status: "success" | "failed" | "timeout";
}

interface PackageManifest {
  readonly scripts: Record<string, string>;
}

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const getRequestBody = (request: Request): Record<string, unknown> =>
  typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};

const optionalString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const requireString = (body: Record<string, unknown>, key: string): string => {
  const value = optionalString(body, key);
  if (!value) throw new AppError(`${key} is required`, "VALIDATION_ERROR", 400);
  return value;
};

const validateScriptName = (name: string): string => {
  if (!SCRIPT_NAME_PATTERN.test(name)) {
    throw new AppError(`Invalid script name: "${name}"`, "VALIDATION_ERROR", 400);
  }
  return name;
};

async function detectPackageManager(directory: string): Promise<string> {
  for (const [lockfile, manager] of [
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lockb", "bun"],
  ] as const) {
    try {
      await fs.access(path.join(directory, lockfile));
      return manager;
    } catch {
      // Lockfile not present — try next
    }
  }
  return "npm";
}

async function loadPackageManifest(directory: string): Promise<PackageManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(directory, "package.json"), "utf-8");
  } catch {
    return { scripts: {} };
  }

  let parsed: { scripts?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  } catch {
    return { scripts: {} };
  }

  const scripts: Record<string, string> = {};
  if (typeof parsed.scripts === "object" && parsed.scripts !== null) {
    for (const [name, command] of Object.entries(parsed.scripts)) {
      if (typeof command === "string" && SCRIPT_NAME_PATTERN.test(name)) {
        scripts[name] = command;
      }
    }
  }

  return { scripts };
}

export async function listScriptsForRepository(repositoryId: string): Promise<ScriptManifest> {
  const directory = getExecutionPath(repositoryId);
  const [packageManager, manifest] = await Promise.all([
    detectPackageManager(directory),
    loadPackageManifest(directory),
  ]);

  const scripts: RepositoryScript[] = Object.entries(manifest.scripts).map(([name, command]) => ({ name, command }));

  return { repositoryId, directory, packageManager, scripts };
}

export async function runRepositoryScript(
  repositoryId: string,
  scriptName: string,
  args: readonly string[] = [],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ScriptRunResult> {
  const directory = getExecutionPath(repositoryId);
  const [packageManager, manifest] = await Promise.all([
    detectPackageManager(directory),
    loadPackageManifest(directory),
  ]);

  const script = validateScriptName(scriptName);
  const command = manifest.scripts[script];
  if (typeof command !== "string") {
    throw new AppError(`Script "${script}" is not defined in package.json`, "NOT_FOUND", 404);
  }

  const validatedArgs = args.map((arg) => {
    if (!ARG_PATTERN.test(arg)) {
      throw new AppError(`Invalid script argument: "${arg}"`, "VALIDATION_ERROR", 400);
    }
    return arg;
  });

  const clampedTimeout = Math.min(Math.max(1, timeoutMs), MAX_TIMEOUT_MS);
  const shellCommand = [`${packageManager} run ${escapeShellArg(script)}`, ...validatedArgs.map(escapeShellArg)].join(
    " ",
  );

  const startedAt = Date.now();
  let status: ScriptRunResult["status"] = "success";
  let exitCode = 0;
  let stdout: string;
  let stderr: string;

  try {
    const result = await execAsync(shellCommand, {
      cwd: directory,
      timeout: clampedTimeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env },
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
  } catch (err: unknown) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
    exitCode = typeof e.code === "number" ? e.code : 1;
    stdout = e.stdout ?? "";
    stderr =
      e.stderr ?? (e.killed ? `Script timed out after ${clampedTimeout}ms` : String(e.message ?? "Script failed"));
    status = e.killed ? "timeout" : exitCode === 0 ? "success" : "failed";
  }

  return {
    script,
    command,
    packageManager,
    args: validatedArgs,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    status,
  };
}

export async function listScriptsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const query = request.query as Record<string, unknown>;
    const body = getRequestBody(request);
    const repositoryId =
      typeof query.repositoryId === "string" && query.repositoryId.trim()
        ? query.repositoryId.trim()
        : (optionalString(body, "repositoryId") ?? "");

    if (!repositoryId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);

    const manifest = await listScriptsForRepository(repositoryId);
    response.status(200).json(manifest);
  } catch (error) {
    next(error);
  }
}

export async function runScriptHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getTenantContext(request);
    const body = getRequestBody(request);
    const repositoryId = requireString(body, "repositoryId");
    const script = requireString(body, "script");
    const rawArgs = body.args;
    const args = Array.isArray(rawArgs) ? rawArgs.filter((a): a is string => typeof a === "string") : [];
    const rawTimeout = body.timeoutMs;
    const timeoutMs = typeof rawTimeout === "number" && Number.isFinite(rawTimeout) ? rawTimeout : DEFAULT_TIMEOUT_MS;

    const result = await runRepositoryScript(repositoryId, script, args, timeoutMs);

    // A failing script (e.g. failing tests) is a valid outcome, not a server error.
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
