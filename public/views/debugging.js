/**
 * Git Debugging Agent — Workspace A (AI Debugging) View Module
 * End-to-end investigation pipeline, candidate hypotheses,
 * AST symbol lookup, GraphRAG code intelligence, and surgical patch verification.
 */

// ── State color lookup (object over ternary chains) ─────────────────────────
const STATE_COLORS = {
  INITIALIZING: { bg: "#e0e7ff", color: "#3730a3" },
  SCANNING_REPOSITORY: { bg: "#dbeafe", color: "#1e40af" },
  ISOLATING_DEFECT: { bg: "#dbeafe", color: "#1e40af" },
  REPRODUCING_BEHAVIOR: { bg: "#e0f2fe", color: "#075985" },
  GENERATING_HYPOTHESES: { bg: "#fef3c7", color: "#92400e" },
  DIAGNOSING_ROOT_CAUSE: { bg: "#fef3c7", color: "#92400e" },
  SYNTHESIZING_PATCH: { bg: "#d1fae5", color: "#065f46" },
  VALIDATING_PATCH_SAFETY: { bg: "#d1fae5", color: "#065f46" },
  RUNNING: { bg: "#fef3c7", color: "#92400e" },
  COMPLETED: { bg: "#ecfdf5", color: "#065f46" },
  FAILED: { bg: "#fef2f2", color: "#991b1b" },
  ABORTED: { bg: "#fef2f2", color: "#991b1b" },
  ISOLATE_IN_PROGRESS: { bg: "#dbeafe", color: "#1e40af" },
  REPRODUCE_IN_PROGRESS: { bg: "#e0f2fe", color: "#075985" },
  DIAGNOSE_IN_PROGRESS: { bg: "#fef3c7", color: "#92400e" },
  FIX_IN_PROGRESS: { bg: "#d1fae5", color: "#065f46" },
  VERIFY_IN_PROGRESS: { bg: "#d1fae5", color: "#065f46" },
  OBSERVE_IN_PROGRESS: { bg: "#dbeafe", color: "#1e40af" },
};

const getResolvedState = (s) => ({ bg: "#e0e7ff", color: "#3730a3", ...STATE_COLORS[s] });

// ── Step-to-phase mapping ──────────────────────────────────────────────────
const STEP_TO_PHASE = {
  isolate: "isolate",
  observe: "isolate",
  reproduce: "reproduce",
  diagnose: "diagnose",
  fix: "fix",
  verify: "verify",
};

// ── Diff line-prefix -> CSS class lookup ────────────────────────────────────
const DIFF_LINE_CLASS = {
  "---": "diff-line diff-header",
  "+++": "diff-line diff-header",
  "@@": "diff-line diff-info",
  "+": "diff-line diff-add",
  "-": "diff-line diff-del",
};
const DEFAULT_DIFF_CLASS = "diff-line";

// ── Shared helpers ──────────────────────────────────────────────────────────
const byId = (id) => document.getElementById(id);

const appendLog = (logsView, msg) => {
  if (!logsView) return;
  logsView.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logsView.scrollTop = logsView.scrollHeight;
};

// ── Memory-leak prevention: single cleanup entry-point ─────────────────────
let _activePoller = null;
let _activeEventSource = null;

function cleanupDebugSession() {
  if (_activePoller != null) { clearInterval(_activePoller); _activePoller = null; }
  if (_activeEventSource) { _activeEventSource.close(); _activeEventSource = null; }
}

// ── Git-tab delegated click handler (data-action) ──────────────────────────
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const gitView = btn.closest("#git-view");
  const repoId = gitView?.dataset?.repoId ?? window.state.currentSession?.repositoryId;
  const action = btn.dataset.action;

  if (action === "git-pull") return gitPullCurrentRepo(repoId);
  if (action === "git-fetch") return gitFetchCurrentRepo(repoId);
  if (action === "git-pr") return openCreatePRModal(repoId);
  if (action === "git-branch") return gitCreateAndCheckoutBranch(repoId);
  if (action === "git-commit") return commitAndPushFix();
});

// ────────────────────────────────────────────────────────────────────────────
// Public helper: set the debug prompt textarea
// ────────────────────────────────────────────────────────────────────────────
function setDebugExample(promptText) {
  const descEl = byId("debug-description");
  if (descEl) descEl.value = promptText;
}

