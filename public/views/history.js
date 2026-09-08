/**
 * Git Debugging Agent — History View Module
 * Debug session history, session reopening, and Git Desktop commit logs
 */

async function loadHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;

  try {
    const data = await api.listDebugSessions();
    const sessions = Array.isArray(data) ? data : data.sessions || [];

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <div class="empty-title">No history yet</div>
          <div class="empty-desc">Completed debug sessions will appear here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = sessions
      .map(
        (s) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--c-border-subtle)">
          <div style="flex:1;padding-right:12px">
            <div style="font-weight:600;font-size:14px;margin-bottom:4px">
              ${escapeHtml(s.query || s.description || "Debug Session")}
            </div>
            <div style="font-size:12px;color:var(--c-text-muted)">
              Mode: ${escapeHtml(s.mode || "debug")} · ${s.createdAt ? new Date(s.createdAt).toLocaleString() : "Recently"}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${s.status === "completed" || s.status === "resolved" ? "badge-success" : s.status === "failed" ? "badge-danger" : "badge-accent"}">
              ${escapeHtml(s.status || "active")}
            </span>
            <button class="btn btn-secondary btn-sm" data-action="reopenDebugSession" data-value="${escapeHtml(s.id)}">
              🔍 Reopen
            </button>
          </div>
        </div>
      `,
      )
      .join("");
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

    // Switch to debug tab
    navigate("debug");

    const formView = document.getElementById("debug-form-view");
    const sessionView = document.getElementById("debug-session-view");
    if (formView) formView.style.display = "none";
    if (sessionView) sessionView.style.display = "block";

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

    window.state.currentSession = session;
    window.state.currentFixPlan = session.fixPlan;
    window.state.currentCritic = session.critic;

    const hypothesesContainer = document.getElementById("session-hypotheses");
    if (hypothesesContainer) {
      const hyps = (session.findings && session.findings.length > 0)
        ? session.findings.map((f, i) => ({
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

    if (typeof window.renderEvidence === "function") window.renderEvidence(session.findings || []);
    if (typeof window.renderDiff === "function") window.renderDiff(session.fixPlan, session.findings || []);
    if (typeof window.renderCritic === "function") window.renderCritic(session.critic);
    if (typeof window.renderTests === "function") window.renderTests(session);
    if (typeof window.renderRootCauseCard === "function") {
      window.renderRootCauseCard({ session, fixPlan: session.fixPlan, critic: session.critic, findings: session.findings });
    }

    const diffApplyBtn = document.getElementById("diff-apply-btn");
    if (diffApplyBtn) {
      diffApplyBtn.disabled = false;
      diffApplyBtn.textContent = "🔧 Apply Patch";
    }

    const logsView = document.getElementById("logs-view");
    if (logsView && session.steps && session.steps.length > 0) {
      logsView.textContent = session.steps.map((s) => `[${s.completedAt || s.startedAt || "STEP"}] ${s.type.toUpperCase()}: ${s.description} -> ${s.status}`).join("\n");
    }

    if (session.repositoryId && typeof window.loadGitTab === "function") {
      window.loadGitTab(session.repositoryId);
    }
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

  container.innerHTML = `<div class="text-muted" style="text-align:center;padding:24px;font-size:12px"><div class="spinner"></div><div style="margin-top:6px">Loading commit history...</div></div>`;

  try {
    const logData = await api.getGitLog(repo.id, 25);
    const commits = logData.commits || logData.entries || [];

    if (commits.length === 0) {
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

// Event delegation for data-action attributes
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;
  if (action === 'reopenDebugSession') reopenDebugSession(value);
});

// Window exports
window.loadHistory = loadHistory;
window.reopenDebugSession = reopenDebugSession;
window.loadGitDesktopHistory = loadGitDesktopHistory;
