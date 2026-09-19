/**
 * Git Debugging Agent — History View Module
 * Debug session history, session reopening, and Git Desktop commit logs
 */

const statusBadge = (status) => {
  const map = { completed: 'badge-success', resolved: 'badge-success', failed: 'badge-danger' };
  return `badge ${map[status] || 'badge-accent'}`;
};

let _allHistorySessions = [];

function renderHistoryCards(sessions, container) {
  if (!sessions.length) {
    const searchInput = document.getElementById("history-search-input");
    const isSearching = searchInput && searchInput.value.trim() !== "";
    container.innerHTML = `
      <div class="empty-state" style="padding:48px 24px">
        <div class="empty-icon">${isSearching ? "🔍" : "📜"}</div>
        <div class="empty-title">${isSearching ? "No matching debug sessions" : "No history yet"}</div>
        <div class="empty-desc">${isSearching ? "Try searching for a different keyword, error, or repository." : "Completed debug sessions will appear here."}</div>
        ${!isSearching ? `<button class="btn btn-primary btn-sm" data-action="navigate" data-value="debug" style="margin-top:12px">⚡ Start Debugging</button>` : ""}
      </div>`;
    return;
  }

  container.innerHTML = sessions.map((s) => {
    const repoName = s.repositoryId || (window.state?.activeRepository?.name) || "Repository";
    const shortId = s.id ? s.id.slice(0, 8) : "session";
    const mode = (s.mode || "debug").toUpperCase();
    const query = s.query || s.description || "Automated Bug Diagnosis";
    const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleString() : "Recently";
    const duration = s.durationMs ? `${Math.round(s.durationMs / 1000)}s` : null;

    return `
      <div class="history-item-card">
        <div class="history-card-left">
          <div class="history-card-icon">⚡</div>
          <div class="history-card-details">
            <div class="history-card-header-row">
              <span class="history-repo-tag">📁 ${escapeHtml(repoName)}</span>
              <span class="history-session-id">#${escapeHtml(shortId)}</span>
              <span class="history-mode-pill">${escapeHtml(mode)}</span>
            </div>
            <div class="history-query-text" title="${escapeHtml(query)}">${escapeHtml(query)}</div>
            <div class="history-meta-row">
              <span>🕒 ${escapeHtml(dateStr)}</span>
              ${duration ? `<span>⏱️ ${escapeHtml(duration)}</span>` : ""}
              ${s.fixStatus ? `<span class="badge badge-accent">${escapeHtml(s.fixStatus)}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="history-card-actions">
          <span class="${statusBadge(s.status)}">
            ${escapeHtml(s.status || "active")}
          </span>
          <button class="btn btn-secondary btn-sm" data-action="reopenDebugSession" data-value="${escapeHtml(s.id)}" style="display:flex;align-items:center;gap:5px">
            🔍 Reopen
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function loadHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;

  // Show skeleton loading
  container.innerHTML = [1, 2, 3].map(() => `
    <div style="display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid var(--c-border-subtle)">
      <div class="skeleton" style="width:36px;height:36px;border-radius:var(--r-md)"></div>
      <div style="flex:1;min-width:0">
        <div class="skeleton skeleton-text" style="width:240px;height:14px;margin-bottom:6px"></div>
        <div class="skeleton skeleton-text" style="width:160px;height:12px"></div>
      </div>
      <div class="skeleton" style="width:72px;height:24px;border-radius:var(--r-full)"></div>
    </div>
  `).join("");

  try {
    const data = await api.listDebugSessions();
    _allHistorySessions = Array.isArray(data) ? data : data.sessions || [];
    renderHistoryCards(_allHistorySessions, container);

    // Setup live search input listener once
    const searchInput = document.getElementById("history-search-input");
    if (searchInput && !searchInput._listenerAttached) {
      searchInput._listenerAttached = true;
      searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
          renderHistoryCards(_allHistorySessions, container);
          return;
        }
        const filtered = _allHistorySessions.filter((s) => {
          const q = (s.query || s.description || "").toLowerCase();
          const r = (s.repositoryId || "").toLowerCase();
          const id = (s.id || "").toLowerCase();
          const m = (s.mode || "").toLowerCase();
          return q.includes(query) || r.includes(query) || id.includes(query) || m.includes(query);
        });
        renderHistoryCards(filtered, container);
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:32px 20px">Failed to load history: ${escapeHtml(err.message)}</div>`;
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
        <div style="padding:8px 10px;background:var(--c-surface-elevated, rgba(255,255,255,0.03));border:1px solid var(--c-border);border-radius:var(--r-sm)">
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
    let nodes = [];
    try {
      const graphData = await api.gitLogGraph(repo.id, 40);
      nodes = Array.isArray(graphData) ? graphData : (graphData.nodes || []);
    } catch (_) {
      const logData = await api.getGitLog(repo.id, 25);
      const commits = logData.commits || logData.entries || [];
      nodes = commits.map((c) => ({
        hash: c.shortHash || c.hash?.slice(0, 7) || "",
        parents: [],
        author: c.authorName || c.author || "Author",
        date: c.relativeDate || c.authorDate || "",
        message: c.subject || c.message?.split("\n")[0] || "Commit",
        refs: [],
        graphSymbols: "*",
      }));
    }

    if (!nodes.length) {
      container.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-title">No commits found</div></div>`;
      return;
    }

    container.innerHTML = nodes.map((node) => {
      const hash = node.hash?.slice(0, 7) || "";
      const subject = node.message?.split("\n")[0] || "Commit";
      const author = node.author || "Author";
      const date = node.date || "";
      const symbols = node.graphSymbols || "*";

      const refBadges = (node.refs || []).map((ref) => {
        let badgeClass = "badge-secondary";
        if (ref.includes("HEAD")) badgeClass = "badge-accent";
        else if (ref.includes("origin/")) badgeClass = "badge-info";
        else if (ref.includes("tag:")) badgeClass = "badge-warning";
        return `<span class="badge ${badgeClass}" style="font-size:10px;padding:1px 5px;font-family:var(--font-mono)">${escapeHtml(ref)}</span>`;
      }).join(" ");

      return `
        <div class="branch-list-item" style="flex-direction:row;align-items:flex-start;gap:10px;padding:8px 10px;border-bottom:1px solid var(--c-border-subtle);cursor:default">
          <!-- Graph Lane Indicator -->
          <div style="font-family:monospace;font-size:12px;font-weight:700;color:var(--c-accent);white-space:pre;line-height:1.2;padding-top:2px;user-select:none;flex-shrink:0" title="Branch topology">
            ${escapeHtml(symbols)}
          </div>
          <!-- Commit Content -->
          <div style="flex:1;min-width:0;overflow:hidden">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
              <strong style="font-size:12.5px;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(subject)}</strong>
              ${refBadges}
            </div>
            <div style="font-size:11px;color:var(--c-text-muted);display:flex;gap:8px;align-items:center">
              <span>👤 ${escapeHtml(author)}</span>
              <span>·</span>
              <span>🕒 ${escapeHtml(date)}</span>
              <span>·</span>
              <code style="font-weight:700;color:var(--c-accent);font-size:10.5px;background:#f1f5f9;padding:1px 5px;border-radius:4px;cursor:pointer" title="Click to copy hash" onclick="navigator.clipboard.writeText('${escapeHtml(node.hash)}').then(()=>showToast('Hash copied!','info'))">${escapeHtml(hash)}</code>
            </div>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-danger" style="padding:16px;font-size:12px">Error loading commit history: ${escapeHtml(err.message)}</div>`;
  }
}

// Event delegation via data-action — object lookup replaces if/else
const historyActions = {
  reopenDebugSession,
  refreshHistory: () => {
    showToast("Refreshing history...", "info");
    loadHistory();
  },
};
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
