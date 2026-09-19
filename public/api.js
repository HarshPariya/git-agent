/**
 * Git Debugging Agent - API Client
 * Clean HTTP client for all backend endpoints
 */

const API_BASE =
  (typeof window !== "undefined" && window.__API_BASE__) ||
  (typeof window !== "undefined" && localStorage.getItem("gda_api_base")) ||
  "";

class ApiClient {
  constructor() {
    this.token = localStorage.getItem("gda_token") || null;
    this.user = JSON.parse(localStorage.getItem("gda_user") || "null");
    this.activeControllers = new Map();
    this.DEFAULT_TIMEOUT = 30000; // 30 seconds
  }

  setToken(token, user) {
    this.token = token;
    this.user = user;
    if (token) {
      localStorage.setItem("gda_token", token);
    } else {
      localStorage.removeItem("gda_token");
    }
    if (user) {
      localStorage.setItem("gda_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("gda_user");
    }
  }

  clearToken() {
    this.setToken(null, null);
  }

  // Cancel a specific request by endpoint
  cancelRequest(endpoint) {
    const controller = this.activeControllers.get(endpoint);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(endpoint);
    }
  }

  // Cancel all active requests
  cancelAllRequests() {
    for (const [endpoint, controller] of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  getHeaders(extraHeaders = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    } else if (localStorage.getItem("gda_dev_mode") === "true") {
      // Dev-mode: only send identity headers when explicitly opted in
      headers["x-tenant-id"] = "tenant-default";
      headers["x-user-id"] = "user-default";
      headers["x-user-role"] = "developer";
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = this.getHeaders(options.headers);

    // Create AbortController for this request
    const controller = new AbortController();
    this.activeControllers.set(endpoint, controller);

    const config = { ...options, headers, signal: controller.signal };

    // Set timeout to abort after 30 seconds
    const timeoutId = setTimeout(() => {
      controller.abort();
      this.activeControllers.delete(endpoint);
    }, this.DEFAULT_TIMEOUT);

    try {
      const response = await fetch(url, config);
      clearTimeout(timeoutId);
      this.activeControllers.delete(endpoint);

      if (response.status === 401 && this.token) {
        this.clearToken();
        window.location.reload();
      }

      const contentType = response.headers.get("content-type") || "";
      let data;
      try {
        data = contentType.includes("application/json")
          ? await response.json()
          : await response.text();
      } catch (e) {
        data = null;
      }

      if (!response.ok) {
        const message = (data?.error?.message || data?.error || data?.message) || `Request failed (${response.status})`;
        const err = new Error(message);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      this.activeControllers.delete(endpoint);
      if (err.name === 'AbortError') {
        console.warn(`Request aborted: ${endpoint}`);
        return null;
      }
      console.error(`API Error [${options.method || "GET"} ${endpoint}]:`, err);
      throw err;
    }
  }

  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: "GET" });
  }

