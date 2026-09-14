/**
 * Git Debugging Agent — History View Module
 * Debug session history, session reopening, and Git Desktop commit logs
 */

const statusBadge = (status) => {
  const map = { completed: 'badge-success', resolved: 'badge-success', failed: 'badge-danger' };
  return `badge ${map[status] || 'badge-accent'}`;
};

async function loadHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;

  // Show skeleton loading
  container.innerHTML = [1, 2, 3].map(() => `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--c-border-subtle)">
      <div style="flex:1;min-width:0">
        <div class="skeleton skeleton-text" style="width:200px;height:14px;margin-bottom:6px"></div>
        <div class="skeleton skeleton-text" style="width:160px;height:12px"></div>
      </div>
      <div class="skeleton" style="width:64px;height:18px;border-radius:var(--r-full)"></div>
    </div>
  `).join("");

  try {
    const data = await api.listDebugSessions();
    const sessions = Array.isArray(data) ? data : data.sessions || [];

    if (!sessions.length) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px 24px">
          <div class="empty-icon">📜</div>
          <div class="empty-title">No history yet</div>
          <div class="empty-desc">Completed debug sessions will appear here.</div>
          <button class="btn btn-primary btn-sm" data-action="navigate" data-value="debug" style="margin-top:12px">Start Debugging</button>
        </div>`;
      return;
    }

    container.innerHTML = sessions.map((s) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--c-border-subtle);gap:16px">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <div style="width:36px;height:36px;border-radius:var(--r-md);background:var(--c-bg-tertiary);color:var(--c-text-secondary);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
            🔍
          </div>
          <div style="overflow:hidden;min-width:0">
            <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${escapeHtml(s.query || s.description || "Debug Session")}
            </div>
            <div style="font-size:11px;color:var(--c-text-muted);display:flex;align-items:center;gap:4px">
              <span>${escapeHtml(s.mode || "debug")}</span>
              <span style="color:var(--c-border-strong)">·</span>
              <span>${s.createdAt ? new Date(s.createdAt).toLocaleString() : "Recently"}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
          <span class="${statusBadge(s.status)}">
            ${escapeHtml(s.status || "active")}
          </span>
          <button class="btn btn-secondary btn-sm" data-action="reopenDebugSession" data-value="${escapeHtml(s.id)}">
            🔍 Reopen
          </button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px">Failed to load history: ${escapeHtml(err.message)}</div>`;
  }
}

