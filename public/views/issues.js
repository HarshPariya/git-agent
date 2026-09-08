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
  container.innerHTML = `<div class="text-muted" style="text-align:center;padding:24px"><div class="spinner"></div><div style="margin-top:8px">Loading issues...</div></div>`;

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
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--c-border-subtle)">
          <div style="flex:1;padding-right:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-weight:700;color:var(--c-text-muted)">#${issue.number}</span>
              <span style="font-weight:600;font-size:14px">${escapeHtml(issue.title)}</span>
              <span class="badge ${issue.state === "open" ? "badge-success" : "badge-secondary"}">${escapeHtml(issue.state)}</span>
            </div>
            <div style="font-size:12px;color:var(--c-text-muted)">
              Opened by ${escapeHtml(issue.user || "author")} ${issue.createdAt ? "on " + new Date(issue.createdAt).toLocaleDateString() : ""}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" data-action="debugIssue" data-value="${escapeHtml(repoId)}" data-extra="${escapeHtml(issue.title)}">
            ⚡ Debug Issue
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
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;
  const extra = target.dataset.extra;
  if (action === 'debugIssue') debugIssue(value, extra);
});

// Window exports
window.loadIssues = loadIssues;
window.debugIssue = debugIssue;