  async post(endpoint, body = {}, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async put(endpoint, body = {}, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: "DELETE" });
  }

  // Auth
  async login(email, password) {
    const data = await this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token, data.user);
    return data;
  }

  async register(email, password, name = "") {
    const data = await this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
    this.setToken(data.token, data.user);
    return data;
  }

  async getMe() {
    return this.request("/api/auth/me");
  }

  async googleLogin(credential) {
    const data = await this.request("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    this.setToken(data.token, data.user);
    return data;
  }

  async getGoogleClientId() {
    return this.request("/api/auth/google-client-id");
  }

  // Health & Info
  async getHealth() { return this.request("/health"); }
  async getReadiness() { return this.request("/ready"); }
  async getInfo() { return this.request("/api/info"); }

  // Repositories
  async listRepositories() { return this.request("/api/repositories"); }
  async getRepositories() { return this.listRepositories(); }
  async connectRepository(data) {
    return this.request("/api/repositories/connect", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
  async getRepository(id) { return this.request(`/api/repositories/${id}`); }
  async browseFilesystem(targetPath = "") {
    const q = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
    return this.request(`/api/fs/browse${q}`);
  }
  async syncRepository(id) {
    return this.request(`/api/repositories/${id}/sync`, { method: "POST" });
  }
  async disconnectRepository(id) {
    return this.request(`/api/repositories/${id}/disconnect`, { method: "POST" });
  }
  async getRepositoryStatus(id) { return this.request(`/api/repositories/${id}/status`); }
  async listProtectedBranches(id) { return this.request(`/api/repositories/${id}/protected-branches`); }
  async addProtectedBranch(id, branch, rules = {}) {
    return this.request(`/api/repositories/${id}/protected-branches`, {
      method: "POST",
      body: JSON.stringify({ branch, ...rules }),
    });
  }
  async removeProtectedBranch(id, branch) {
    return this.request(`/api/repositories/${id}/protected-branches/${encodeURIComponent(branch)}`, { method: "DELETE" });
  }

  // Debug Agent
  async listDebugSessions() { return this.request("/api/debug"); }
  async listAgentRuns() { return this.request("/api/agent/runs"); }
  async startDebugSession(data) {
    return this.request("/api/debug", { method: "POST", body: JSON.stringify(data) });
  }
  async runDebug(data) {
    return this.request("/api/debug/run", { method: "POST", body: JSON.stringify(data) });
  }
  async getDebugSession(sessionId) { return this.request(`/api/debug/${sessionId}`); }
  async getSessionFindings(sessionId) { return this.request(`/api/debug/${sessionId}/findings`); }
  async executeDebugStep(sessionId, stepType, description, query = "") {
    return this.request(`/api/debug/${sessionId}/steps`, {
      method: "POST",
      body: JSON.stringify({ stepType, description, query }),
    });
  }
  async completeDebugSession(sessionId) {
    return this.request(`/api/debug/${sessionId}/complete`, { method: "POST" });
  }
  async abortDebugSession(sessionId) {
    return this.request(`/api/debug/${sessionId}/abort`, { method: "POST" });
  }

  // Git Engine
  async getGitStatus(repositoryId) {
    return this.request("/api/git/status", { method: "POST", body: JSON.stringify({ repositoryId }) });
  }
  async getGitLog(repositoryId, maxCount = 10) {
    return this.request("/api/git/log", {
      method: "POST",
      body: JSON.stringify({ repositoryId, maxCount }),
    });
  }
  async getGitDiff(repositoryId, filePath = "", staged = false) {
    return this.request("/api/git/diff", {
      method: "POST",
      body: JSON.stringify({ repositoryId, filePath, staged }),
    });
  }
  async getGitBranches(repositoryId) {
    return this.request("/api/git/branches", { method: "POST", body: JSON.stringify({ repositoryId }) });
  }
  async getGitConflicts(repositoryId) {
    return this.request("/api/git/conflicts", { method: "POST", body: JSON.stringify({ repositoryId }) });
  }
  async getOperationCatalog() { return this.request("/api/git/catalog"); }

  async analyzeChanges(repositoryId, changedFiles = null) {
    return this.request("/api/git/analyze-changes", {
      method: "POST",
      body: JSON.stringify({ repositoryId, ...(changedFiles ? { changedFiles } : {}) }),
    });
  }
  async executeCommitPlan(repositoryId, groups) {
    return this.request("/api/git/commit-plan/execute", {
      method: "POST",
      body: JSON.stringify({ repositoryId, groups }),
    });
  }
  async commitAll(repositoryId) {
    return this.request("/api/git/commit-all", {
      method: "POST",
      body: JSON.stringify({ repositoryId }),
    });
  }
  async gitCommit(repositoryId, message, stageAll = true, files = null) {
    return this.request("/api/git/commit", {
      method: "POST",
      body: JSON.stringify({ repositoryId, message, stageAll, ...(files ? { files } : {}) }),
    });
  }
  async stageFile(repositoryId, filePath) {
    return this.request("/api/git/stage", {
      method: "POST",
      body: JSON.stringify({ repositoryId, filePath }),
    });
  }
  async unstageFile(repositoryId, filePath) {
    return this.request("/api/git/unstage", {
      method: "POST",
      body: JSON.stringify({ repositoryId, filePath }),
    });
  }
  async stageAll(repositoryId) {
    return this.request("/api/git/stage-all", {
      method: "POST",
      body: JSON.stringify({ repositoryId }),
    });
  }
  async unstageAll(repositoryId) {
    return this.request("/api/git/unstage-all", {
      method: "POST",
      body: JSON.stringify({ repositoryId }),
    });
  }
  async discardGitChanges(repositoryId, filePath = null) {
    return this.request("/api/git/discard", {
      method: "POST",
      body: JSON.stringify({ repositoryId, ...(filePath ? { filePath } : {}) }),
    });
  }
  async syncGitFile(repositoryId, filePath, content = "", action = "write") {
    return this.request("/api/git/sync-file", {
      method: "POST",
      body: JSON.stringify({ repositoryId, filePath, content, action }),
    });
  }
  async syncGitWorkspace(repositoryId, files, commitBaseline = false) {
    return this.request("/api/git/sync-workspace", {
      method: "POST",
      body: JSON.stringify({ repositoryId, files, commitBaseline }),
    });
  }
  async commitBaseline(repositoryId) {
    return this.request("/api/git/commit-baseline", {
      method: "POST",
      body: JSON.stringify({ repositoryId }),
    });
  }
  // Alias used by the debug view's "Commit & Push Fix" (returns {success, commitHash, message})
  async commitChanges(repositoryId, message) {
    return this.request("/api/git/commit", {
      method: "POST",
      body: JSON.stringify({ repositoryId, message, stageAll: true }),
    });
  }
  async generateCommitMessage(repositoryId) {
    return this.request("/api/git/generate-commit-message", {
      method: "POST",
      body: JSON.stringify({ repositoryId }),
    });
  }
  async checkoutBranch(repositoryId, branch, create = false) {
    return this.request("/api/git/checkout", {
      method: "POST",
      body: JSON.stringify({ repositoryId, branch, create }),
    });
  }
  async gitFetch(repositoryId, remote = "origin") {
    const gitHubToken = localStorage.getItem("gda_github_pat") || undefined;
    return this.request("/api/git/fetch", {
      method: "POST",
      body: JSON.stringify({
        repositoryId,
        remote,
        ...(gitHubToken ? { gitHubToken } : {}),
      }),
    });
  }
  async gitPull(repositoryId, remote = "origin", branch = "") {
    const gitHubToken = localStorage.getItem("gda_github_pat") || undefined;
    return this.request("/api/git/pull", {
      method: "POST",
      body: JSON.stringify({
        repositoryId,
        remote,
        branch,
        ...(gitHubToken ? { gitHubToken } : {}),
      }),
    });
  }
  async gitPush(repositoryId, remote = "origin", branch = "", setUpstream = true, forceWithLease = false) {
    const gitHubToken = localStorage.getItem("gda_github_pat") || undefined;
    return this.request("/api/git/push", {
      method: "POST",
      body: JSON.stringify({
        repositoryId,
        remote,
        branch,
        setUpstream,
        forceWithLease,
        ...(gitHubToken ? { gitHubToken } : {}),
      }),
    });
  }
  async gitSync(repositoryId, remote = "origin") {
    return this.request("/api/git/sync", {
      method: "POST",
      body: JSON.stringify({ repositoryId, remote }),
    });
  }
  async gitShip(repositoryId, targetBranch = "main", prTitle = "") {
    const gitHubToken = localStorage.getItem("gda_github_pat") || undefined;
    return this.request("/api/git/ship", {
      method: "POST",
      body: JSON.stringify({
        repositoryId,
        targetBranch,
        prTitle,
        ...(gitHubToken ? { gitHubToken } : {}),
      }),
    });
  }
  async resolveConflicts(repositoryId, filePath) {
    const body = { repositoryId };
    if (filePath) body.filePath = filePath;
    return this.request("/api/git/conflicts/resolve", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  async gitStash(repositoryId, message = "WIP stash from Git Agent") {
    return this.request("/api/git/stash", {
      method: "POST",
      body: JSON.stringify({ repositoryId, message }),
    });
  }
  async gitDeleteBranch(repositoryId, branch, force = false) {
    return this.request("/api/git/branch/delete", {
      method: "POST",
      body: JSON.stringify({ repositoryId, branch, force }),
    });
  }

  // GraphRAG
  async indexRepository(repositoryId) {
    return this.request("/api/graphrag/index", { method: "POST", body: JSON.stringify({ repositoryId }) });
  }
  async getGraph(repositoryId) { return this.request(`/api/graphrag/${repositoryId}/graph`); }
  async searchCode(repositoryId, query, limit = 10) {
    return this.request("/api/graphrag/search", { method: "POST", body: JSON.stringify({ repositoryId, query, limit }) });
  }
  async getSymbols(repositoryId, query) {
    return this.request("/api/graphrag/symbols", { method: "POST", body: JSON.stringify({ repositoryId, query }) });
  }
  async getIndexStatus(repositoryId) { return this.request(`/api/graphrag/${repositoryId}/status`); }

  // GitHub
  async connectGitHub(token) { return this.request("/api/github/connect", { method: "POST", body: JSON.stringify({ token }) }); }
  async disconnectGitHub() { return this.request("/api/github/connect", { method: "DELETE" }); }
  async getGitHubStatus() { return this.request("/api/github/status"); }
  async listGitHubRepos(options = {}) {
    const params = new URLSearchParams(options);
    return this.request(`/api/github/repos?${params.toString()}`);
  }
  async getGitHubRepo(owner, repo) { return this.request(`/api/github/repos/${owner}/${repo}`); }
  async listGitHubBranches(owner, repo) { return this.request(`/api/github/repos/${owner}/${repo}/branches`); }
  async listGitHubIssues(owner, repo, options = {}) {
    const params = new URLSearchParams(options);
    return this.request(`/api/github/repos/${owner}/${repo}/issues?${params.toString()}`);
  }
  async getGitHubIssue(owner, repo, number) { return this.request(`/api/github/repos/${owner}/${repo}/issues/${number}`); }
  async listGitHubPRs(owner, repo, options = {}) {
    const params = new URLSearchParams(options);
    return this.request(`/api/github/repos/${owner}/${repo}/pulls?${params.toString()}`);
  }
  async getGitHubPR(owner, repo, number) { return this.request(`/api/github/repos/${owner}/${repo}/pulls/${number}`); }
  async createGitHubPR(owner, repo, data) {
    return this.request(`/api/github/repos/${owner}/${repo}/pulls`, { method: "POST", body: JSON.stringify(data) });
  }

  // Workflows
  async listCiBuilds(repositoryId) {
    const q = repositoryId ? `?repositoryId=${encodeURIComponent(repositoryId)}` : "";
    return this.request(`/api/ci${q}`);
  }
  async listPullRequests(repositoryId) {
    const q = repositoryId ? `?repositoryId=${encodeURIComponent(repositoryId)}` : "";
    return this.request(`/api/pr${q}`);
  }
  async createPR(repositoryId, title, sourceBranch, targetBranch = "main", description = "") {
    return this.request("/api/pr", {
      method: "POST",
      body: JSON.stringify({ repositoryId, title, sourceBranch, targetBranch, description }),
    });
  }
  async getAuditLog(limit = 50) { return this.request(`/api/audit?limit=${limit}`); }
  async runBisect(data) { return this.request("/api/bisect", { method: "POST", body: JSON.stringify(data) }); }
  async classifyTask(query) { return this.request("/api/debug/classify", { method: "POST", body: JSON.stringify({ query }) }); }
  async planTask(query, repositoryId) { return this.request("/api/debug/plan", { method: "POST", body: JSON.stringify({ query, repositoryId }) }); }
  async approveFix(sessionId) { return this.request(`/api/debug/${sessionId}/fix/approve`, { method: "POST" }); }
  async revertFix(sessionId, backupId) {
    return this.request(`/api/debug/${sessionId}/fix/revert`, { method: "POST", body: JSON.stringify({ backupId }) });
  }
  async pushChanges(repositoryId, options = {}) {
    return this.request("/api/git/push", { method: "POST", body: JSON.stringify({ repositoryId, ...options }) });
  }
  async pullChanges(repositoryId, options = {}) {
    return this.request("/api/git/pull", { method: "POST", body: JSON.stringify({ repositoryId, ...options }) });
  }
  async fetchChanges(repositoryId, options = {}) {
    return this.request("/api/git/fetch", { method: "POST", body: JSON.stringify({ repositoryId, ...options }) });
  }

  // Async debug run - returns sessionId immediately, pipeline runs in background
  async runDebugAsync(data) {
    return this.request("/api/debug/run-async", { method: "POST", body: JSON.stringify(data) });
  }

  // Filesystem & Local Folders
  async resolveFolder(folderName, sampleFiles = [], currentBrowsedPath = "") {
    return this.request("/api/fs/resolve-folder", {
      method: "POST",
      body: JSON.stringify({ folderName, sampleFiles, currentBrowsedPath }),
    });
  }

  async pickNativeFolderDialog() {
    return this.request("/api/fs/pick-native-dialog", {
      method: "POST",
    });
  }

  async openInOs(filePath, repositoryId = "", mode = "reveal") {
    return this.request("/api/fs/open-in-os", {
      method: "POST",
      body: JSON.stringify({ filePath, repositoryId, mode }),
    });
  }

  // Git Stash Management
  async gitStashList(repositoryId) {
    return this.request(`/api/git/stash?repositoryId=${encodeURIComponent(repositoryId)}`);
  }
  async gitStashPush(repositoryId, message = "") {
    return this.request("/api/git/stash", {
      method: "POST",
      body: JSON.stringify({ repositoryId, message }),
    });
  }
  async gitStashPop(repositoryId, index = 0) {
    return this.request("/api/git/stash/pop", {
      method: "POST",
      body: JSON.stringify({ repositoryId, index }),
    });
  }
  async gitStashDrop(repositoryId, index = 0) {
    return this.request("/api/git/stash/drop", {
      method: "POST",
      body: JSON.stringify({ repositoryId, index }),
    });
  }
  async gitStashDiff(repositoryId, index = 0) {
    return this.request(`/api/git/stash/diff?repositoryId=${encodeURIComponent(repositoryId)}&index=${index}`);
  }

  // Hunk & File Staging / Discarding
  async gitStageHunk(repositoryId, patch) {
    return this.request("/api/git/stage-hunk", {
      method: "POST",
      body: JSON.stringify({ repositoryId, patch }),
    });
  }
  async gitDiscardHunk(repositoryId, patch) {
    return this.request("/api/git/discard-hunk", {
      method: "POST",
      body: JSON.stringify({ repositoryId, patch }),
    });
  }
  async gitDiscardFile(repositoryId, filePath, staged = false) {
    return this.request("/api/git/discard-file", {
      method: "POST",
      body: JSON.stringify({ repositoryId, filePath, staged }),
    });
  }

  // Undo Last Commit (Soft Reset)
  async gitUndoCommit(repositoryId, force = false) {
    return this.request("/api/git/commit/undo", {
      method: "POST",
      body: JSON.stringify({ repositoryId, force }),
    });
  }

  // Visual DAG Graph
  async gitLogGraph(repositoryId, limit = 50) {
    return this.request(`/api/git/graph?repositoryId=${encodeURIComponent(repositoryId)}&limit=${limit}`);
  }

  // Secrets Scanner
  async gitScanSecrets(repositoryId, content = "", filePath = "") {
    return this.request("/api/git/scan-secrets", {
      method: "POST",
      body: JSON.stringify({ repositoryId, content, filePath }),
    });
  }

  // AI Debugging - Steer & Custom Patch & Export
  async debugSteer(sessionId, guidance) {
    return this.request(`/api/debug/${encodeURIComponent(sessionId)}/steer`, {
      method: "POST",
      body: JSON.stringify({ guidance }),
    });
  }
  async debugApproveCustomFix(sessionId, customFiles) {
    return this.request(`/api/debug/${encodeURIComponent(sessionId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ customFiles }),
    });
  }
  async debugExportMarkdown(sessionId, download = false) {
    return this.request(`/api/debug/${encodeURIComponent(sessionId)}/export/markdown${download ? "?download=true" : ""}`);
  }


  // Real-time SSE — EventSource cannot send custom headers, so auth is passed as query params
  streamSession(sessionId, onEvent, onError) {
    let url = `${API_BASE}/api/debug/${sessionId}/stream`;
    if (this.token) {
      url += `?token=${encodeURIComponent(this.token)}`;
    } else if (localStorage.getItem("gda_dev_mode") === "true") {
      url += `?x-tenant-id=tenant-default&x-user-id=user-default`;
    }
    const eventSource = new EventSource(url);
    eventSource.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch (err) { console.error("SSE parse error", err); }
    };
    eventSource.onerror = (err) => { if (onError) onError(err); };
    return eventSource;
  }

  // Admin API
  async adminListUsers() { return this.request("/api/admin/users"); }
  async adminGetAllActivity(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/admin/activity${q ? `?${q}` : ""}`);
  }
  async adminGetUserActivity(userId, params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/admin/activity/${encodeURIComponent(userId)}${q ? `?${q}` : ""}`);
  }
  async adminGetStats(userId) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.request(`/api/admin/stats${q}`);
  }
  async adminGetUserData(userId) {
    return this.request(`/api/admin/user-data/${encodeURIComponent(userId)}`);
  }
  async adminGetAggregateStats() {
    return this.request("/api/admin/aggregate-stats");
  }

  // User activity (non-admin users seeing their own data)
  async userMyActivity(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/user/activity${q ? `?${q}` : ""}`);
  }
}

window.api = new ApiClient();
