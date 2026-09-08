/**
 * Git Debugging Agent — Dashboard View Module
 * Metrics, connected repositories overview, and recent debug sessions
 */

async function checkHealth() {
  const groqEl = document.getElementById("status-groq");
  const dotEl = document.getElementById("server-status-dot");
  const statusText = document.getElementById("server-status-text");

  try {
    const health = await api.getHealth();
    if (dotEl) dotEl.className = "status-dot online";
    if (statusText) statusText.textContent = "Connected";

    if (groqEl) {
      groqEl.textContent = health.modules?.agent === "ready"
        ? "Groq AI / Automated Root-Cause Engine ready"
        : "Ready";
    }
  } catch {
    if (dotEl) dotEl.className = "status-dot error";
    if (statusText) statusText.textContent = "Offline";
  }
}

async function loadDashboardStats() {
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

    const statRepos = document.getElementById("stat-repos");
    const statSessions = document.getElementById("stat-sessions");
    const statFixes = document.getElementById("stat-fixes");
    const statRuns = document.getElementById("stat-runs");

    if (statRepos) statRepos.textContent = reposCount;
    if (statSessions) statSessions.textContent = sessionsCount;
    if (statFixes) {
      const resolvedCount = Array.isArray(sessions)
        ? sessions.filter((s) => s.status === "resolved" || s.status === "completed").length
        : 0;
      statFixes.textContent = resolvedCount;
    }
    if (statRuns) statRuns.textContent = runsCount;

    renderDashboardRepos(Array.isArray(repos) ? repos : []);
    renderDashboardSessions(Array.isArray(sessions) ? sessions : []);
  } catch (err) {
    console.error("Error loading dashboard stats:", err);
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
        <div style="overflow:hidden;padding-right:12px">
          <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px">
            <span>${escapeHtml(r.name || "Repository")}</span>
            <span class="badge badge-success">connected</span>
          </div>
          <div style="font-size:11px;color:var(--c-text-muted);font-family:var(--font-mono);text-overflow:ellipsis;overflow:hidden;white-space:nowrap">
            ${escapeHtml(r.localPath || r.url || "")}
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" data-action="quickDebugRepo" data-value="${escapeHtml(r.id)}">⚡ Debug</button>
        </div>
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
        <div style="flex:1;overflow:hidden;padding-right:12px">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escapeHtml(s.query || s.description || "Debug Task")}
          </div>
          <div style="font-size:11px;color:var(--c-text-muted)">
            ${s.createdAt ? new Date(s.createdAt).toLocaleTimeString() : "Recent"} · ${s.mode || "debug"}
          </div>
        </div>
        <span class="badge ${s.status === "completed" || s.status === "resolved" ? "badge-success" : s.status === "failed" ? "badge-danger" : "badge-accent"}">
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
