/**
 * Admin Panel — Cross-user data visibility for admin users.
 * Shows all users, all activity, and per-user detail views in a professional dashboard layout.
 */

/* global window, document */

const ACTIVITY_LABELS = {
  "auth:login": "🔑 Login",
  "auth:register": "📝 Register",
  "auth:google-login": "🔵 Google Login",
  "git:commit": "💾 Git Commit",
  "git:push": "⬆ Git Push",
  "git:pull": "⬇ Git Pull",
  "git:fetch": "🔄 Git Fetch",
  "git:checkout": "🔀 Git Checkout",
  "git:sync": "🔄 Git Sync",
  "git:ship": "🚀 Git Ship",
  "git:analyze-changes": "🔍 Analyze Changes",
  "git:commit-plan-execute": "📋 Commit Plan",
  "git:commit-all": "💾 Commit All",
  "git:generate-message": "💬 Auto-Generate Commit Message",
  "git:resolve-conflicts": "🔧 Resolve Conflicts",
  "debug:run": "🐛 Debug Run",
  "debug:start": "🐛 Debug Start",
  "debug:complete": "✅ Debug Complete",
  "debug:abort": "🚫 Debug Abort",
  "debug:approve-fix": "👍 Approve Fix",
  "debug:revert-fix": "↩ Revert Fix",
  "debug:classify": "🏷 Classify",
  "debug:plan": "📋 Plan",
  "debug:execute-step": "▶ Execute Step",
  "repo:connect": "🔗 Repo Connect",
  "repo:disconnect": "🔗 Repo Disconnect",
  "repo:sync": "🔄 Repo Sync",
  "graphrag:index": "📚 GraphRAG Index",
  "graphrag:search": "🔍 GraphRAG Search",
  "github:connect": "🐙 GitHub Connect",
  "ci:trigger": "🔨 CI Trigger",
  "pr:create": "🔃 PR Create",
};

function formatTimestamp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Render a user avatar. Uses the Google profile picture when available and
 * falls back to a name-initial tile if the picture is missing or fails to load
 * (so the admin panel never shows a broken image icon).
 */
function renderAvatar(user, opts = {}) {
  const size = opts.size || 36;
  const fontSize = opts.fontSize || Math.round(size * 0.38);
  const letter = user.email && (user.name || "") === ""
    ? escapeHtml(user.email[0].toUpperCase())
    : escapeHtml((user.name || user.email || "?")[0]?.toUpperCase() || "?");
  const initials = `<div class="admin-user-avatar" style="background:var(--c-accent-light);display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:600;color:var(--c-accent)">${letter || "?"}</div>`;
  if (!user.picture) return initials;
  const imgStyle = opts.size
    ? `width:${size}px;height:${size}px;border-radius:var(--r-full);object-fit:cover;flex-shrink:0;`
    : "";
  return `<span style="position:relative;display:inline-block;width:${size}px;height:${size}px;border-radius:var(--r-full);flex-shrink:0;overflow:hidden">
      <div class="admin-user-avatar" style="position:absolute;inset:0;background:var(--c-accent-light);display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:600;color:var(--c-accent)">${letter || "?"}</div>
      <img src="${escapeHtml(user.picture)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;background:var(--c-surface)" onerror="this.style.display='none'" loading="lazy" />
    </span>`;
}

function renderUserRow(user) {
  const avatarHtml = renderAvatar(user);
  const roleBadge = user.role === "admin"
    ? '<span class="admin-role-badge admin">admin</span>'
    : `<span class="admin-role-badge developer">${escapeHtml(user.role || "user")}</span>`;

  return `<div class="admin-user-item" data-action="adminViewUser" data-value="${escapeHtml(user.id)}">
    ${avatarHtml}
    <div class="admin-user-info">
      <div class="admin-user-name">${escapeHtml(user.name || "Unnamed")}</div>
      <div class="admin-user-email">${escapeHtml(user.email)}</div>
    </div>
    ${roleBadge}
    <div class="admin-user-date">${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</div>
  </div>`;
}

function formatActivitySummary(entry) {
  const d = entry.details;
  if (!d || typeof d !== "object" || Object.keys(d).length === 0) return "";
  const parts = [];
  if (d.repositoryId) parts.push(`<span class="admin-detail-pill">📁 ${escapeHtml(d.repositoryId)}</span>`);
  if (d.branch) parts.push(`<span class="admin-detail-pill">🌿 ${escapeHtml(d.branch)}</span>`);
  if (d.mode) parts.push(`<span class="admin-detail-pill">⚡ ${escapeHtml(String(d.mode).toUpperCase())}</span>`);
  if (d.status) parts.push(`<span class="badge ${d.status === "completed" || d.status === "success" ? "badge-success" : "badge-secondary"}">${escapeHtml(d.status)}</span>`);
  if (d.message) parts.push(`<span style="color:var(--c-text-muted);font-style:italic">"${escapeHtml(String(d.message).slice(0, 70))}"</span>`);
  if (d.query) parts.push(`<span style="color:var(--c-text-muted)">"${escapeHtml(String(d.query).slice(0, 70))}"</span>`);
  if (!parts.length) {
    const formatted = Object.entries(d)
      .filter(([k]) => k !== "token" && k !== "password" && k !== "secret")
      .slice(0, 3)
      .map(([k, v]) => `<span class="admin-detail-pill">${escapeHtml(k)}: <strong>${escapeHtml(String(v).slice(0, 35))}</strong></span>`)
      .join(" ");
    return formatted;
  }
  return parts.join(" ");
}

