import http from "node:http";
import os from "node:os";
import { getOrGeneratePairingToken } from "./config.js";
import { browseDirectory, readFileContent, writeFileContent } from "./fs.js";
import * as git from "./git.js";
import { applyPatchChanges, revertPatchBackup } from "./patch.js";
import { isOriginAllowed, validateToken } from "./security.js";
import { runLocalTests } from "./test-runner.js";
import type { HealthResponse, LocalAgentConfig, PatchChange } from "./types.js";

export function createLocalAgentServer(config: LocalAgentConfig) {
  let activeToken = "";
  let server: http.Server | null = null;

  async function initToken(): Promise<string> {
    activeToken = await getOrGeneratePairingToken(config.tokenFilePath);
    return activeToken;
  }

  const parseBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer | string) => {
        data += String(chunk);
        if (data.length > 10 * 1024 * 1024) {
          req.destroy();
          reject(new Error("Request entity too large"));
        }
      });
      req.on("end", () => {
        if (!data.trim()) return resolve({});
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch (err: unknown) {
          reject(new Error("Invalid JSON payload", { cause: err }));
        }
      });
      req.on("error", (err) => reject(new Error(err.message, { cause: err })));
    });
  };

  const sendJson = (res: http.ServerResponse, statusCode: number, data: unknown) => {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
    });
    res.end(json);
  };

  const sendError = (res: http.ServerResponse, statusCode: number, message: string, code = "LOCAL_AGENT_ERROR") => {
    sendJson(res, statusCode, { error: message, code, success: false });
  };

  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin;

    // CORS handling
    if (origin && isOriginAllowed(origin, config.allowedOrigins)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Local-Agent-Token, Accept");
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // ── Public Endpoint: Health ──────────────────────────────────────────
    if (pathname === "/health" && req.method === "GET") {
      const gitCheck = await git.checkGitInstalled();
      const healthData: HealthResponse = {
        status: "ok",
        version: "1.0.0",
        gitInstalled: gitCheck.installed,
        ...(gitCheck.version ? { gitVersion: gitCheck.version } : {}),
        platform: `${os.platform()} ${os.release()} (${os.arch()})`,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
      };
      return sendJson(res, 200, healthData);
    }

    // ── Public Endpoint: Pairing Handshake ───────────────────────────────
    if (pathname === "/pair" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const candidateToken = typeof body.token === "string" ? body.token : "";

        if (!validateToken(candidateToken, activeToken)) {
          return sendError(res, 401, "Invalid pairing code", "UNAUTHORIZED");
        }

        const gitCheck = await git.checkGitInstalled();
        return sendJson(res, 200, {
          paired: true,
          platform: os.platform(),
          gitInstalled: gitCheck.installed,
          ...(gitCheck.version ? { gitVersion: gitCheck.version } : {}),
        });
      } catch (err: unknown) {
        return sendError(res, 400, (err as Error).message);
      }
    }

    // ── Protected Endpoints: Bearer or Header Authentication ─────────────
    const authHeader = req.headers.authorization;
    const customHeader = req.headers["x-local-agent-token"];
    const candidate = authHeader || (typeof customHeader === "string" ? customHeader : undefined);

    if (!validateToken(candidate, activeToken)) {
      return sendError(res, 401, "Pairing token required or expired", "AUTH_REQUIRED");
    }

    try {
      const body = req.method === "POST" ? await parseBody(req) : {};
      const targetPath = typeof body.path === "string" ? body.path : "";

      switch (pathname) {
        case "/repos/browse": {
          const result = await browseDirectory(typeof body.path === "string" ? body.path : undefined);
          return sendJson(res, 200, result);
        }

        case "/repos/validate": {
          const result = await git.validateRepo(targetPath);
          return sendJson(res, 200, result);
        }

        case "/repos/status": {
          const result = await git.getStatus(targetPath);
          return sendJson(res, 200, { success: true, status: result });
        }

        case "/repos/diff": {
          const filePath = typeof body.filePath === "string" ? body.filePath : undefined;
          const staged = body.staged === true;
          const result = await git.getDiff(targetPath, filePath, staged);
          return sendJson(res, 200, result);
        }

        case "/repos/stage": {
          const files = Array.isArray(body.files) ? (body.files as string[]) : [];
          const result = await git.stage(targetPath, files);
          return sendJson(res, 200, result);
        }

        case "/repos/unstage": {
          const files = Array.isArray(body.files) ? (body.files as string[]) : [];
          const result = await git.unstage(targetPath, files);
          return sendJson(res, 200, result);
        }

        case "/repos/commit": {
          const message = typeof body.message === "string" ? body.message : "";
          const result = await git.commit(targetPath, message);
          return sendJson(res, 200, result);
        }

        case "/repos/branches": {
          const result = await git.listBranches(targetPath);
          return sendJson(res, 200, { branches: result });
        }

        case "/repos/branches/checkout": {
          const branch = typeof body.branch === "string" ? body.branch : "";
          const result = await git.checkoutBranch(targetPath, branch);
          return sendJson(res, 200, result);
        }

        case "/repos/branches/create": {
          const branch = typeof body.branch === "string" ? body.branch : "";
          const result = await git.createBranch(targetPath, branch);
          return sendJson(res, 200, result);
        }

        case "/repos/branches/delete": {
          const branch = typeof body.branch === "string" ? body.branch : "";
          const force = body.force === true;
          const result = await git.deleteBranch(targetPath, branch, force);
          return sendJson(res, 200, result);
        }

        case "/repos/sync/fetch": {
          const remote = typeof body.remote === "string" ? body.remote : "origin";
          const result = await git.syncFetch(targetPath, remote);
          return sendJson(res, 200, result);
        }

        case "/repos/sync/pull": {
          const remote = typeof body.remote === "string" ? body.remote : "origin";
          const branch = typeof body.branch === "string" ? body.branch : undefined;
          const result = await git.syncPull(targetPath, remote, branch);
          return sendJson(res, 200, result);
        }

        case "/repos/sync/push": {
          const remote = typeof body.remote === "string" ? body.remote : "origin";
          const branch = typeof body.branch === "string" ? body.branch : undefined;
          const setUpstream = body.setUpstream === true;
          const result = await git.syncPush(targetPath, remote, branch, setUpstream);
          return sendJson(res, 200, result);
        }

        case "/repos/stash/push": {
          const message = typeof body.message === "string" ? body.message : undefined;
          const result = await git.stashPush(targetPath, message);
          return sendJson(res, 200, result);
        }

        case "/repos/stash/list": {
          const result = await git.stashList(targetPath);
          return sendJson(res, 200, { stashes: result });
        }

        case "/repos/stash/pop": {
          const index = typeof body.index === "number" ? body.index : 0;
          const result = await git.stashPop(targetPath, index);
          return sendJson(res, 200, result);
        }

        case "/repos/stash/apply": {
          const index = typeof body.index === "number" ? body.index : 0;
          const result = await git.stashApply(targetPath, index);
          return sendJson(res, 200, result);
        }

        case "/repos/stash/drop": {
          const index = typeof body.index === "number" ? body.index : 0;
          const result = await git.stashDrop(targetPath, index);
          return sendJson(res, 200, result);
        }

        case "/repos/conflicts": {
          const result = await git.getConflicts(targetPath);
          return sendJson(res, 200, { conflicts: result });
        }

        case "/repos/conflicts/resolve": {
          const filePath = typeof body.filePath === "string" ? body.filePath : "";
          const resolvedContent = typeof body.resolvedContent === "string" ? body.resolvedContent : "";
          const result = await git.resolveConflict(targetPath, filePath, resolvedContent);
          return sendJson(res, 200, result);
        }

        case "/repos/discard": {
          const filePath = typeof body.filePath === "string" ? body.filePath : undefined;
          const result = await git.discard(targetPath, filePath);
          return sendJson(res, 200, result);
        }

        case "/repos/log": {
          const limit = typeof body.limit === "number" ? body.limit : 40;
          const result = await git.getLog(targetPath, limit);
          return sendJson(res, 200, { commits: result });
        }

        case "/repos/fs/read": {
          const filePath = typeof body.filePath === "string" ? body.filePath : "";
          const result = await readFileContent(targetPath, filePath);
          return sendJson(res, 200, result);
        }

        case "/repos/fs/write": {
          const filePath = typeof body.filePath === "string" ? body.filePath : "";
          const content = typeof body.content === "string" ? body.content : "";
          const result = await writeFileContent(targetPath, filePath, content);
          return sendJson(res, 200, result);
        }

        case "/repos/test": {
          const command = typeof body.command === "string" ? body.command : "npm test";
          const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : 120000;
          const result = await runLocalTests(targetPath, command, timeoutMs);
          return sendJson(res, 200, result);
        }

        case "/repos/patch/apply": {
          const changes = Array.isArray(body.changes) ? (body.changes as PatchChange[]) : [];
          const result = await applyPatchChanges(targetPath, changes);
          return sendJson(res, 200, result);
        }

        case "/repos/patch/revert": {
          const backupId = typeof body.backupId === "string" ? body.backupId : "";
          const result = await revertPatchBackup(targetPath, backupId);
          return sendJson(res, 200, result);
        }

        default:
          return sendError(res, 404, `Endpoint '${pathname}' not found`, "NOT_FOUND");
      }
    } catch (err: unknown) {
      return sendError(res, 500, (err as Error).message);
    }
  };

  return {
    start: async (): Promise<{ port: number; token: string }> => {
      const token = await initToken();
      server = http.createServer((req, res) => {
        void handleRequest(req, res);
      });

      return new Promise<{ port: number; token: string }>((resolve, reject) => {
        server?.listen(config.port, config.host, () => {
          resolve({ port: config.port, token });
        });
        server?.on("error", (err) => reject(new Error(err.message, { cause: err })));
      });
    },

    stop: async (): Promise<void> => {
      return new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      });
    },

    getToken: () => activeToken,
  };
}