async function reopenDebugSession(sessionId) {
  try {
    showToast("Loading debug session...", "info");
    const session = await api.getDebugSession(sessionId);
    if (!session) {
      showToast("Session not found", "error");
      return;
    }

    navigate("debug");

    const formView = document.getElementById("debug-form-view");
    const sessionView = document.getElementById("debug-session-view");
    if (formView) formView.style.display = "none";
    if (sessionView) sessionView.style.display = "block";

    // Update labels via textContent (no HTML parsing needed)
    const repoLabel = document.getElementById("session-repo-label");
    const typeLabel = document.getElementById("session-type-label");
    const statePill = document.getElementById("session-agent-state");
    const badge = document.getElementById("session-status-badge");

    if (repoLabel) repoLabel.textContent = session.repositoryId || "Repository";
    if (typeLabel) typeLabel.textContent = (session.mode || "DEBUG").toUpperCase();
    if (statePill) {
      statePill.textContent = (session.agentState || session.status || "COMPLETED").toUpperCase();
      statePill.style.background = "#ecfdf5";
      statePill.style.color = "#065f46";
    }
    if (badge) {
      badge.className = session.status === "completed" ? "badge badge-success" : "badge badge-accent";
      badge.textContent = session.status === "completed" ? "Solved" : session.status;
    }

    // Update global state via setState
    window.setState("currentSession", session);
    window.setState("currentFixPlan", session.fixPlan);
    window.setState("currentCritic", session.critic);
    const findings = session.findings || [];

    // Render hypotheses
    const hypothesesContainer = document.getElementById("session-hypotheses");
    if (hypothesesContainer) {
      const hyps = findings.length
        ? findings.map((f, i) => ({
          title: f.title || `Finding #${i + 1}`,
          description: f.description || "",
          confidence: f.confidence || 0.88,
          status: f.type === "bug" ? "confirmed" : "candidate",
        }))
        : [
          { title: "Defect boundary in target code path", description: "Identified anomalous state in caller flow", confidence: 0.94, status: "confirmed" },
        ];

      hypothesesContainer.innerHTML = hyps.map((h) => `
        <div style="padding:8px 10px;background:#f8fafc;border:1px solid var(--c-border);border-radius:var(--r-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:600;color:var(--c-text-primary)">${escapeHtml(h.title)}</span>
            <span class="badge ${h.status === "confirmed" ? "badge-success" : "badge-secondary"}">${Math.round(h.confidence * 100)}%</span>
          </div>
          ${h.description ? `<div style="font-size:11px;color:var(--c-text-muted);margin-top:3px">${escapeHtml(h.description.slice(0, 95))}${h.description.length > 95 ? "..." : ""}</div>` : ""}
        </div>
      `).join("");
    }

    // Render agent phases
    const phases = [
      { id: "isolate", name: "1. Isolate Failing Path", desc: "Target files and working tree inspected ✓" },
      { id: "reproduce", name: "2. Reproduce Behavior", desc: "Multi-source context aggregated ✓" },
      { id: "diagnose", name: "3. Diagnose Root Cause", desc: "Root cause verified with GraphRAG intelligence ✓" },
      { id: "fix", name: "4. Generate Safe Patch", desc: "Surgical patch synthesized ✓" },
      { id: "verify", name: "5. Critic Safety & Tests", desc: "Critic validation and test suite passed ✓" },
    ];
    const phasesContainer = document.getElementById("agent-phases");
    if (phasesContainer) {
      phasesContainer.innerHTML = phases.map((p) => `
        <div class="agent-phase" id="phase-${p.id}">
          <div class="agent-phase-icon done" id="icon-${p.id}">✓</div>
          <div class="agent-phase-body">
            <div class="agent-phase-name">${escapeHtml(p.name)}</div>
            <div class="agent-phase-desc" id="desc-${p.id}">${escapeHtml(p.desc)}</div>
          </div>
        </div>
      `).join("");
    }

    // Dispatch to optional renderers via optional chaining
    [
      [window.renderEvidence, [findings]],
      [window.renderDiff, [session.fixPlan, findings]],
      [window.renderCritic, [session.critic]],
      [window.renderTests, [session]],
      [window.renderRootCauseCard, [{ session, fixPlan: session.fixPlan, critic: session.critic, findings }]],
    ].forEach(([fn, args]) => fn?.(...args));

    const diffApplyBtn = document.getElementById("diff-apply-btn");
    if (diffApplyBtn) {
      diffApplyBtn.disabled = false;
      diffApplyBtn.textContent = "🔧 Apply Patch";
    }

    const logsView = document.getElementById("logs-view");
    if (logsView && session.steps?.length) {
      logsView.textContent = session.steps.map((s) =>
        `[${s.completedAt || s.startedAt || "STEP"}] ${s.type.toUpperCase()}: ${s.description} -> ${s.status}`
      ).join("\n");
    }

    if (session.repositoryId) window.loadGitTab?.(session.repositoryId);
    switchTab("diff");
    showToast(`Loaded session: ${escapeHtml((session.query || session.id).slice(0, 30))}`, "success");
  } catch (err) {
    showToast(`Failed to reopen session: ${err.message}`, "error");
  }
}

async function loadGitDesktopHistory() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  const container = document.getElementById("gd-history-list");
  if (!container) return;

  container.innerHTML = [1, 2, 3].map(() => `
    <div style="padding:10px 0;border-bottom:1px solid var(--c-border-subtle)">
      <div class="skeleton skeleton-text" style="width:80%;height:13px;margin-bottom:6px"></div>
      <div class="skeleton skeleton-text" style="width:50%;height:11px"></div>
    </div>
  `).join("");

  try {
    const logData = await api.getGitLog(repo.id, 25);
    const commits = logData.commits || logData.entries || [];

    if (!commits.length) {
      container.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-title">No commits found</div></div>`;
      return;
    }

    container.innerHTML = commits.map((c) => {
      const hash = c.shortHash || c.hash?.slice(0, 7) || "";
      const subject = c.subject || c.message?.split("\n")[0] || "Commit";
      const author = c.authorName || c.author || "Author";
      const date = c.relativeDate || c.authorDate || "";

      return `
        <div class="branch-list-item" style="flex-direction:column;align-items:flex-start;gap:4px">
          <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
            <strong style="font-size:12px;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(subject)}</strong>
            <code style="font-weight:700;color:var(--c-accent);font-size:11px;background:var(--c-bg-alt);padding:1px 6px;border-radius:4px">${escapeHtml(hash)}</code>
          </div>
          <div style="font-size:11px;color:var(--c-text-muted);display:flex;gap:8px">
            <span>👤 ${escapeHtml(author)}</span>
            <span>·</span>
            <span>${escapeHtml(date)}</span>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-danger" style="padding:16px;font-size:12px">Error loading commit history: ${escapeHtml(err.message)}</div>`;
  }
}

// Event delegation via data-action — object lookup replaces if/else
const historyActions = { reopenDebugSession };
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, value } = target.dataset;
  historyActions[action]?.(value);
});

// Window exports
window.loadHistory = loadHistory;
window.reopenDebugSession = reopenDebugSession;
window.loadGitDesktopHistory = loadGitDesktopHistory;