function renderActivityRow(entry) {
  const label = ACTIVITY_LABELS[entry.action] || entry.action;
  const summaryHtml = formatActivitySummary(entry);
  return `<div class="admin-activity-item" data-action="adminViewActivity" data-value="${escapeHtml(JSON.stringify({ action: entry.action, userId: entry.userId, email: entry.email, timestamp: entry.timestamp, details: entry.details || {} }))}">
    <div class="admin-activity-top">
      <span class="admin-activity-action">${escapeHtml(label)}</span>
      <span class="admin-activity-time">${formatTimestamp(entry.timestamp)}</span>
    </div>
    <div class="admin-activity-user">
      👤 ${escapeHtml(entry.email || entry.userId)}
    </div>
    ${summaryHtml ? `<div class="admin-activity-detail-pills">${summaryHtml}</div>` : ""}
  </div>`;
}

async function loadAdminPanel() {
  try {
    const [usersResult, activityResult, statsResult, aggregateResult] = await Promise.all([
      window.api.adminListUsers().catch((e) => ({ users: [], total: 0, _error: e.message })),
      window.api.adminGetAllActivity({ limit: 50 }).catch((e) => ({ entries: [], total: 0, _error: e.message })),
      window.api.adminGetStats().catch((e) => ({ stats: {}, _error: e.message })),
      window.api.adminGetAggregateStats().catch((e) => ({ connectedRepos: 0, totalSessions: 0, _error: e.message })),
    ]);

    // Check if all requests failed (likely database or auth issue)
    const allFailed = usersResult._error && activityResult._error && statsResult._error && aggregateResult._error;
    if (allFailed) {
      console.error("[Admin] All admin API calls failed:", usersResult._error);
    }

    // Render stats into the 4 stat cards
    const totalActivities = Object.values(statsResult.stats || {}).reduce((sum, n) => sum + n, 0);
    setTextContent("admin-stat-users", String(usersResult.total ?? usersResult.users?.length ?? 0));
    setTextContent("admin-stat-activities", String(totalActivities));
    setTextContent("admin-stat-repos", String(aggregateResult.connectedRepos ?? 0));
    setTextContent("admin-stat-sessions", String(aggregateResult.totalSessions ?? 0));

    // Update panel counts
    setTextContent("admin-users-count", String(usersResult.total ?? usersResult.users?.length ?? 0));
    setTextContent("admin-activity-count", String(activityResult.total ?? activityResult.entries?.length ?? 0));

    // Render users list
    const usersList = document.getElementById("admin-users-list");
    if (usersList) {
      if (usersResult._error) {
        usersList.innerHTML = `<div class="admin-empty-state"><div class="admin-empty-icon">⚠️</div><div class="admin-empty-text">Unable to load users</div><div class="admin-empty-desc">${escapeHtml(usersResult._error)}</div></div>`;
      } else {
        const users = usersResult.users ?? [];
        if (users.length === 0) {
          usersList.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-icon">👥</div><div class="admin-empty-text">No users found</div></div>';
        } else {
          usersList.innerHTML = users.map(renderUserRow).join("");
        }
      }
    }

    // Render activity feed
    const activityList = document.getElementById("admin-activity-list");
    if (activityList) {
      if (activityResult._error) {
        activityList.innerHTML = `<div class="admin-empty-state"><div class="admin-empty-icon">⚠️</div><div class="admin-empty-text">Unable to load activity</div><div class="admin-empty-desc">${escapeHtml(activityResult._error)}</div></div>`;
      } else {
        const entries = activityResult.entries ?? [];
        if (entries.length === 0) {
          activityList.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-icon">📊</div><div class="admin-empty-text">No activity recorded yet</div></div>';
        } else {
          activityList.innerHTML = entries.map(renderActivityRow).join("");
        }
      }
    }
  } catch (err) {
    console.warn("[ADMIN] Failed to load admin panel:", err);
  }
}

