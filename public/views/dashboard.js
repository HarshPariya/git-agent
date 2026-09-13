/**
 * Git Debugging Agent — Dashboard View Module
 * Metrics, connected repositories overview, and recent debug sessions
 */

/**
 * Update the navbar connection pill immediately from current repository state.
 * Exposed globally so connect / disconnect flows can refresh it in real time.
 */
function updateServerStatus() {
  const dotEl = document.getElementById("server-status-dot");
  const statusText = document.getElementById("server-status-text");
  const repos = window.state.repositories || [];
  const reposCount = Array.isArray(repos) ? repos.filter((r) => r.status !== "disconnected").length : 0;
  if (reposCount > 0) {
    if (dotEl) dotEl.className = "status-dot online";
    if (statusText) statusText.textContent = "Connected";
  } else {
    if (dotEl) dotEl.className = "status-dot warning";
    if (statusText) statusText.textContent = "No Repos";
  }
}

async function checkHealth() {
  const groqEl = document.getElementById("status-groq");

  try {
    const [health, reposData] = await Promise.allSettled([
      api.getHealth(),
      api.listRepositories(),
    ]);

    if (health.status === "rejected") throw health.reason;

    const repos = reposData.status === "fulfilled" && reposData.value
      ? (reposData.value.repositories || reposData.value || [])
      : [];
    const isEmpty = !Array.isArray(repos) || repos.filter((r) => r.status !== "disconnected").length === 0;

    if (!isEmpty && (!window.state.repositories || window.state.repositories.length === 0)) {
      window.setState("repositories", Array.isArray(repos) ? repos : []);
    }
    updateServerStatus();

    if (groqEl) {
      groqEl.textContent = health.value.modules?.agent === "ready"
        ? "Groq AI / Automated Root-Cause Engine ready"
        : "Ready";
    }
  } catch {
    const dotEl = document.getElementById("server-status-dot");
    const statusText = document.getElementById("server-status-text");
    if (dotEl) dotEl.className = "status-dot error";
    if (statusText) statusText.textContent = "Offline";
  }
}

window.updateServerStatus = updateServerStatus;

async function loadDashboardStats() {
  // Show skeleton loading states
  const statRepos = document.getElementById("stat-repos");
  const statSessions = document.getElementById("stat-sessions");
  const statFixes = document.getElementById("stat-fixes");
  const statRuns = document.getElementById("stat-runs");
  const statChanges = document.getElementById("stat-changes");

  if (statRepos) statRepos.innerHTML = '<div class="skeleton skeleton-text" style="width:40px;height:28px;display:inline-block"></div>';
  if (statSessions) statSessions.innerHTML = '<div class="skeleton skeleton-text" style="width:40px;height:28px;display:inline-block"></div>';
  if (statFixes) statFixes.innerHTML = '<div class="skeleton skeleton-text" style="width:40px;height:28px;display:inline-block"></div>';
  if (statRuns) statRuns.innerHTML = '<div class="skeleton skeleton-text" style="width:40px;height:28px;display:inline-block"></div>';
  if (statChanges) statChanges.textContent = "0 files";

  // Show skeleton for repos
  const reposContainer = document.getElementById("dashboard-repos");
  const sessionsContainer = document.getElementById("dashboard-sessions");
  if (reposContainer) {
    reposContainer.innerHTML = [1, 2, 3].map(() => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--c-border-subtle)">
        <div class="skeleton skeleton-circle" style="width:36px;height:36px;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-text" style="width:70%;height:14px"></div>
          <div class="skeleton skeleton-text" style="width:90%;height:10px;margin-top:6px"></div>
        </div>
      </div>
    `).join("");
  }
  if (sessionsContainer) {
    sessionsContainer.innerHTML = [1, 2, 3].map(() => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--c-border-subtle)">
        <div class="skeleton skeleton-circle" style="width:36px;height:36px;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-text" style="width:80%;height:14px"></div>
          <div class="skeleton skeleton-text" style="width:50%;height:10px;margin-top:6px"></div>
        </div>
      </div>
    `).join("");
  }

  try {
    const [reposData, sessionsData, runsData] = await Promise.allSettled([
      api.listRepositories(),
      api.listDebugSessions(),
      api.listAgentRuns(),
    ]);

    const repos = reposData.status === "fulfilled" && reposData.value ? (reposData.value.repositories || reposData.value) : [];
    const sessions = sessionsData.status === "fulfilled" && sessionsData.value ? (sessionsData.value.sessions || sessionsData.value) : [];
    const runs = runsData.status === "fulfilled" && runsData.value ? (runsData.value.runs || runsData.value) : [];

    const reposCount = Array.isArray(repos) ? repos.length : 0;
    const sessionsCount = Array.isArray(sessions) ? sessions.length : 0;
    const runsCount = Array.isArray(runs) ? runs.length : 0;

    if (statRepos) statRepos.textContent = reposCount;
    if (statSessions) statSessions.textContent = sessionsCount;
    if (statFixes) {
      const resolvedCount = Array.isArray(sessions)
        ? sessions.filter((s) => s.status === "resolved" || s.status === "completed").length
        : 0;
      statFixes.textContent = resolvedCount;
    }
    if (statRuns) statRuns.textContent = runsCount;

    // Fetch real git change counts from connected repos
    const connectedRepos = Array.isArray(repos) ? repos.filter((r) => r.status !== "disconnected") : [];
    if (connectedRepos.length > 0 && statChanges) {
      const statusResults = await Promise.allSettled(
        connectedRepos.map((r) => api.getGitStatus(r.id)),
      );
      let totalChanges = 0;
      for (const result of statusResults) {
        if (result.status === "fulfilled" && result.value?.entries) {
          totalChanges += result.value.entries.length;
        }
      }
      statChanges.textContent = totalChanges > 0 ? `${totalChanges} files` : "0 files";
    } else if (statChanges) {
      statChanges.textContent = "0 files";
    }

    renderDashboardRepos(Array.isArray(repos) ? repos : []);
    renderDashboardSessions(Array.isArray(sessions) ? sessions : []);
  } catch (err) {
    console.error("Error loading dashboard stats:", err);
    if (statRepos) statRepos.textContent = "0";
    if (statSessions) statSessions.textContent = "0";
    if (statFixes) statFixes.textContent = "0";
    if (statRuns) statRuns.textContent = "0";
  }
}

