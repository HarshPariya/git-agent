/**
 * Git Debugging Agent — Diff Viewer Component
 * Executive post-push summary state view.
 */

// Uses window.escapeHtml from app.js

async function renderPushSummaryView(remote, targetBranch, rawOutput = "") {
  const repo = window.state?.activeRepository;
  const pathEl = document.getElementById("gd-diff-filepath");
  const metaEl = document.getElementById("gd-diff-meta");
  const statusBadge = document.getElementById("gd-diff-status-badge");
  const viewer = document.getElementById("gd-diff-viewer");

  if (pathEl) pathEl.textContent = `Pushed to origin/${targetBranch}`;
  if (statusBadge) {
    statusBadge.textContent = "Synced";
    statusBadge.className = "badge badge-success";
    statusBadge.style.display = "inline-flex";
  }
  if (metaEl) {
    metaEl.textContent = `Remote: ${remote} • Branch: ${targetBranch} • Published at ${new Date().toLocaleTimeString()}`;
  }

  let commits = [];
  try {
    const logRes = await api.getGitLog(repo?.id || "", 5);
    commits = logRes?.commits || (Array.isArray(logRes) ? logRes : []);
  } catch { }

  const ghUrl = repo?.url && repo.url.includes("github.com")
    ? `${repo.url.replace(/\.git$/, "")}/compare/${repo.defaultBranch || "main"}...${targetBranch}?expand=1`
    : "";

  if (viewer) {
    viewer.innerHTML = `
      <div style="padding:28px 24px;max-width:840px;margin:0 auto">
        <div style="background:var(--c-success-light);border:1px solid var(--c-success-border);border-radius:var(--radius-lg);padding:18px 22px;margin-bottom:24px;display:flex;align-items:center;gap:14px">
          <div style="width:38px;height:38px;border-radius:50%;background:var(--c-success);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700">✓</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px;color:var(--c-success-text)">Successfully Pushed to ${window.escapeHtml(remote)}/${window.escapeHtml(targetBranch)}</div>
            <div style="font-size:12px;color:var(--c-text-muted);margin-top:2px">All local commits have been published to the remote repository. Working tree is synchronized and clean.</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" data-action="openCreatePRModal" style="display:flex;align-items:center;gap:6px">🚀 Create Pull Request</button>
            <a href="${window.escapeHtml(ghUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:6px">Compare on GitHub ↗</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:24px">
          <div class="card" style="padding:14px;border:1px solid var(--c-border);background:var(--c-surface-card)">
            <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase">Target Branch</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;color:var(--c-primary);font-family:var(--font-mono)">${window.escapeHtml(targetBranch)}</div>
          </div>
          <div class="card" style="padding:14px;border:1px solid var(--c-border);background:var(--c-surface-card)">
            <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase">Sync Status</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;color:var(--c-success)">Up to Date (↑ 0 · ↓ 0)</div>
          </div>
          <div class="card" style="padding:14px;border:1px solid var(--c-border);background:var(--c-surface-card)">
            <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase">Working Tree</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;color:var(--c-text)">Clean (0 uncommitted)</div>
          </div>
        </div>

        <div class="card" style="border:1px solid var(--c-border);background:var(--c-surface-card);overflow:hidden;padding:0">
          <div style="padding:12px 18px;background:var(--c-surface-subtle);border-bottom:1px solid var(--c-border);font-size:13px;font-weight:700;display:flex;justify-content:space-between;align-items:center">
            <span>Published Commits</span>
            <span class="badge badge-accent" style="font-size:10px">${commits.length} recent</span>
          </div>
          <div style="divide-y:1px solid var(--c-border-subtle)">
            ${commits.map(c => `
              <div style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--c-border-subtle)">
                <div style="flex:1;padding-right:12px">
                  <div style="font-weight:600;font-size:13px;color:var(--c-text)">${window.escapeHtml(c.subject || c.message || "")}</div>
                  <div style="font-size:11px;color:var(--c-text-muted);margin-top:2px">${window.escapeHtml(c.author || "Git User")} • ${window.escapeHtml(c.date || "recently")}</div>
                </div>
                <span class="badge badge-secondary" style="font-family:var(--font-mono);font-size:11px">${(c.hash || c.sha || "").slice(0, 7)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }
}

// Export to window
window.renderPushSummaryView = renderPushSummaryView;