async function adminViewUser(userId) {
  const overlay = document.getElementById("admin-user-detail-overlay");
  const content = document.getElementById("admin-detail-content");
  const title = document.getElementById("admin-detail-title");
  if (!overlay || !content || !title) return;

  overlay.style.display = "flex";
  title.textContent = "Loading user data...";
  content.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-icon">⏳</div><div class="admin-empty-text">Loading...</div></div>';

  try {
    const data = await window.api.adminGetUserData(userId);
    const p = data.profile;
    title.textContent = `${p.name} (${p.email})`;

    const avatarHtml = renderAvatar(p, { size: 56, fontSize: 22 });

    const statsHtml = Object.entries(data.activityStats || {}).map(([action, count]) =>
      `<div class="admin-stat-row">
        <span class="admin-stat-row-label">${escapeHtml(ACTIVITY_LABELS[action] || action)}</span>
        <span class="admin-stat-row-value">${count}</span>
      </div>`,
    ).join("");

    const reposHtml = (data.repositories || []).map((r) =>
      `<div class="admin-stat-row">
        <span class="admin-stat-row-label">📁 ${escapeHtml(r.name)}</span>
        <span class="admin-stat-row-value">${escapeHtml(r.path)}</span>
      </div>`,
    ).join("");

    const sessionsHtml = (data.debugSessions || []).map((s) =>
      `<div class="admin-stat-row">
        <span class="admin-stat-row-label">🐛 ${escapeHtml(s.title || s.id)}</span>
        <span class="admin-role-badge ${s.status === "completed" ? "developer" : "admin"}" style="font-size:10px">${escapeHtml(s.status)}</span>
      </div>`,
    ).join("");

    content.innerHTML = `
      <div class="admin-detail-profile">
        ${avatarHtml}
        <div>
          <div class="admin-detail-name">${escapeHtml(p.name)}</div>
          <div class="admin-detail-email">${escapeHtml(p.email)}</div>
          <div class="admin-detail-meta">Role: ${escapeHtml(p.role)} · Tenant: ${escapeHtml(p.tenantId)} · Joined: ${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</div>
        </div>
      </div>
      <div class="admin-detail-sections">
        <div class="admin-detail-section">
          <div class="admin-detail-section-title">📊 Activity Stats</div>
          ${statsHtml || '<div class="admin-empty-text" style="font-size:12px">No activity</div>'}
        </div>
        <div class="admin-detail-section">
          <div class="admin-detail-section-title">📁 Repositories</div>
          ${reposHtml || '<div class="admin-empty-text" style="font-size:12px">No repositories</div>'}
        </div>
        <div class="admin-detail-section">
          <div class="admin-detail-section-title">🐛 Debug Sessions</div>
          ${sessionsHtml || '<div class="admin-empty-text" style="font-size:12px">No sessions</div>'}
        </div>
      </div>`;
  } catch (err) {
    content.innerHTML = `<div class="admin-empty-state"><div class="admin-empty-icon">⚠️</div><div class="admin-empty-text">Failed to load user data: ${escapeHtml(err.message || "unknown error")}</div></div>`;
  }
}

/** Show/hide the Admin nav item based on user role. */
function updateAdminVisibility(user) {
  const adminNav = document.getElementById("nav-admin");
  const adminPage = document.getElementById("page-admin");
  if (adminNav) adminNav.style.display = user?.role === "admin" ? "" : "none";
  if (adminPage) adminPage.style.display = user?.role === "admin" ? "" : "none";
}

/** Show activity detail modal when clicking an activity entry. */
function adminViewActivity(dataValue) {
  const overlay = document.getElementById("admin-activity-detail-overlay");
  const content = document.getElementById("admin-activity-detail-content");
  const title = document.getElementById("admin-activity-detail-title");
  if (!overlay || !content || !title) return;

  let entry;
  try {
    entry = typeof dataValue === "string" ? JSON.parse(dataValue) : dataValue;
  } catch {
    entry = {};
  }

  const label = ACTIVITY_LABELS[entry.action] || entry.action || "Unknown";
  title.textContent = label;

  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—";
  const details = entry.details && typeof entry.details === "object"
    ? Object.entries(entry.details).map(([k, v]) => `<div class="admin-stat-row"><span class="admin-stat-row-label">${escapeHtml(k)}</span><span class="admin-stat-row-value">${escapeHtml(String(v))}</span></div>`).join("")
    : "";

  content.innerHTML = `
    <div class="admin-detail-sections">
      <div class="admin-detail-section">
        <div class="admin-detail-section-title">📋 Event Info</div>
        <div class="admin-stat-row"><span class="admin-stat-row-label">Action</span><span class="admin-stat-row-value">${escapeHtml(label)}</span></div>
        <div class="admin-stat-row"><span class="admin-stat-row-label">User</span><span class="admin-stat-row-value">${escapeHtml(entry.email || entry.userId || "—")}</span></div>
        <div class="admin-stat-row"><span class="admin-stat-row-label">Timestamp</span><span class="admin-stat-row-value">${escapeHtml(ts)}</span></div>
      </div>
      ${details ? `<div class="admin-detail-section">
        <div class="admin-detail-section-title">🔍 Details</div>
        ${details}
      </div>` : ""}
    </div>`;

  overlay.style.display = "flex";
}

function adminCloseActivityDetail() {
  const overlay = document.getElementById("admin-activity-detail-overlay");
  if (overlay) overlay.style.display = "none";
}

// Expose to global scope (loaded as regular <script>, not type="module")
window.loadAdminPanel = loadAdminPanel;
window.adminViewUser = adminViewUser;
window.adminViewActivity = adminViewActivity;
window.adminCloseActivityDetail = adminCloseActivityDetail;
window.updateAdminVisibility = updateAdminVisibility;