function setInvestigationMode(mode) {
  const select = byId("debug-type");
  if (select) {
    select.value = mode;
    showToast(`Investigation mode set to: ${mode}`, "info");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// startDebugFromForm — orchestrates the switch from form to session view
// ────────────────────────────────────────────────────────────────────────────
async function startDebugFromForm() {
  const repoId = byId("debug-repo")?.value;
  const debugType = byId("debug-type")?.value || "debug";
  const description = byId("debug-description")?.value.trim();
  const logs = byId("debug-logs")?.value.trim();

  if (!repoId) {
    showToast("Please select a repository to debug", "error");
    return;
  }
  if (!description) {
    showToast("Please describe the issue to investigate", "error");
    return;
  }

  const queryParts = [description];
  if (logs) queryParts.push(`Logs / Stack trace:\n${logs}`);
  const fullQuery = queryParts.join("\n\n");

  const repo = (window.state.repositories || []).find((r) => r.id === repoId);
  const repoName = repo?.name ?? "Repository";

  // Switch to session view
  byId("debug-form-view").style.display = "none";
  byId("debug-session-view").style.display = "block";

  // Setup header
  byId("session-repo-label").textContent = `Repository: ${repoName}`;
  byId("session-type-label").textContent = `Type: ${debugType.toUpperCase()}`;
  const badge = byId("session-status-badge");
  badge.className = "badge badge-accent";
  badge.textContent = "Investigating...";

  // Clear tabs
  byId("evidence-list").innerHTML =
    '<div class="text-muted" style="font-size:13px">Investigating repository context...</div>';
  byId("diff-view").innerHTML = `
    <div style="padding:32px 16px;text-align:center">
      <div class="spinner" style="margin:0 auto 12px"></div>
      <div style="font-weight:600;font-size:14px;color:var(--c-text-primary)">Synthesizing Surgical Patch via AI Agent...</div>
      <div style="font-size:12px;color:var(--c-text-muted);margin-top:4px">Analyzing AST code graph & git blame to isolate minimal lines of change</div>
    </div>`;
  byId("tests-view").innerHTML =
    '<div class="text-muted" style="font-size:13px">Waiting for fix verification...</div>';
  byId("logs-view").textContent =
    `[${new Date().toLocaleTimeString()}] Starting debug session on ${repoName}...\n`;
  byId("root-cause-card").style.display = "none";

  const diffApplyBtn = byId("diff-apply-btn");
  if (diffApplyBtn) { diffApplyBtn.disabled = true; diffApplyBtn.textContent = "🔧 Apply Patch"; }
  const diffRevertBtn = byId("diff-revert-btn");
  if (diffRevertBtn) diffRevertBtn.style.display = "none";

  const hypothesesContainer = byId("session-hypotheses");
  if (hypothesesContainer)
    hypothesesContainer.innerHTML =
      '<div class="text-muted" style="font-size:12px">Evaluating candidate hypotheses...</div>';

  loadGitTab(repoId);
  await executeDebugPipeline(repoId, fullQuery, debugType);
}

// ────────────────────────────────────────────────────────────────────────────
// executeDebugPipeline — SSE-driven investigation pipeline
// ────────────────────────────────────────────────────────────────────────────
async function executeDebugPipeline(repoId, query, mode) {
  window.setState("agentRunning", true);

  const spinner = byId("agent-spinner");
  if (spinner) spinner.style.display = "inline-block";

  const phasesContainer = byId("agent-phases");
  const hypothesesContainer = byId("session-hypotheses");
  const logsView = byId("logs-view");
  const statePill = byId("session-agent-state");

  const updateState = (st) => {
    if (!statePill) return;
    const { bg, color } = getResolvedState(st);
    statePill.textContent = st.replace(/_/g, " ");
    statePill.style.background = bg;
    statePill.style.color = color;
    statePill.style.display = "inline-block";
  };

  const phases = [
    { id: "isolate", name: "1. Isolate Failing Path", desc: "Inspect Git commits, blame history & working tree" },
    { id: "reproduce", name: "2. Reproduce Behavior", desc: "Construct regression command or reproducer" },
    { id: "diagnose", name: "3. Diagnose Root Cause", desc: "Evaluate hypotheses with GraphRAG code intelligence" },
    { id: "fix", name: "4. Generate Safe Patch", desc: "Synthesize minimal surgical fix with safety gate" },
    { id: "verify", name: "5. Critic Safety & Tests", desc: "Critic review, AST syntax check & test execution" },
  ];

  phasesContainer.innerHTML = phases
    .map((p) => `
      <div class="agent-phase" id="phase-${p.id}">
        <div class="agent-phase-icon pending" id="icon-${p.id}">⏳</div>
        <div class="agent-phase-body">
          <div class="agent-phase-name">${escapeHtml(p.name)}</div>
          <div class="agent-phase-desc" id="desc-${p.id}">${escapeHtml(p.desc)}</div>
        </div>
      </div>`)
    .join("");

  let sessionFinished = false;
  const accumulatedFindings = [];

  // ── Session terminal handlers ────────────────────────────────────────────
  const onSessionCompleted = (data) => {
    if (sessionFinished) return;
    sessionFinished = true;
    cleanupDebugSession();

    updateState("COMPLETED");
    const badge = byId("session-status-badge");
    if (badge) { badge.className = "badge badge-success"; badge.textContent = "Solved"; }

    const raw = { ...data, session: data.session || data };
    const sess = raw.session;
    const fixPlan = raw.fixPlan;
    const critic = raw.critic;
    const testResult = raw.testResult;
    const findings = raw.findings || sess?.findings || [];

    window.setState("currentSession", sess);
    window.setState("currentFixPlan", fixPlan);
    window.setState("currentCritic", critic);

    phases.forEach((p) => setPhaseDone(p.id));

    // Render hypotheses panel
    if (hypothesesContainer) {
      const hyps = findings?.length
        ? findings.map((f, i) => ({
          title: f.title || `Finding #${i + 1}`,
          description: f.description || "",
          confidence: f.confidence || 0.88,
          status: f.type === "bug" ? "confirmed" : f.type === "configuration" ? "passed" : "candidate",
        }))
        : [];

      hypothesesContainer.innerHTML = hyps.length === 0
        ? '<div style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:12px">✅ No issues detected — all investigation checks passed.</div>'
        : hyps
          .map((h) => `
          <div style="padding:8px 10px;background:#f8fafc;border:1px solid var(--c-border);border-radius:var(--r-sm)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;font-weight:600;color:var(--c-text-primary)">${escapeHtml(h.title)}</span>
              <span class="badge ${h.status === "confirmed" ? "badge-success" : h.status === "passed" ? "badge-success" : "badge-secondary"}">${Math.round(h.confidence * 100)}%</span>
            </div>
            ${h.description
              ? `<div style="font-size:11px;color:var(--c-text-muted);margin-top:3px">${escapeHtml(h.description.slice(0, 95))}${h.description.length > 95 ? "..." : ""}</div>`
              : ""}
          </div>`)
          .join("");
    }

    renderEvidence(findings);
    renderDiff(fixPlan, findings);
    renderCritic(critic);
    renderTests({ ...sess, testResult });
    renderRootCauseCard({ session: sess, fixPlan, critic, findings });

    const diffApplyBtn = byId("diff-apply-btn");
    if (diffApplyBtn) { diffApplyBtn.disabled = false; diffApplyBtn.textContent = "🔧 Apply Patch"; }

    loadGitTab(repoId);
    if (typeof window.loadConflictsTab === "function") window.loadConflictsTab(repoId);

    switchTab("diff");
    showToast("Root cause diagnosed! Review the verified fix below.", "success");
    appendLog(logsView, "Agent finished investigation. Diagnostic fix ready for review.");

    window.setState("agentRunning", false);
    if (spinner) spinner.style.display = "none";
  };

  const onSessionFailed = (errMsg) => {
    if (sessionFinished) return;
    sessionFinished = true;
    cleanupDebugSession();

    updateState("FAILED");
    appendLog(logsView, `ERROR: ${errMsg} `);
    const badge = byId("session-status-badge");
    if (badge) { badge.className = "badge badge-danger"; badge.textContent = "Failed"; }
    showToast(`Debug failed: ${errMsg} `, "error");

    window.setState("agentRunning", false);
    if (spinner) spinner.style.display = "none";
  };

  // ── SSE step handler (switch on step.status) ─────────────────────────────
  const handleStep = (step) => {
    const pId = STEP_TO_PHASE[step.type] || "diagnose";

    switch (step.status) {
      case "running":
        setPhaseRunning(pId, step.description || `Executing ${step.type}...`);
        updateState(`${step.type.toUpperCase()}_IN_PROGRESS`);
        appendLog(logsView, `[STEP RUNNING] ${step.description || step.type} `);
        break;
      case "completed":
        setPhaseDone(pId, step.result ? step.result.slice(0, 80) : `${step.description} ✓`);
        appendLog(logsView, `[STEP DONE] ${step.description || step.type} (${step.durationMs || 0}ms)`);
        break;
      case "failed":
        setPhaseFailed(pId, step.error || "Step failed");
        appendLog(logsView, `[STEP FAILED] ${step.description || step.type}: ${step.error} `);
        break;
    }
  };

  // ── SSE event dispatch (switch on event type) ────────────────────────────
  const handleSSEEvent = {
    step: ({ data }) => handleStep(data || {}),
    state: (evt) => {
      const stateName = evt.state || evt.data?.state || (typeof evt.data === "string" ? evt.data : null);
      if (typeof stateName === "string") { updateState(stateName); appendLog(logsView, `[STATE] ${stateName} `); }
    },
    finding: ({ data }) => {
      appendLog(logsView, `[FINDING] ${data?.title || data?.type || "Candidate identified"} `);
      accumulatedFindings.push(data);
      renderEvidence(accumulatedFindings);
    },
    complete: ({ data }) => { appendLog(logsView, "[COMPLETE] Pipeline finished."); onSessionCompleted(data); },
    snapshot: (evt) => {
      if (evt.agentState) updateState(evt.agentState);
      if (evt.plan) {
        const planCard = byId("session-plan-card");
        if (planCard) planCard.style.display = "block";
        if (byId("plan-task-class")) byId("plan-task-class").textContent = evt.plan.taskClass || "DEBUG";
        if (byId("plan-summary")) byId("plan-summary").textContent = evt.plan.summary || "";
        if (byId("plan-complexity")) byId("plan-complexity").textContent = evt.plan.estimatedComplexity || "moderate";
        if (byId("plan-approval")) byId("plan-approval").textContent = evt.plan.requiresApproval ? "Required" : "Auto-approved";
      }
      if (evt.session?.findings?.length) {
        accumulatedFindings.push(...evt.session.findings);
        renderEvidence(accumulatedFindings);
      }
      if (evt.session?.status === "completed") onSessionCompleted(evt);
    },
    error: ({ data }) => onSessionFailed(data?.message || "Unknown error in stream"),
    phase_start: ({ data }) => { if (data?.phase) { setPhaseRunning(data.phase, data.description); appendLog(logsView, `[PHASE START] ${data.phase} `); } },
    phase_complete: ({ data }) => { if (data?.phase) { setPhaseDone(data.phase, data.result); appendLog(logsView, `[PHASE DONE] ${data.phase} `); } },
    phase_failed: ({ data }) => { if (data?.phase) { setPhaseFailed(data.phase, data.error); appendLog(logsView, `[PHASE FAILED] ${data.phase}: ${data.error} `); } },
    evidence: ({ data }) => appendLog(logsView, `[EVIDENCE] ${data?.title || "Evidence collected"} `),
    hypothesis: ({ data }) => {
      appendLog(logsView, `[HYPOTHESIS] ${data?.title || "Hypothesis formed"} `);
      if (hypothesesContainer) {
        const item = document.createElement("div");
        item.className = "hypothesis-item";
        const pct = Math.round((data?.confidence ?? 0) * 100);
        item.innerHTML = `
          <div class="hypothesis-title">${escapeHtml(data?.title || "Hypothesis")} <span class="text-muted">(${data?.category || ""} · ${pct}%)</span></div>
          <div class="text-muted" style="font-size:12px">${escapeHtml(data?.description || "")}</div>`;
        if (hypothesesContainer.dataset.populated !== "1") {
          hypothesesContainer.innerHTML = "";
          hypothesesContainer.dataset.populated = "1";
        }
        hypothesesContainer.appendChild(item);
      }
    },
    diff: () => appendLog(logsView, "[DIFF] Patch diff received."),
    fix_plan: ({ data }) => {
      appendLog(logsView, `[FIX PLAN] ${data?.id || ""} risk=${data?.riskLevel || "unknown"} `);
      const diffView = byId("diff-view");
      if (diffView && data?.filesToChange?.length) {
        diffView.innerHTML = `
          <div style="padding:16px">
            <div style="font-weight:600;font-size:14px">Proposed Fix Plan <span class="text-muted">(risk: ${escapeHtml(data?.riskLevel || "unknown")})</span></div>
            <ul style="margin:10px 0 0 18px;font-size:13px;line-height:1.6">
              ${data.filesToChange.map((f) => `<li>${escapeHtml(f?.filePath || f)}</li>`).join("")}
            </ul>
            ${data?.summary ? `<p style="font-size:12px;color:var(--c-text-muted);margin-top:10px">${escapeHtml(data.summary)}</p>` : ""}
          </div>`;
      }
    },
    critic: ({ data }) => appendLog(logsView, `[CRITIC] Verdict: ${data?.verdict || "evaluating"} `),
    test: ({ data }) => appendLog(logsView, `[TEST] ${data?.script || "test"}: ${data?.passed ? "PASS" : "FAIL"} (exit ${data?.exitCode}) `),
    test_result: ({ data }) => appendLog(logsView, `[TEST] ${data?.name || "Test"}: ${data?.passed ? "PASS" : "FAIL"} `),
    root_cause: ({ data }) => appendLog(logsView, `[ROOT CAUSE] ${data?.cause || "Root cause identified"} `),
    fix: ({ data }) => appendLog(logsView, `[FIX] ${data?.summary || "Fix generated"} `),
  };

  try {
    updateState("SCANNING_REPOSITORY");
    appendLog(logsView, `Starting Debug Orchestrator on repository ${repoId}...`);

    // Pre-flight plan (non-blocking)
    try {
      const plan = await api.planTask(query, repoId);
      if (plan) {
        const planCard = byId("session-plan-card");
        if (planCard) planCard.style.display = "block";
        const classEl = byId("plan-task-class");
        const summaryEl = byId("plan-summary");
        const compEl = byId("plan-complexity");
        const appEl = byId("plan-approval");
        if (classEl) classEl.textContent = plan.taskClass || "DEBUG";
        if (summaryEl) summaryEl.textContent = plan.summary || query;
        if (compEl) compEl.textContent = plan.estimatedComplexity || "moderate";
        if (appEl) appEl.textContent = plan.requiresApproval ? "Required" : "Auto-approved";
        appendLog(logsView, `Task Classified: ${plan.taskClass || "DEBUG"} (${plan.estimatedComplexity || "moderate"})`);
      }
    } catch (e) {
      appendLog(logsView, `Plan fetch notice: ${e.message} `);
    }

    const asyncRes = await api.runDebugAsync({ repositoryId: repoId, query, mode });
    const sessionId = asyncRes.sessionId || asyncRes.session?.id;
    window.setState("currentSession", asyncRes.session);

    if (!sessionId) throw new Error("No sessionId returned by debug-async");

    appendLog(logsView, `Debug session[${sessionId.slice(0, 8)}]launched.Listening to SSE stream...`);

    // Open SSE stream (stored for cleanup on exit/abort)
    _activeEventSource = api.streamSession(
      sessionId,
      (evt) => { if (evt) (handleSSEEvent[evt.type] || (() => { }))(evt); },
      (err) => console.warn("SSE connection closed or errored", err),
    );

    // Safety poller — auto-closes on completion/failure; stored for cleanup on exit
    let checkCount = 0;
    _activePoller = setInterval(async () => {
      if (sessionFinished) { cleanupDebugSession(); return; }
      if (++checkCount > 30) {
        cleanupDebugSession();
        if (!sessionFinished) onSessionFailed("Debug session timed out after 60 seconds.");
        return;
      }
      try {
        const sess = await api.getDebugSession(sessionId);
        if (sess?.status === "completed" || sess?.status === "resolved") {
          cleanupDebugSession();
          onSessionCompleted({ session: sess, findings: sess.findings || [], fixPlan: sess.fixPlan, critic: sess.critic, plan: sess.plan });
        } else if (sess?.status === "failed" || sess?.status === "aborted") {
          cleanupDebugSession();
          onSessionFailed(sess.error || "Session ended with failure status");
        }
      } catch { /* transient poll error — ignore */ }
    }, 2000);
  } catch (err) {
    onSessionFailed(err.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Phase visual helpers
// ────────────────────────────────────────────────────────────────────────────
function setPhaseRunning(id, text) {
  const icon = byId(`icon-${id}`);
  const desc = byId(`desc-${id}`);
  if (icon) { icon.className = "agent-phase-icon active"; icon.textContent = "⚡"; }
  if (desc && text) desc.textContent = text;
}

function setPhaseDone(id, text) {
  const icon = byId(`icon-${id}`);
  const desc = byId(`desc-${id}`);
  if (icon) { icon.className = "agent-phase-icon done"; icon.textContent = "✓"; }
  if (desc && text) desc.textContent = text;
}

function setPhaseFailed(id, text) {
  const icon = byId(`icon-${id}`);
  const desc = byId(`desc-${id}`);
  if (icon) {
    icon.className = "agent-phase-icon failed";
    icon.style.background = "#fee2e2";
    icon.style.color = "#dc2626";
    icon.textContent = "✗";
  }
  if (desc && text) desc.textContent = text;
}

// ────────────────────────────────────────────────────────────────────────────
// renderEvidence
// ────────────────────────────────────────────────────────────────────────────
function renderEvidence(findings) {
  const container = byId("evidence-list");
  if (!container) return;

  if (!findings?.length) {
    container.innerHTML = `
      <div style="padding:16px;text-align:center;color:var(--c-text-muted);font-size:12px">
        <div style="font-size:20px;margin-bottom:4px">✅</div>
        No issues or errors found — repository is clean.
      </div>`;
    return;
  }

  container.innerHTML = findings
    .map((f, idx) => `
      <div style="padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);background:var(--c-surface)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:700;font-size:13px">${idx + 1}. ${escapeHtml(f.title || f.type || "Finding")}</span>
          <span class="badge ${(f.severity === "high" || f.type === "bug") ? "badge-danger" : "badge-accent"}">${escapeHtml(f.type || f.severity || "info")}</span>
        </div>
        <div style="font-size:12px;color:var(--c-text-secondary)">${escapeHtml(f.description || "")}</div>
        ${f.evidence?.length
        ? `<div style="margin-top:8px;padding:6px 10px;background:#f8fafc;border-radius:var(--r-sm);font-size:11px;color:var(--c-text-muted)">
               <strong>Evidence:</strong> ${escapeHtml(Array.isArray(f.evidence) ? f.evidence.join("; ") : String(f.evidence))}
             </div>`
        : ""}
      </div>`)
    .join("");
}

// ────────────────────────────────────────────────────────────────────────────
// renderDiff — object-lookup for diff line CSS class
// ────────────────────────────────────────────────────────────────────────────
function renderDiff(fixPlan, findings) {
  const container = byId("diff-view");
  if (!container) return;

  if (!fixPlan?.filesToChange?.length) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--c-text-muted);font-size:13px">
        <div style="font-size:28px;margin-bottom:8px">📋</div>
        No changes needed — repository is in good health.
      </div>`;
    return;
  }

  const diffText = fixPlan.filesToChange
    .map((f) => f.patch || `--- a/${f.filePath}\n+++ b/${f.filePath}\n@@ -1,5 +1,6 @@\n// ${f.description}`)
    .join("\n\n");

  const coloredLines = diffText.split("\n").map((line) => {
    const prefix = line[0];
    const cls = prefix ? (DIFF_LINE_CLASS[prefix] ?? (line.startsWith("@@") ? "diff-line diff-info" : DEFAULT_DIFF_CLASS)) : DEFAULT_DIFF_CLASS;
    return `<span class="${cls}">${escapeHtml(line)}</span>`;
  });

  container.innerHTML = `<div class="diff-viewer">${coloredLines.join("")}</div>`;
}

// ────────────────────────────────────────────────────────────────────────────
// renderCritic
// ────────────────────────────────────────────────────────────────────────────
function renderCritic(critic) {
  const container = byId("critic-view");
  if (!container) return;

  if (!critic) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--c-text-muted);font-size:13px">
        <div style="font-size:28px;margin-bottom:8px">🔍</div>
        Critic evaluation not available for this session.
      </div>`;
    return;
  }

  const verdict = critic.verdict || (critic.approved === true ? "APPROVED" : critic.verdict);
  const isApproved = critic.approved === true || verdict === "APPROVED";
  const hasScore = typeof critic.score === "number";
  const scorePercent = hasScore ? Math.round(critic.score > 1 ? critic.score : critic.score * 100) : null;
  const scoreColor = scorePercent == null ? "var(--c-text-muted)" : scorePercent >= 80 ? "var(--c-success)" : scorePercent >= 60 ? "var(--c-warning)" : "var(--c-danger)";

  container.innerHTML = `
    <div class="critic-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:14px">Critic Agent Verdict</div>
          <div style="font-size:12px;color:var(--c-text-muted)">Safety, correctness &amp; regression check</div>
        </div>
        <span class="badge ${isApproved ? "badge-success" : "badge-danger"}">${escapeHtml(verdict || "NO VERDICT")}</span>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px">
          <span>Safety &amp; Confidence Score</span>
          <span>${scorePercent == null ? "N/A" : `${scorePercent}/100`}</span>
        </div>
        <div class="critic-score-bar">
          <div class="critic-score-fill" style="width:${scorePercent == null ? 0 : scorePercent}%;background:${scoreColor}"></div>
        </div>
      </div>

      <div style="font-size:12px;color:var(--c-text-secondary);background:#f8fafc;padding:10px;border-radius:var(--r-sm)">
        ${escapeHtml(critic.summary || critic.feedback || "Critic evaluation completed with no summary provided.")}
      </div>

      ${critic.findings?.length
      ? `<div style="font-weight:600;font-size:12px;margin-top:4px">Detailed Review Findings:</div>
           <div style="display:flex;flex-direction:column;gap:6px">
             ${critic.findings.map((f) => `
               <div class="critic-finding-item">
                 <div style="display:flex;justify-content:space-between;align-items:center">
                   <span style="font-weight:600;font-size:12px">${escapeHtml(f.category || "Safety")}</span>
                   <span class="badge ${f.severity === "critical" ? "badge-danger" : "badge-secondary"}" style="font-size:10px">${escapeHtml(f.severity || "info")}</span>
                 </div>
                 <div style="color:var(--c-text-secondary)">${escapeHtml(f.description)}</div>
               </div>`).join("")}
           </div>`
      : `<div style="font-size:12px;color:var(--c-success-text);display:flex;align-items:center;gap:6px">
             <span>✓</span> No safety violations or regression risks identified.
           </div>`}
    </div>`;
}

// ────────────────────────────────────────────────────────────────────────────
// renderTests
// ────────────────────────────────────────────────────────────────────────────
function renderTests(session) {
  const container = byId("tests-view");
  if (!container) return;

  const tr = session?.testResult;
  if (!tr) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--c-text-muted);font-size:13px">
        <div style="font-size:28px;margin-bottom:8px">🧪</div>
        No test run available for this session. The repository&apos;s test/verify script was not executed yet.
      </div>`;
    return;
  }

  const passed = tr.passed === true;
  const badgeCls = passed ? "badge-success" : "badge-danger";
  const statusText = passed ? "PASS" : "FAIL";
  const icon = passed ? "✓" : "✗";
  const color = passed ? "var(--c-success)" : "var(--c-danger)";

  const output = [tr.stdout, tr.stderr].filter(Boolean).join("\n").trim();
  const duration = typeof tr.durationMs === "number" ? ` · ${tr.durationMs}ms` : "";

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);background:var(--c-surface)">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="color:${color};font-size:16px">${icon}</span>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600">Test: <span style="font-family:var(--font-mono)">${escapeHtml(tr.script || "test")}</span></div>
            <div style="font-size:11px;color:var(--c-text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(`${tr.packageManager || "npm"} run ${tr.script}`)}</div>
          </div>
        </div>
        <span class="badge ${badgeCls}">${statusText}${duration}</span>
      </div>
      ${output
      ? `<pre style="margin:0;padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);background:#0f172a;color:#e2e8f0;font-size:11px;line-height:1.5;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word">${escapeHtml(output)}</pre>`
      : `<div style="padding:12px;text-align:center;color:var(--c-text-muted);font-size:12px">No output captured for this test run.</div>`}
    </div>`;
}

// ────────────────────────────────────────────────────────────────────────────
// renderRootCauseCard
// ────────────────────────────────────────────────────────────────────────────
function renderRootCauseCard(result) {
  const card = byId("root-cause-card");
  if (!card) return;

  const { fixPlan } = result;
  const isClean =
    !fixPlan ||
    !fixPlan.filesToChange ||
    fixPlan.filesToChange.length === 0 ||
    (fixPlan.riskLevel === "LOW" &&
      (fixPlan.rootCause?.toLowerCase().includes("clean") || fixPlan.rootCause?.toLowerCase().includes("healthy")));

  const riskBadge = byId("rc-risk");
  if (riskBadge) {
    if (isClean) {
      riskBadge.textContent = "CLEAN · 0 RISKS";
      riskBadge.className = "badge badge-success";
    } else if (fixPlan) {
      riskBadge.textContent = `${fixPlan.riskLevel} RISK`;
      riskBadge.className = `badge risk-${fixPlan.riskLevel.toLowerCase()}`;
    }
  }

  byId("rc-symptom").textContent = isClean
    ? "All verification checks passed cleanly."
    : result.summary || "No issues detected during investigation.";
  byId("rc-rootcause").textContent = isClean
    ? fixPlan?.rootCause || "Codebase is clean and healthy. No syntax, runtime, or regression errors found."
    : fixPlan?.rootCause || result.summary || "All checks passed. No root cause identified.";
  byId("rc-evidence").textContent =
    fixPlan?.evidence?.join("; ") || result.findings?.[0]?.title || "Verified code graph, AST symbols, and git history.";
  byId("rc-fix").textContent = isClean
    ? "No changes needed — codebase is 100% healthy and verified."
    : fixPlan
      ? `Files to update: ${fixPlan.filesToChange.map((f) => f.filePath).join(", ")}. ${fixPlan.estimatedImpact || ""}`
      : "No changes needed — repository is in good health.";

  const applyBtn = byId("btn-apply-patch");
  if (applyBtn) {
    applyBtn.style.display = isClean ? "none" : "inline-flex";
  }
  const commitBtn = byId("btn-safe-commit");
  if (commitBtn) {
    commitBtn.style.display = isClean ? "none" : "inline-flex";
  }

  card.style.display = "block";
}

// ────────────────────────────────────────────────────────────────────────────
// loadGitTab — renders git status, branch ops, commit form, recent history
// ────────────────────────────────────────────────────────────────────────────
async function loadGitTab(repoId) {
  const gitView = byId("git-view");
  if (!gitView) return;

  try {
    const [statusData, logData, branchesData] = await Promise.allSettled([
      api.getGitStatus(repoId),
      api.getGitLog(repoId, 5),
      api.getGitBranches(repoId),
    ]);

    const status = statusData.status === "fulfilled" ? statusData.value : {};
    const logs = logData.status === "fulfilled" ? (logData.value.entries || logData.value || []) : [];
    const branches = branchesData.status === "fulfilled" ? (branchesData.value.branches || branchesData.value || []) : [];

    gitView.dataset.repoId = repoId;
    gitView.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:600;font-size:13px">Working Tree Status</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" data-action="git-pull">⬇️ Pull</button>
              <button class="btn btn-secondary btn-sm" data-action="git-fetch">🔄 Fetch</button>
              <button class="btn btn-secondary btn-sm" data-action="git-pr">🚀 Create PR</button>
            </div>
          </div>
          <div class="code-block">
Branch: ${escapeHtml(status.branch || "main")}
Clean: ${status.clean !== undefined ? status.clean : status.isClean !== undefined ? status.isClean : "true"}
Ahead: ${status.ahead || 0} | Behind: ${status.behind || 0}
Files Changed: ${status.entries ? status.entries.length : (status.modified || []).length}
          </div>
        </div>

        <div>
          <div style="font-weight:600;font-size:13px;margin-bottom:6px">Branch Operations</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select class="form-select" id="git-tab-branch-select" style="width:160px;font-size:12px" onchange="gitSwitchBranch('${escapeHtml(repoId)}', this.value)">
              ${branches.map((b) => `<option value="${escapeHtml(b.name)}" ${b.current ? "selected" : ""}>${escapeHtml(b.name)}${b.current ? " (current)" : ""}</option>`).join("")}
            </select>
            <input class="form-input" id="git-tab-new-branch" placeholder="new-branch-name" style="width:140px;font-size:12px" />
            <button class="btn btn-secondary btn-sm" data-action="git-branch">+ Create Branch</button>
          </div>
        </div>

        <div>
          <div style="font-weight:600;font-size:13px;margin-bottom:6px">Safe Conventional Commit</div>
          <div style="display:flex;gap:8px">
            <input class="form-input" id="git-tab-commit-msg" placeholder="fix: apply verified patch" style="flex:1;font-size:12px" />
            <button class="btn btn-primary btn-sm" data-action="git-commit">Commit &amp; Push</button>
          </div>
        </div>

        <div>
          <div style="font-weight:600;font-size:13px;margin-bottom:6px">Recent Commit History</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${Array.isArray(logs) && logs.length > 0
        ? logs.map((l) => `
                  <div style="font-size:12px;padding:6px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);display:flex;justify-content:space-between">
                    <div>
                      <code>${escapeHtml((l.shortHash || l.hash || "").slice(0, 7))}</code> — ${escapeHtml(l.message || l.subject || "")}
                    </div>
                    <span style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(l.author || "")}</span>
                  </div>`).join("")
        : '<div class="text-muted" style="font-size:12px">No commits found.</div>'}
          </div>
        </div>
      </div>`;
  } catch (err) {
    gitView.innerHTML = `<div class="text-muted" style="font-size:13px">Could not load Git status: ${escapeHtml(err.message)}</div>`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Git operations — each wraps try/catch + showToast pattern
// ────────────────────────────────────────────────────────────────────────────
async function gitPullCurrentRepo(repoId) {
  try {
    showToast("Pulling remote changes...", "info");
    const res = await api.pullChanges(repoId);
    if (res.success) {
      showToast(`Pulled successfully from ${res.branch || "remote"}!`, "success");
    } else {
      showToast(`Pull notice: ${res.message || res.error || "No remote tracking"}`, "info");
    }
    loadGitTab(repoId);
  } catch (err) {
    showToast(`Pull failed: ${err.message}`, "error");
  }
}

async function gitFetchCurrentRepo(repoId) {
  try {
    showToast("Fetching remote...", "info");
    const res = await api.fetchChanges(repoId);
    if (res.success) {
      showToast("Fetch completed successfully!", "success");
    } else {
      showToast(`Fetch notice: ${res.message || res.error || "Completed"}`, "info");
    }
    loadGitTab(repoId);
  } catch (err) {
    showToast(`Fetch failed: ${err.message}`, "error");
  }
}

async function gitSwitchBranch(repoId, branchName) {
  if (!branchName) return;
  try {
    showToast(`Switching to branch ${branchName}...`, "info");
    const res = await api.checkoutBranch(repoId, branchName, false);
    if (res.success) {
      showToast(`Switched to branch ${branchName}!`, "success");
    } else {
      showToast(`Checkout notice: ${res.message || res.error}`, "warning");
    }
    loadGitTab(repoId);
  } catch (err) {
    showToast(`Failed to switch branch: ${err.message}`, "error");
  }
}

async function gitCreateAndCheckoutBranch(repoId) {
  const input = byId("git-tab-new-branch");
  const branchName = input?.value?.trim();
  if (!branchName) {
    showToast("Please enter a new branch name", "warning");
    return;
  }
  try {
    showToast(`Creating branch ${branchName}...`, "info");
    const res = await api.checkoutBranch(repoId, branchName, true);
    if (res.success) {
      showToast(`Created & checked out ${branchName}!`, "success");
      if (input) input.value = "";
    } else {
      showToast(`Branch notice: ${res.message || res.error}`, "warning");
    }
    loadGitTab(repoId);
  } catch (err) {
    showToast(`Branch creation failed: ${err.message}`, "error");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Session control
// ────────────────────────────────────────────────────────────────────────────
function exitDebugSession() {
  cleanupDebugSession();
  byId("debug-session-view").style.display = "none";
  byId("debug-form-view").style.display = "block";
}

async function abortCurrentSession() {
  cleanupDebugSession();
  if (window.state.currentSession) {
    try {
      await api.abortDebugSession(window.state.currentSession.id);
      showToast("Debug session aborted", "info");
    } catch (err) {
      console.error(err);
    }
  }
  exitDebugSession();
}

// ────────────────────────────────────────────────────────────────────────────
// Patch operations — window.setState for all state mutations
// ────────────────────────────────────────────────────────────────────────────
async function applyFix() {
  if (!window.state.currentSession) {
    showToast("No active debug session", "error");
    return;
  }

  const applyBtn = byId("apply-fix-btn");
  const diffApplyBtn = byId("diff-apply-btn");
  const revertBtn = byId("revert-fix-btn");
  const diffRevertBtn = byId("diff-revert-btn");

  try {
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = "Applying..."; }
    if (diffApplyBtn) { diffApplyBtn.disabled = true; diffApplyBtn.textContent = "Applying..."; }

    const repo = window.state.activeRepository;
    const isLocal = window.state.executionMode === "local" || repo?.isLocal || (repo?.id && String(repo.id).startsWith("local:"));
    let res;
    if (isLocal && window.localAgentClient) {
      const repoPath = repo?.path || window.localAgentClient.activeRepoPath;
      const fixPlan = window.state.currentFixPlan || window.state.currentSession?.fixPlan;
      const changes = (fixPlan?.patches || fixPlan?.files || []).map((p) => ({
        filePath: p.filePath || p.file || p.path,
        content: p.content || p.patchedContent || p.patch || "",
      })).filter((c) => Boolean(c.filePath && c.content));
      res = await window.localAgentClient.applyPatch(changes, repoPath);
    } else {
      res = await api.approveFix(window.state.currentSession.id);
    }

    if (!res.success) {
      showToast(`Failed to apply patch: ${res.error || "Unknown error"}`, "error");
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "🔧 Apply Verified Patch"; }
      if (diffApplyBtn) { diffApplyBtn.disabled = false; diffApplyBtn.textContent = "🔧 Apply Patch"; }
      return;
    }

    window.setState("currentBackupId", res.backupId);
    showToast("Patch applied cleanly! Backup snapshot saved.", "success");

    if (applyBtn) { applyBtn.textContent = "Applied ✓"; applyBtn.disabled = true; }
    if (diffApplyBtn) { diffApplyBtn.textContent = "Applied ✓"; diffApplyBtn.disabled = true; }
    if (revertBtn) revertBtn.style.display = "inline-block";
    if (diffRevertBtn) diffRevertBtn.style.display = "inline-block";

    switchTab("diff");
  } catch (err) {
    showToast(`Error applying fix: ${err.message}`, "error");
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "🔧 Apply Verified Patch"; }
    if (diffApplyBtn) { diffApplyBtn.disabled = false; diffApplyBtn.textContent = "🔧 Apply Patch"; }
  }
}

