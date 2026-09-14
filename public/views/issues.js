/**
 * Git Debugging Agent — Issues View Module
 * List repository issues and 1-click launch AI debug investigation
 */

async function loadIssues() {
  const repoSelect = document.getElementById("issues-repo-select");
  const stateFilter = document.getElementById("issues-state-filter");
  const container = document.getElementById("issues-list");
  if (!container) return;

  const repoId = repoSelect?.value || window.state?.activeRepository?.id;
  const stateVal = stateFilter?.value || "open";

  if (!repoId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Select a repository</div>
        <div class="empty-desc">Choose a connected repository to view its issues.</div>
      </div>
    `;
    return;
  }

  const repo = (window.state.repositories || []).find((r) => r.id === repoId) || window.state.activeRepository;
  container.innerHTML = [1, 2, 3].map(() => `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--c-border-subtle)">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div class="skeleton skeleton-text" style="width:40px;height:14px"></div>
          <div class="skeleton skeleton-text" style="width:200px;height:14px"></div>
          <div class="skeleton" style="width:48px;height:18px;border-radius:var(--r-full)"></div>
        </div>
        <div class="skeleton skeleton-text" style="width:140px;height:12px"></div>
      </div>
      <div class="skeleton" style="width:100px;height:28px;border-radius:var(--r-sm)"></div>
    </div>
  `).join("");

  try {
    let issues = [];
    if (window.state.gitHubConnected && repo && repo.url && repo.url.includes("github.com")) {
      const match = repo.url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (match) {
        const [, owner, repoName] = match;
        issues = await api.listGitHubIssues(owner, repoName, { state: stateVal });
      }
    }

    if (!Array.isArray(issues) || issues.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">No ${escapeHtml(stateVal)} issues</div>
          <div class="empty-desc">There are no matching issues for this repository.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = issues
      .map(
        (issue) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--c-border-subtle);gap:16px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
              <span style="font-weight:700;font-family:var(--font-mono);font-size:13px;color:var(--c-text-muted)">#${issue.number}</span>
              <span style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(issue.title)}</span>
              <span class="badge ${issue.state === "open" ? "badge-success" : "badge-secondary"}" style="text-transform:capitalize">${escapeHtml(issue.state)}</span>
            </div>
            <div style="font-size:12px;color:var(--c-text-muted);display:flex;align-items:center;gap:6px">
              <span>Opened by <strong>${escapeHtml(issue.user || "author")}</strong></span>
              ${issue.createdAt ? `<span style="color:var(--c-border-strong)">·</span><span>${new Date(issue.createdAt).toLocaleDateString()}</span>` : ""}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" data-action="debugIssue" data-value="${escapeHtml(repoId)}" data-extra="${escapeHtml(issue.title)}" style="flex-shrink:0">
            ⚡ Debug
          </button>
        </div>
      `,
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px">Failed to load issues: ${escapeHtml(err.message)}</div>`;
  }
}

function debugIssue(repoId, issueTitle) {
  navigate("debug");
  const repoSelect = document.getElementById("debug-repo");
  const descEl = document.getElementById("debug-description");
  if (repoSelect) repoSelect.value = repoId;
  if (descEl) descEl.value = `Investigate and fix issue: ${issueTitle}`;
}

// Event delegation for data-action attributes
const ISSUE_ACTIONS = {
  debugIssue: (value, extra) => debugIssue(value, extra),
};

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, value, extra } = target.dataset;
  ISSUE_ACTIONS[action]?.(value, extra);
});

// Window exports
window.loadIssues = loadIssues;
window.debugIssue = debugIssue;
