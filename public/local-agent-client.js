/**
 * Git-Agent — Local Companion Client Library
 * Handles communication between the Vercel/web frontend and the local agent running on the user's PC (127.0.0.1:41732).
 */

/* global window, localStorage, fetch */

class LocalAgentClient {
  constructor() {
    this.defaultPort = 41732;
    this.baseUrl = localStorage.getItem("gda_local_agent_url") || `http://127.0.0.1:${this.defaultPort}`;
    this.token = localStorage.getItem("gda_local_agent_token") || "";
    this.activeRepoPath = localStorage.getItem("gda_local_repo_path") || "";
    this.isOnline = false;
    this.gitInstalled = false;
    this.gitVersion = "";
    this.platform = "";
    this.listeners = new Set();
  }

  setBaseUrl(url) {
    this.baseUrl = (url || `http://127.0.0.1:${this.defaultPort}`).replace(/\/+$/, "");
    localStorage.setItem("gda_local_agent_url", this.baseUrl);
    this.notify();
  }

  setToken(token) {
    this.token = (token || "").trim();
    if (this.token) {
      localStorage.setItem("gda_local_agent_token", this.token);
    } else {
      localStorage.removeItem("gda_local_agent_token");
    }
    this.notify();
  }

  setActiveRepoPath(repoPath) {
    this.activeRepoPath = (repoPath || "").trim();
    if (this.activeRepoPath) {
      localStorage.setItem("gda_local_repo_path", this.activeRepoPath);
    } else {
      localStorage.removeItem("gda_local_repo_path");
    }
    this.notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener({
          isOnline: this.isOnline,
          gitInstalled: this.gitInstalled,
          gitVersion: this.gitVersion,
          hasToken: Boolean(this.token),
          activeRepoPath: this.activeRepoPath,
        });
      } catch (err) {
        console.error("Local agent listener error:", err);
      }
    }
  }

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        this.isOnline = true;
        this.gitInstalled = Boolean(data.gitInstalled);
        this.gitVersion = data.gitVersion || "";
        this.platform = data.platform || "";
        this.notify();
        return { online: true, ...data };
      }
      this.isOnline = false;
      this.notify();
      return { online: false, error: `HTTP ${res.status}` };
    } catch (err) {
      this.isOnline = false;
      this.notify();
      return { online: false, error: err.message || "Connection refused" };
    }
  }

  async pair(candidateToken) {
    const tokenToTest = (candidateToken || this.token).trim();
    if (!tokenToTest) throw new Error("Pairing code cannot be empty");

    const res = await fetch(`${this.baseUrl}/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ token: tokenToTest }),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Pairing failed: invalid code");
    }

    this.setToken(tokenToTest);
    this.isOnline = true;
    return data;
  }

  async request(endpoint, payload = {}) {
    if (!this.token) {
      throw new Error("Local Agent pairing code required. Please connect in settings or the Local PC banner.");
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "X-Local-Agent-Token": this.token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Local Agent request failed (${res.status})`);
      err.code = data.code || "LOCAL_AGENT_ERROR";
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── Filesystem & Validation ──────────────────────────────────────────

  async browse(dirPath = "") {
    return this.request("/repos/browse", { path: dirPath });
  }

  async validateRepo(repoPath) {
    return this.request("/repos/validate", { path: repoPath });
  }

  // ── Git Desktop Operations ───────────────────────────────────────────

  async getStatus(repoPath = this.activeRepoPath) {
    const res = await this.request("/repos/status", { path: repoPath });
    return res.status;
  }

  async getDiff(filePath, staged = false, repoPath = this.activeRepoPath) {
    return this.request("/repos/diff", { path: repoPath, filePath, staged });
  }

  async stage(files = [], repoPath = this.activeRepoPath) {
    return this.request("/repos/stage", { path: repoPath, files });
  }

  async unstage(files = [], repoPath = this.activeRepoPath) {
    return this.request("/repos/unstage", { path: repoPath, files });
  }

  async commit(message, repoPath = this.activeRepoPath) {
    return this.request("/repos/commit", { path: repoPath, message });
  }

  async listBranches(repoPath = this.activeRepoPath) {
    const res = await this.request("/repos/branches", { path: repoPath });
    return res.branches || [];
  }

  async checkoutBranch(branch, repoPath = this.activeRepoPath) {
    return this.request("/repos/branches/checkout", { path: repoPath, branch });
  }

  async createBranch(branch, repoPath = this.activeRepoPath) {
    return this.request("/repos/branches/create", { path: repoPath, branch });
  }

  async deleteBranch(branch, force = false, repoPath = this.activeRepoPath) {
    return this.request("/repos/branches/delete", { path: repoPath, branch, force });
  }

  async syncFetch(remote = "origin", repoPath = this.activeRepoPath) {
    return this.request("/repos/sync/fetch", { path: repoPath, remote });
  }

  async syncPull(remote = "origin", branch, repoPath = this.activeRepoPath) {
    return this.request("/repos/sync/pull", { path: repoPath, remote, branch });
  }

  async syncPush(remote = "origin", branch, setUpstream = false, repoPath = this.activeRepoPath) {
    return this.request("/repos/sync/push", { path: repoPath, remote, branch, setUpstream });
  }

  async stashPush(message, repoPath = this.activeRepoPath) {
    return this.request("/repos/stash/push", { path: repoPath, message });
  }

  async stashList(repoPath = this.activeRepoPath) {
    const res = await this.request("/repos/stash/list", { path: repoPath });
    return res.stashes || [];
  }

  async stashPop(index = 0, repoPath = this.activeRepoPath) {
    return this.request("/repos/stash/pop", { path: repoPath, index });
  }

  async stashApply(index = 0, repoPath = this.activeRepoPath) {
    return this.request("/repos/stash/apply", { path: repoPath, index });
  }

  async stashDrop(index = 0, repoPath = this.activeRepoPath) {
    return this.request("/repos/stash/drop", { path: repoPath, index });
  }

  async getConflicts(repoPath = this.activeRepoPath) {
    const res = await this.request("/repos/conflicts", { path: repoPath });
    return res.conflicts || [];
  }

  async resolveConflict(filePath, resolvedContent, repoPath = this.activeRepoPath) {
    return this.request("/repos/conflicts/resolve", { path: repoPath, filePath, resolvedContent });
  }

  async discard(filePath, repoPath = this.activeRepoPath) {
    return this.request("/repos/discard", { path: repoPath, filePath });
  }

  async getLog(limit = 40, repoPath = this.activeRepoPath) {
    const res = await this.request("/repos/log", { path: repoPath, limit });
    return res.commits || [];
  }

  async readFile(filePath, repoPath = this.activeRepoPath) {
    return this.request("/repos/fs/read", { path: repoPath, filePath });
  }

  async writeFile(filePath, content, repoPath = this.activeRepoPath) {
    return this.request("/repos/fs/write", { path: repoPath, filePath, content });
  }

  // ── Local AI Debugging Capabilities ──────────────────────────────────

  async runTests(command = "npm test", timeoutMs = 120000, repoPath = this.activeRepoPath) {
    return this.request("/repos/test", { path: repoPath, command, timeoutMs });
  }

  async applyPatch(changes = [], repoPath = this.activeRepoPath) {
    return this.request("/repos/patch/apply", { path: repoPath, changes });
  }

  async revertPatch(backupId, repoPath = this.activeRepoPath) {
    return this.request("/repos/patch/revert", { path: repoPath, backupId });
  }
}

// Attach singleton to window
window.localAgentClient = new LocalAgentClient();