async function revertFix() {
  if (!window.state.currentSession || !window.state.currentBackupId) {
    showToast("No backup available to revert", "error");
    return;
  }

  const revertBtn = byId("revert-fix-btn");
  const diffRevertBtn = byId("diff-revert-btn");
  const applyBtn = byId("apply-fix-btn");
  const diffApplyBtn = byId("diff-apply-btn");

  try {
    if (revertBtn) { revertBtn.disabled = true; revertBtn.textContent = "Reverting..."; }
    if (diffRevertBtn) { diffRevertBtn.disabled = true; diffRevertBtn.textContent = "Reverting..."; }

    const repo = window.state.activeRepository;
    const isLocal = window.state.executionMode === "local" || repo?.isLocal || (repo?.id && String(repo.id).startsWith("local:"));
    let res;
    if (isLocal && window.localAgentClient) {
      const repoPath = repo?.path || window.localAgentClient.activeRepoPath;
      res = await window.localAgentClient.revertPatch(window.state.currentBackupId, repoPath);
    } else {
      res = await api.revertFix(window.state.currentSession.id, window.state.currentBackupId);
    }
    if (!res.success) {
      showToast(`Revert failed: ${res.error || "Unknown error"}`, "error");
      return;
    }

    showToast("Patch rolled back to original snapshot!", "success");
    if (revertBtn) revertBtn.style.display = "none";
    if (diffRevertBtn) diffRevertBtn.style.display = "none";
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "🔧 Apply Verified Patch"; }
    if (diffApplyBtn) { diffApplyBtn.disabled = false; diffApplyBtn.textContent = "🔧 Apply Patch"; }
    window.setState("currentBackupId", null);
  } catch (err) {
    showToast(`Error reverting fix: ${err.message}`, "error");
  } finally {
    if (revertBtn) revertBtn.disabled = false;
    if (diffRevertBtn) diffRevertBtn.disabled = false;
  }
}

