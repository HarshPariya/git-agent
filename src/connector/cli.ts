#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Guardrail patterns
const SENSITIVE_PATTERNS = [/\.env/i, /\.git/i, /\.key$/i, /\.pem$/i, /id_rsa/i];
const PROTECTED_WRITE = new Set(["package.json", "package-lock.json", "tsconfig.json", ".env"]);
const COMMAND_ALLOWLIST = new Set([
  "npm test",
  "npm run test",
  "npm run build",
  "npm run lint",
  "npm run typecheck",
  "npx tsc --noEmit",
  "pytest",
  "cargo test",
  "go test ./...",
]);

interface ConnectorOptions {
  serverUrl: string;
  pairingCode: string;
  workspaceDir: string;
  deviceName: string;
}

export class LocalWorkspaceConnector {
  private deviceToken: string = "";
  private workspaceId: string = "";
  private isRunning: boolean = false;
  private pollIntervalTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly options: ConnectorOptions) { }

  private sanitizePath(requestedPath: string): string {
    if (requestedPath.includes("\0")) throw new Error("Null bytes disallowed");
    const resolved = path.resolve(this.options.workspaceDir, requestedPath);
    const relative = path.relative(this.options.workspaceDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Path escapes local workspace boundary");
    }
    return resolved;
  }

  private checkSensitive(targetPath: string): void {
    if (SENSITIVE_PATTERNS.some((p) => p.test(targetPath))) {
      throw new Error("Access denied: reading/modifying sensitive security file is prohibited");
    }
  }

  async start(): Promise<void> {
    console.log(`\n🔌 [CodeGPT Local Connector] Connecting to ${this.options.serverUrl}...`);
    console.log(`📂 [Workspace Directory] ${path.resolve(this.options.workspaceDir)}`);

    // 1. Pair with server
    const pairRes = await fetch(`${this.options.serverUrl}/api/connector/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: this.options.pairingCode,
        deviceName: this.options.deviceName || os.hostname(),
        osPlatform: process.platform,
        localPath: path.resolve(this.options.workspaceDir),
      }),
    });

    const pairData = (await pairRes.json()) as {
      deviceToken?: string;
      workspaceId?: string;
      error?: { message?: string };
    };
    if (!pairRes.ok || !pairData.deviceToken || !pairData.workspaceId) {
      throw new Error(pairData.error?.message || "Pairing failed");
    }

    this.deviceToken = pairData.deviceToken;
    this.workspaceId = pairData.workspaceId;
    this.isRunning = true;

    console.log(`✅ [Paired Successfully] Workspace ID: ${this.workspaceId}`);
    console.log(`🚀 [Ready] Listening for autonomous tool requests from cloud agent...\n`);

    // 2. Start heartbeat & polling loops
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 20_000);
    this.runPollLoop();
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.isRunning) return;
    try {
      await fetch(`${this.options.serverUrl}/api/connector/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.deviceToken}`,
        },
      });
    } catch {
      // transient heartbeat failure
    }
  }

  private async runPollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const res = await fetch(`${this.options.serverUrl}/api/connector/poll`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.deviceToken}`,
          },
        });

        if (res.ok) {
          const data = (await res.json()) as { jobs?: { jobId: string; toolName: string; input: unknown }[] };
          const jobs = Array.isArray(data.jobs) ? data.jobs : [];
          for (const job of jobs) {
            await this.processJob(job);
          }
        }
      } catch {
        // Sleep on error
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async processJob(job: { jobId: string; toolName: string; input: unknown }): Promise<void> {
    const startTime = Date.now();
    console.log(`⚡ [Tool Received] ${job.toolName} (Job ID: ${job.jobId})`);

    let resultOutput: unknown;
    let resultError: string | undefined;
    let isSuccess = false;

    try {
      resultOutput = await this.executeLocalTool(job.toolName, job.input);
      isSuccess = true;
      console.log(`✓ [Tool Finished] ${job.toolName} (Duration: ${Date.now() - startTime}ms)`);
    } catch (err) {
      resultError = err instanceof Error ? err.message : String(err);
      console.error(`✕ [Tool Error] ${job.toolName}: ${resultError}`);
    }

    try {
      await fetch(`${this.options.serverUrl}/api/connector/execute-result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.deviceToken}`,
        },
        body: JSON.stringify({
          jobId: job.jobId,
          result: {
            toolName: job.toolName,
            callId: job.jobId,
            success: isSuccess,
            output: resultOutput,
            error: resultError,
            durationMs: Date.now() - startTime,
          },
        }),
      });
    } catch (err) {
      console.error(`Failed to submit job result:`, err);
    }
  }

  private async executeLocalTool(toolName: string, rawInput: unknown): Promise<unknown> {
    const input = (typeof rawInput === "object" && rawInput !== null ? rawInput : {}) as Record<string, unknown>;

    switch (toolName) {
      case "read_file": {
        const filePath = this.sanitizePath(String(input.path || ""));
        this.checkSensitive(filePath);
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        const startLine = Math.max(1, Number(input.startLine) || 1);
        const endLine = Math.min(lines.length, Number(input.endLine) || lines.length);
        const sliced = lines.slice(startLine - 1, endLine).join("\n");
        return {
          path: path.relative(this.options.workspaceDir, filePath).replace(/\\/g, "/"),
          content: sliced,
          totalLines: lines.length,
          startLine,
          endLine,
        };
      }

      case "write_file": {
        const filePath = this.sanitizePath(String(input.path || ""));
        this.checkSensitive(filePath);
        const filename = path.basename(filePath);
        if (PROTECTED_WRITE.has(filename)) throw new Error("Writing protected file disallowed");
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const content = String(input.content || "");
        await fs.writeFile(filePath, content, "utf8");
        return {
          path: path.relative(this.options.workspaceDir, filePath).replace(/\\/g, "/"),
          bytesWritten: Buffer.byteLength(content, "utf8"),
          created: true,
        };
      }

      case "edit_file": {
        const filePath = this.sanitizePath(String(input.path || ""));
        this.checkSensitive(filePath);
        const target = String(input.targetContent || "");
        const replacement = String(input.replacementContent || "");
        const content = await fs.readFile(filePath, "utf8");
        if (!content.includes(target)) throw new Error("Target content not found in file");
        const updated = content.replace(target, replacement);
        await fs.writeFile(filePath, updated, "utf8");
        return {
          path: path.relative(this.options.workspaceDir, filePath).replace(/\\/g, "/"),
          modified: true,
        };
      }

      case "delete_file": {
        const filePath = this.sanitizePath(String(input.path || ""));
        this.checkSensitive(filePath);
        const filename = path.basename(filePath);
        if (PROTECTED_WRITE.has(filename)) throw new Error("Deleting protected file disallowed");
        await fs.unlink(filePath);
        return {
          path: path.relative(this.options.workspaceDir, filePath).replace(/\\/g, "/"),
          deleted: true,
        };
      }

      case "list_directory": {
        const dirPath = this.sanitizePath(String(input.path || "."));
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return {
          path: path.relative(this.options.workspaceDir, dirPath).replace(/\\/g, "/") || ".",
          entries: entries.slice(0, 100).map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
          })),
        };
      }

      case "git_status": {
        try {
          const { stdout } = await execFileAsync("git", ["status", "--short"], {
            cwd: this.options.workspaceDir,
            timeout: 10_000,
          });
          return { status: stdout.trim() || "Clean working tree", isClean: !stdout.trim() };
        } catch {
          return { status: "Git repository not detected", isClean: true };
        }
      }

      case "run_test":
      case "run_build":
      case "run_lint": {
        const cmd = String(input.command || (toolName === "run_test" ? "npm test" : toolName === "run_build" ? "npm run build" : "npm run lint")).trim();
        if (!COMMAND_ALLOWLIST.has(cmd)) {
          throw new Error(`Command '${cmd}' is not in the safe allowlist. Permitted: ${[...COMMAND_ALLOWLIST].join(", ")}`);
        }
        const [bin, ...args] = cmd.split(/\s+/);
        const { stdout, stderr } = await execFileAsync(bin!, args, {
          cwd: this.options.workspaceDir,
          timeout: 30_000,
          maxBuffer: 1024 * 512,
        });
        return { command: cmd, exitCode: 0, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 2000) };
      }

      default:
        throw new Error(`Tool '${toolName}' not supported by local connector`);
    }
  }

  stop(): void {
    this.isRunning = false;
    this.heartbeatTimer && clearInterval(this.heartbeatTimer);
    this.pollIntervalTimer && clearInterval(this.pollIntervalTimer);
    console.log("\n🔌 [CodeGPT Local Connector] Disconnected.");
  }
}

// Direct CLI Execution parsing
if (process.argv[1] && process.argv[1].endsWith("cli.ts")) {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: string = "") => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1]! : fallback;
  };

  const code = getArg("--code") || getArg("-c");
  const server = getArg("--server", "http://localhost:3000");
  const dir = getArg("--dir", process.cwd());
  const device = getArg("--name", os.hostname());

  if (code) {
    const connector = new LocalWorkspaceConnector({
      serverUrl: server,
      pairingCode: code,
      workspaceDir: dir,
      deviceName: device,
    });
    connector.start().catch((err) => {
      console.error("❌ Connector failure:", err.message);
      process.exit(1);
    });
  }
}