function renderDashboardRepos(repos) {
  const container = document.getElementById("dashboard-repos");
  if (!container) return;

  if (repos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📁</div>
        <div class="empty-title">No repositories connected</div>
        <div class="empty-desc">Connect any local project from your laptop or workspace (Mac, Windows, Linux) or import from GitHub.</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-action="openFolderBrowser">📁 Add Local Folder</button>
          <button class="btn btn-ghost btn-sm" data-action="showGitHubModalFlow">🐙 Connect GitHub</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = repos
    .slice(0, 4)
    .map(
      (r) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--c-border-subtle)">
        <div style="display:flex;align-items:center;gap:10px;overflow:hidden;padding-right:12px;flex:1;min-width:0">
          <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--c-accent-light);color:var(--c-accent);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;border:1px solid var(--c-accent-border)">
            📁
          </div>
          <div style="overflow:hidden;min-width:0">
            <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name || "Repository")}</span>
            </div>
            <div style="font-size:11px;color:var(--c-text-muted);font-family:var(--font-mono);text-overflow:ellipsis;overflow:hidden;white-space:nowrap">
              ${escapeHtml(r.localPath || r.url || "")}
            </div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="quickDebugRepo" data-value="${escapeHtml(r.id)}" style="flex-shrink:0">⚡ Debug</button>
      </div>
    `,
    )
    .join("");
}

function renderDashboardSessions(sessions) {
  const container = document.getElementById("dashboard-sessions");
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No debug sessions yet</div>
        <div class="empty-desc">Start a session to isolate failing code paths and verify fixes.</div>
        <button class="btn btn-primary btn-sm" data-action="navigate" data-value="debug">Start Debugging</button>
      </div>
    `;
    return;
  }

  container.innerHTML = sessions
    .slice(0, 4)
    .map(
      (s) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--c-border-subtle)">
        <div style="display:flex;align-items:center;gap:10px;overflow:hidden;flex:1;min-width:0;padding-right:12px">
          <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--c-bg-tertiary);color:var(--c-text-secondary);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
            🔍
          </div>
          <div style="overflow:hidden;min-width:0">
            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(s.query || s.description || "Debug Task")}
            </div>
            <div style="font-size:11px;color:var(--c-text-muted);display:flex;align-items:center;gap:4px">
              <span>${s.createdAt ? new Date(s.createdAt).toLocaleTimeString() : "Recent"}</span>
              <span style="color:var(--c-border-strong)">·</span>
              <span>${escapeHtml(s.mode || "debug")}</span>
            </div>
          </div>
        </div>
        <span class="badge ${s.status === "completed" || s.status === "resolved" ? "badge-success" : s.status === "failed" ? "badge-danger" : "badge-accent"}" style="flex-shrink:0">
          ${escapeHtml(s.status || "active")}
        </span>
      </div>
    `,
    )
    .join("");
}

// Window exports
window.checkHealth = checkHealth;
window.loadDashboardStats = loadDashboardStats;
window.renderDashboardRepos = renderDashboardRepos;
window.renderDashboardSessions = renderDashboardSessions;
