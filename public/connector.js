#!/usr/bin/env node
/**
 * CodeGPT Standalone Local Workspace Connector
 *
 * Runs on the developer's laptop/workstation.
 * Connects to the CodeGPT cloud agent to safely execute workspace file
 * and test operations strictly within the chosen local folder.
 *
 * Requirements: Node.js >= 18 (zero npm dependencies required)
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const os = require("node:os");

// ── 1. Parse Command-Line Arguments ─────────────────────────────────────────
const args = process.argv.slice(2);
const options = {
  pairingCode: "",
  serverUrl: "http://localhost:3000",
  workspaceDir: process.cwd(),
  deviceName: `${os.hostname()} (${os.platform()})`,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--code" && args[i + 1]) {
    options.pairingCode = args[++i];
  } else if (arg === "--server" && args[i + 1]) {
    options.serverUrl = args[++i].replace(/\/+$/, "");
  } else if (arg === "--dir" && args[i + 1]) {
    options.workspaceDir = path.resolve(args[++i]);
  } else if (arg === "--name" && args[i + 1]) {
    options.deviceName = args[++i];
  }
}

if (!options.pairingCode) {
  console.error("❌ Error: --code <6-digit-code> is required.");
  console.error("Usage: node connector.js --code 123456 --server http://your-server.com");
  process.exit(1);
}

// ── 2. Safe Path Validation & Boundary Defense ──────────────────────────────
const SENSITIVE_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /id_rsa/i,
  /id_ecdsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials\.json$/i,
];

function isPathSafe(relativePath) {
  if (typeof relativePath !== "string") return false;
  if (relativePath.includes("\0") || relativePath.includes("..")) return false;
  const basename = path.basename(relativePath);
  for (const pat of SENSITIVE_PATTERNS) {
    if (pat.test(basename)) return false;
  }
  return true;
}

function resolveSafePath(relativePath) {
  if (!isPathSafe(relativePath)) {
    throw new Error(`Access to file '${relativePath}' is forbidden by security policy.`);
  }
  const resolved = path.resolve(options.workspaceDir, relativePath);
  const normalizedRoot = path.resolve(options.workspaceDir);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error("Path traversal outside workspace boundary is blocked.");
  }
  return resolved;
}

// ── 3. Tool Implementations ─────────────────────────────────────────────────
const SAFE_COMMAND_ALLOWLIST = new Set([
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

async function executeTool(toolName, input) {
  input = input || {};
  switch (toolName) {
    case "read_file": {
      const filePath = resolveSafePath(input.path || "");
      if (!fs.existsSync(filePath)) {
        throw new Error(`File '${input.path}' does not exist.`);
      }
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw.split(/\r?\n/);
      const startLine = typeof input.startLine === "number" ? Math.max(1, input.startLine) : 1;
      const endLine = typeof input.endLine === "number" ? Math.min(lines.length, input.endLine) : lines.length;
      const sliced = lines.slice(startLine - 1, endLine).join("\n");
      return {
        path: input.path,
        content: sliced,
        totalLines: lines.length,
        startLine,
        endLine,
      };
    }

    case "write_file": {
      const filePath = resolveSafePath(input.path || "");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, input.content || "", "utf8");
      return {
        path: input.path,
        bytesWritten: Buffer.byteLength(input.content || "", "utf8"),
        status: "created_or_overwritten",
      };
    }

    case "edit_file": {
      const filePath = resolveSafePath(input.path || "");
      if (!fs.existsSync(filePath)) {
        throw new Error(`File '${input.path}' does not exist.`);
      }
      const original = fs.readFileSync(filePath, "utf8");
      const target = input.targetContent || "";
      const replacement = input.replacementContent || "";
      if (!original.includes(target)) {
        throw new Error("Target content to replace was not found in file.");
      }
      const updated = original.replace(target, replacement);
      fs.writeFileSync(filePath, updated, "utf8");
      return {
        path: input.path,
        status: "edited",
        replacedBytes: target.length,
        newBytes: replacement.length,
      };
    }

    case "delete_file": {
      const filePath = resolveSafePath(input.path || "");
      if (!fs.existsSync(filePath)) {
        throw new Error(`File '${input.path}' does not exist.`);
      }
      fs.unlinkSync(filePath);
      return {
        path: input.path,
        status: "deleted",
      };
    }

    case "list_directory": {
      const targetDir = resolveSafePath(input.path || "");
      if (!fs.existsSync(targetDir)) {
        throw new Error(`Directory '${input.path}' does not exist.`);
      }
      const entries = [];
      function scan(dir, rel) {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name === ".git" || item.name === "node_modules" || item.name === "dist") continue;
          const itemRel = rel ? path.join(rel, item.name) : item.name;
          entries.push({
            name: item.name,
            relativePath: itemRel.replace(/\\/g, "/"),
            type: item.isDirectory() ? "directory" : "file",
          });
          if (item.isDirectory() && input.recursive && entries.length < 500) {
            scan(path.join(dir, item.name), itemRel);
          }
        }
      }
      scan(targetDir, "");
      return { path: input.path || ".", entries };
    }

    case "git_status": {
      return new Promise((resolve) => {
        execFile("git", ["status", "--short", "--branch"], { cwd: options.workspaceDir, timeout: 10000 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ isGitRepo: false, error: stderr || err.message, status: "Not a git repository" });
          } else {
            resolve({ isGitRepo: true, output: stdout.trim() || "Working tree clean" });
          }
        });
      });
    }

    case "run_test": {
      const cmd = (input.command || "npm test").trim();
      if (!SAFE_COMMAND_ALLOWLIST.has(cmd)) {
        throw new Error(`Command '${cmd}' is not permitted. Allowed: ${[...SAFE_COMMAND_ALLOWLIST].join(", ")}`);
      }
      const [bin, ...cmdArgs] = cmd.split(/\s+/);
      return new Promise((resolve) => {
        const startTime = Date.now();
        execFile(bin, cmdArgs, { cwd: options.workspaceDir, timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
          resolve({
            command: cmd,
            exitCode: err && typeof err.code === "number" ? err.code : 0,
            stdout: (stdout || "").slice(0, 4000),
            stderr: (stderr || (err ? err.message : "")).slice(0, 4000),
            durationMs: Date.now() - startTime,
          });
        });
      });
    }

    default:
      throw new Error(`Unsupported tool '${toolName}' on local connector.`);
  }
}

// ── 4. Main Connector Lifecycle ─────────────────────────────────────────────
let isRunning = false;
let deviceToken = "";
let workspaceId = "";

async function start() {
  console.log("=================================================");
  console.log("  CodeGPT Local Workspace Connector");
  console.log("=================================================");
  console.log(`Connecting to: ${options.serverUrl}`);
  console.log(`Pairing Code:  ${options.pairingCode}`);
  console.log(`Local Path:    ${options.workspaceDir}`);
  console.log(`Device:        ${options.deviceName}\n`);

  try {
    const pairRes = await fetch(`${options.serverUrl}/api/connector/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: options.pairingCode,
        deviceName: options.deviceName,
        osPlatform: os.platform(),
        localPath: options.workspaceDir,
      }),
    });

    const pairData = await pairRes.json();
    if (!pairRes.ok || !pairData.deviceToken || !pairData.workspaceId) {
      throw new Error(pairData.error?.message || "Pairing failed. Please verify your 6-digit code.");
    }

    deviceToken = pairData.deviceToken;
    workspaceId = pairData.workspaceId;
    isRunning = true;

    console.log(`✅ [Paired Successfully] Workspace ID: ${workspaceId}`);
    console.log(`🚀 [Ready] Listening for autonomous tool requests from CodeGPT web agent...\n`);
    console.log(`Press Ctrl+C to disconnect anytime.\n`);

    // Heartbeat every 20s
    setInterval(async () => {
      if (!isRunning) return;
      try {
        await fetch(`${options.serverUrl}/api/connector/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deviceToken}`,
          },
        });
      } catch { }
    }, 20000);

    // Long poll loop
    while (isRunning) {
      try {
        const pollRes = await fetch(`${options.serverUrl}/api/connector/poll`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deviceToken}`,
          },
        });

        if (pollRes.ok) {
          const pollData = await pollRes.json();
          const jobs = Array.isArray(pollData.jobs) ? pollData.jobs : [];
          for (const job of jobs) {
            console.log(`⚡ [Executing Tool] ${job.toolName} (Job ID: ${job.jobId})`);
            const startTime = Date.now();
            try {
              const output = await executeTool(job.toolName, job.input);
              const durationMs = Date.now() - startTime;
              console.log(`✓ [Done] ${job.toolName} in ${durationMs}ms`);

              await fetch(`${options.serverUrl}/api/connector/execute-result`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${deviceToken}`,
                },
                body: JSON.stringify({
                  jobId: job.jobId,
                  success: true,
                  output,
                  durationMs,
                }),
              });
            } catch (toolErr) {
              const durationMs = Date.now() - startTime;
              console.error(`✕ [Failed] ${job.toolName}: ${toolErr.message}`);

              await fetch(`${options.serverUrl}/api/connector/execute-result`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${deviceToken}`,
                },
                body: JSON.stringify({
                  jobId: job.jobId,
                  success: false,
                  error: toolErr.message,
                  durationMs,
                }),
              });
            }
          }
        }
      } catch (pollErr) {
        // Sleep on transient error
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    console.error(`\n❌ Pairing Error: ${err.message}\n`);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.log("\n🔌 Disconnecting from CodeGPT server...");
  isRunning = false;
  process.exit(0);
});

start();