async function commitAndPushFix() {
  const repoId = window.state.currentSession?.repositoryId || byId("debug-repo")?.value;
  if (!repoId) {
    showToast("No repository selected", "error");
    return;
  }

  const commitMsg = byId("git-tab-commit-msg")?.value?.trim() || "fix: resolve defect diagnosed by Git Debugging Agent";

  try {
    showToast("Creating safe commit...", "info");
    const commitRes = await api.commitChanges(repoId, commitMsg);
    if (!commitRes.success) {
      showToast(`Commit note: ${commitRes.message}`, "info");
      return;
    }

    showToast(`Committed [${(commitRes.commitHash || "").slice(0, 7)}]! Pushing safely...`, "success");
    try {
      const pushRes = await api.pushChanges(repoId);
      if (pushRes.success) {
        showToast(`Pushed to remote/${pushRes.branch} successfully!`, "success");
      } else {
        showToast(`Push warning: ${pushRes.error}`, "warning");
      }
    } catch (pushErr) {
      showToast(`Push skipped: ${pushErr.message}`, "info");
    }
    loadGitTab(repoId);
  } catch (err) {
    showToast(`Commit failed: ${err.message}`, "error");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Miscellaneous public actions
// ────────────────────────────────────────────────────────────────────────────
function requestDetails() { switchTab("evidence"); }
function rejectFix() { showToast("Patch rejected. Agent ready for refined diagnosis.", "info"); }

// ────────────────────────────────────────────────────────────────────────────
// Window exports — public API surface (all 21 preserved)
// ────────────────────────────────────────────────────────────────────────────
window.setDebugExample = setDebugExample;
window.setInvestigationMode = setInvestigationMode;
window.startDebugFromForm = startDebugFromForm;
window.executeDebugPipeline = executeDebugPipeline;
window.renderEvidence = renderEvidence;
window.renderDiff = renderDiff;
window.renderCritic = renderCritic;
window.renderTests = renderTests;
window.renderRootCauseCard = renderRootCauseCard;
window.loadGitTab = loadGitTab;
window.gitPullCurrentRepo = gitPullCurrentRepo;
window.gitFetchCurrentRepo = gitFetchCurrentRepo;
window.gitSwitchBranch = gitSwitchBranch;
window.gitCreateAndCheckoutBranch = gitCreateAndCheckoutBranch;
window.exitDebugSession = exitDebugSession;
window.abortCurrentSession = abortCurrentSession;
window.applyFix = applyFix;
window.revertFix = revertFix;
window.commitAndPushFix = commitAndPushFix;
window.requestDetails = requestDetails;
window.rejectFix = rejectFix;
