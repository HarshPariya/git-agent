/**
 * Git Debugging Agent — Workspace A (AI Debugging) View Module
 * End-to-end investigation pipeline, candidate hypotheses,
 * AST symbol lookup, GraphRAG code intelligence, and surgical patch verification.
 */

// ── State color lookup (object over ternary chains) ─────────────────────────
const STATE_COLORS = {
  INITIALIZING: { bg: "rgba(99, 102, 241, 0.18)", color: "#a5b4fc" },
  SCANNING_REPOSITORY: { bg: "rgba(59, 130, 246, 0.18)", color: "#93c5fd" },
  ISOLATING_DEFECT: { bg: "rgba(59, 130, 246, 0.18)", color: "#93c5fd" },
  REPRODUCING_BEHAVIOR: { bg: "rgba(14, 165, 233, 0.18)", color: "#7dd3fc" },
  GENERATING_HYPOTHESES: { bg: "rgba(245, 158, 11, 0.18)", color: "#fcd34d" },
  DIAGNOSING_ROOT_CAUSE: { bg: "rgba(245, 158, 11, 0.18)", color: "#fcd34d" },
  SYNTHESIZING_PATCH: { bg: "rgba(16, 185, 129, 0.18)", color: "#6ee7b7" },
  VALIDATING_PATCH_SAFETY: { bg: "rgba(16, 185, 129, 0.18)", color: "#6ee7b7" },
  RUNNING: { bg: "rgba(245, 158, 11, 0.18)", color: "#fcd34d" },
  COMPLETED: { bg: "rgba(16, 185, 129, 0.18)", color: "#34d399" },
  FAILED: { bg: "rgba(239, 68, 68, 0.18)", color: "#fca5a5" },
  ABORTED: { bg: "rgba(239, 68, 68, 0.18)", color: "#fca5a5" },
  ISOLATE_IN_PROGRESS: { bg: "rgba(59, 130, 246, 0.18)", color: "#93c5fd" },
  REPRODUCE_IN_PROGRESS: { bg: "rgba(14, 165, 233, 0.18)", color: "#7dd3fc" },
  DIAGNOSE_IN_PROGRESS: { bg: "rgba(245, 158, 11, 0.18)", color: "#fcd34d" },
  FIX_IN_PROGRESS: { bg: "rgba(16, 185, 129, 0.18)", color: "#6ee7b7" },
  VERIFY_IN_PROGRESS: { bg: "rgba(16, 185, 129, 0.18)", color: "#6ee7b7" },
  OBSERVE_IN_PROGRESS: { bg: "rgba(59, 130, 246, 0.18)", color: "#93c5fd" },
};

const getResolvedState = (s) => ({ bg: "rgba(99, 102, 241, 0.18)", color: "#a5b4fc", ...STATE_COLORS[s] });

// ── Step-to-phase mapping ──────────────────────────────────────────────────
const STEP_TO_PHASE = {
  triage: "triage",
  isolate: "triage",
  context: "context",
  observe: "context",
  search: "search",
  ast: "search",
  test_disc: "test_disc",
  reproduce: "test_disc",
  git_hist: "git_hist",
  history: "git_hist",
  hypothesis: "hypothesis",
  evidence: "evidence",
  diagnose: "root_cause",
  root_cause: "root_cause",
  fix: "fix_plan",
  fix_plan: "fix_plan",
  critic: "critic",
  patch: "patch",
  verify: "verify",
  test: "verify",
  delivery: "delivery",
  commit: "delivery",
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

// ── Shared phase UI state setters ──────────────────────────────────────────
function setPhaseRunning(phaseId, desc) {
  const phaseEl = byId(`phase-${phaseId}`);
  const iconEl = byId(`icon-${phaseId}`);
  const descEl = byId(`desc-${phaseId}`);
  if (phaseEl) {
    phaseEl.className = "agent-phase active";
  }
  if (iconEl) {
    iconEl.className = "agent-phase-icon active";
    iconEl.textContent = "⚡";
  }
  if (descEl && desc) {
    descEl.textContent = desc;
  }
}

function setPhaseDone(phaseId, result) {
  const phaseEl = byId(`phase-${phaseId}`);
  const iconEl = byId(`icon-${phaseId}`);
  const descEl = byId(`desc-${phaseId}`);
  if (phaseEl) {
    phaseEl.className = "agent-phase completed";
  }
  if (iconEl) {
    iconEl.className = "agent-phase-icon completed";
    iconEl.textContent = "✓";
  }
  if (descEl && result) {
    descEl.textContent = result;
  }
}

function setPhaseFailed(phaseId, err) {
  const phaseEl = byId(`phase-${phaseId}`);
  const iconEl = byId(`icon-${phaseId}`);
  const descEl = byId(`desc-${phaseId}`);
  if (phaseEl) {
    phaseEl.className = "agent-phase failed";
  }
  if (iconEl) {
    iconEl.className = "agent-phase-icon failed";
    iconEl.textContent = "✗";
  }
  if (descEl && err) {
    descEl.textContent = err;
  }
}

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

  // If local repository is active, selectively bundle relevant context and diff
  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      const fs = window.gitLocalEngine.getFS(window._activeLocalDirHandle);
      const localContextParts = [];

      // Include active git diff if any
      const diff = await window.gitLocalEngine.getDiff(window._activeLocalDirHandle, "").catch(() => "");
      if (diff && diff.trim()) {
        localContextParts.push(`### Working Tree Git Diff:\n\`\`\`diff\n${diff.slice(0, 4000)}\n\`\`\``);
      }

      // Check package.json or pyproject.toml
      for (const manifest of ["package.json", "requirements.txt", "pyproject.toml"]) {
        try {
          const content = await fs.promises.readFile(manifest, { encoding: "utf8" });
          if (content) {
            localContextParts.push(`### ${manifest}:\n\`\`\`json\n${content.slice(0, 1500)}\n\`\`\``);
            break;
          }
        } catch (_) {}
      }

      // Find files mentioned in description or logs
      const combinedText = `${description} ${logs || ""}`;
      const mentionedPaths = (combinedText.match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+/g) || [])
        .filter((p) => p.includes("/") || p.endsWith(".js") || p.endsWith(".ts") || p.endsWith(".py") || p.endsWith(".html") || p.endsWith(".css"))
        .slice(0, 5);

      for (const p of mentionedPaths) {
        if (window.gitLocalEngine.isSensitiveFile(p)) continue;
        try {
          const content = await fs.promises.readFile(p, { encoding: "utf8" });
          if (content) {
            localContextParts.push(`### File: ${p}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
          }
        } catch (_) {}
      }

      if (localContextParts.length > 0) {
        queryParts.push(`### Local Codebase Context:\n${localContextParts.join("\n\n")}`);
      }
    } catch (localCtxErr) {
      console.warn("Could not bundle local context:", localCtxErr);
    }
  }

  const fullQuery = queryParts.join("\n\n");

  const repo = (window.state.repositories || []).find((r) => r.id === repoId);
  let repositoryContext = null;
  const isLocal = repo?.isLocal || repo?.mode === "LOCAL" || !!repo?.dirHandle || (window._activeLocalDirHandle && window._activeLocalDirHandle.name === repo?.name);

  if (isLocal && (repo?.dirHandle || window._activeLocalDirHandle) && window.gitLocalEngine) {
    const handle = repo?.dirHandle || window._activeLocalDirHandle;
    try {
      showToast(`Building repository manifest for "${handle.name}"...`, "info");
      repositoryContext = await window.gitLocalEngine.buildRepositoryIndex(handle);
    } catch (idxErr) {
      console.warn("Could not build full local index, using basic metadata:", idxErr);
    }
  }

  if (!repositoryContext && repo) {
    repositoryContext = {
      repositoryId: repo.id,
      workspaceId: repo.workspaceId || `ws_${repo.id}`,
      mode: repo.mode || (repo.isLocal ? "LOCAL" : "REMOTE"),
      displayName: repo.name,
      rootIdentifier: repo.localPath || repo.path || repo.name,
      branch: repo.currentBranch || repo.defaultBranch || repo.branch || "main",
      remoteUrl: repo.url || "",
      localPath: repo.localPath,
    };
  }

  const repoName = repositoryContext?.displayName || repo?.name || "Repository";
  const branchName = repositoryContext?.branch || repo?.currentBranch || repo?.defaultBranch || "main";
  const modeName = repositoryContext?.mode || (isLocal ? "LOCAL" : "REMOTE");
  const filesCount = repositoryContext?.fileManifest?.length ?? 0;
  const wsId = repositoryContext?.workspaceId || `ws_${repoId}`;

  // Switch to session view
  byId("debug-form-view").style.display = "none";
  byId("debug-session-view").style.display = "block";

  // Setup header & Current Repository Banner
  byId("session-repo-label").textContent = `Repository: ${repoName}`;
  byId("session-type-label").textContent = `Type: ${debugType.toUpperCase()}`;

  const bannerName = byId("session-repo-name");
  if (bannerName) bannerName.textContent = repoName;
  const bannerBranch = byId("session-repo-branch");
  if (bannerBranch) bannerBranch.textContent = `🌿 ${branchName}`;
  const bannerMode = byId("session-repo-mode");
  if (bannerMode) bannerMode.textContent = modeName;
  const bannerFiles = byId("session-repo-files");
  if (bannerFiles) bannerFiles.textContent = `${filesCount} files indexed`;
  const bannerWs = byId("session-repo-ws");
  if (bannerWs) bannerWs.textContent = `ws: ${wsId}`;

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
    `[${new Date().toLocaleTimeString()}] Starting debug session on ${repoName} (${modeName})...\n`;
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
  await executeDebugPipeline(repoId, fullQuery, debugType, repositoryContext);
}

// ────────────────────────────────────────────────────────────────────────────
// executeDebugPipeline — SSE-driven investigation pipeline
// ────────────────────────────────────────────────────────────────────────────
async function executeDebugPipeline(repoId, query, mode, repositoryContext = null) {
  cleanupDebugSession();
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
    { id: "triage", name: "1. Triage & Defect Classification", desc: "Extract symptoms, expected vs observed, affected subsystems" },
    { id: "context", name: "2. Repository Context & Structure", desc: "Inspect package manifest, configuration & entry points" },
    { id: "search", name: "3. Code Search & Symbol Analysis", desc: "AST definitions, imports, caller-callee dependency mapping" },
    { id: "test_disc", name: "4. Test Discovery & CI Check", desc: "Identify reproduction test cases & CI build logs" },
    { id: "git_hist", name: "5. Git History & Blame Inspection", desc: "Analyze commits, blame history & working tree diff" },
    { id: "hypothesis", name: "6. Hypothesis Generation & Ranking", desc: "Formulate candidate causes & evaluate against codebase" },
    { id: "evidence", name: "7. Evidence Engine & Traceability", desc: "Correlate code lines, git commits & stack traces" },
    { id: "root_cause", name: "8. Root Cause Isolation", desc: "Distinguish observed facts from AI inference" },
    { id: "fix_plan", name: "9. Fix Planning & Safety Strategy", desc: "Plan minimal surgical patch & rollback strategy" },
    { id: "critic", name: "10. Critic Agent Review", desc: "Safety gate: correctness, regression risk & security" },
    { id: "patch", name: "11. Patch Synthesis & Stale Protection", desc: "Generate unified diff with conflict & stale guards" },
    { id: "verify", name: "12. Test Execution & Verification", desc: "Run verification tests and evaluate proof of fix" },
    { id: "delivery", name: "13. Safe Commit & PR Delivery", desc: "Pre-commit secret scanning, atomic commit & PR" },
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
          <div style="padding:8px 10px;background:var(--c-surface-elevated, rgba(255,255,255,0.03));border:1px solid var(--c-border);border-radius:var(--r-sm)">
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
    window.setState("currentFixPlan", fixPlan);
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
    const pId = STEP_TO_PHASE[step.type] || "root_cause";
    const phaseIdx = phases.findIndex((p) => p.id === pId);
    if (phaseIdx > 0) {
      for (let i = 0; i < phaseIdx; i++) {
        setPhaseDone(phases[i].id);
      }
    }

    switch (step.status) {
      case "running":
        setPhaseRunning(pId, step.description || `Executing ${step.type}...`);
        updateState(`${step.type.toUpperCase()}_IN_PROGRESS`);
        appendLog(logsView, `[STEP RUNNING] ${step.description || step.type}`);
        break;
      case "completed":
        setPhaseDone(pId, step.result ? step.result.slice(0, 80) : `${step.description} ✓`);
        appendLog(logsView, `[STEP DONE] ${step.description || step.type} (${step.durationMs || 0}ms)`);
        break;
      case "failed":
        setPhaseFailed(pId, step.error || "Step failed");
        appendLog(logsView, `[STEP FAILED] ${step.description || step.type}: ${step.error}`);
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
    test: ({ data }) => {
      appendLog(logsView, `[TEST] ${data?.script || "test"}: ${data?.passed ? "PASS" : "FAIL"} (exit ${data?.exitCode}) `);
      const pill = byId("test-status-pill");
      if (pill) {
        pill.textContent = data?.passed ? "Passed" : "Failed";
        pill.className = data?.passed ? "badge badge-success" : "badge badge-danger";
      }
    },
    test_result: ({ data }) => appendLog(logsView, `[TEST] ${data?.name || "Test"}: ${data?.passed ? "PASS" : "FAIL"} `),
    test_output: ({ data }) => {
      const terminal = byId("tests-terminal");
      if (terminal) {
        if (terminal.dataset.started !== "1") {
          terminal.innerHTML = "";
          terminal.dataset.started = "1";
        }
        const lineEl = document.createElement("div");
        lineEl.style.fontFamily = "var(--font-mono)";
        lineEl.style.fontSize = "11.5px";
        lineEl.style.lineHeight = "1.4";
        lineEl.style.color = data?.type === "stderr" ? "#f87171" : "#38bdf8";
        lineEl.textContent = data?.output || "";
        terminal.appendChild(lineEl);
        terminal.scrollTop = terminal.scrollHeight;
      }
      const pill = byId("test-status-pill");
      if (pill) {
        pill.textContent = "Running tests...";
        pill.className = "badge badge-accent";
      }
    },
    steer: ({ data }) => {
      appendLog(logsView, `[STEER] Developer guidance acknowledged: "${data?.guidance || ""}"`);
      showToast("Agent acknowledged your guidance! Recalibrating...", "info");
    },
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

    const asyncRes = await api.runDebugAsync({ repositoryId: repoId, query, mode, repositoryContext });
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
        ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:11px;color:var(--c-text-muted)">
               <strong>Evidence:</strong> ${escapeHtml(Array.isArray(f.evidence) ? f.evidence.join("; ") : String(f.evidence))}
             </div>`
        : ""}
      </div>`)
    .join("");
}

// ────────────────────────────────────────────────────────────────────────────
// renderDiff — object-lookup for diff line CSS class
// ────────────────────────────────────────────────────────────────────────────
// renderDiff — renders surgical patch with summary metrics bar
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

  const filesCount = fixPlan.filesToChange.length;
  const diffText = fixPlan.filesToChange
    .map((f) => f.patch || `--- a/${f.filePath}\n+++ b/${f.filePath}\n@@ -1,5 +1,6 @@\n// ${f.description || "apply surgical fix"}`)
    .join("\n\n");

  const lines = diffText.split("\n");
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.startsWith("+") && !l.startsWith("+++")) additions++;
    else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
  }

  const testsAdded = (fixPlan.testsToRun || ["test"]).join(", ");
  const risk = fixPlan.riskLevel || "MODERATE";

  const coloredLines = lines.map((line) => {
    const prefix = line[0];
    const cls = prefix ? (DIFF_LINE_CLASS[prefix] ?? (line.startsWith("@@") ? "diff-line diff-info" : DEFAULT_DIFF_CLASS)) : DEFAULT_DIFF_CLASS;
    return `<span class="${cls}">${escapeHtml(line)}</span>`;
  });

  container.innerHTML = `
    <div class="patch-summary-bar">
      <div class="patch-metrics-group">
        <span class="patch-stat-files"><strong>${filesCount}</strong> ${filesCount === 1 ? "file" : "files"} changed</span>
        <span class="patch-stat-add">+${additions}</span>
        <span class="patch-stat-del">-${deletions}</span>
        <span class="badge risk-${risk.toLowerCase()}">${risk} RISK</span>
      </div>
      <div style="font-size:11px;color:var(--c-text-muted);display:flex;align-items:center;gap:6px">
        <span>Verification Script: <code>${escapeHtml(testsAdded)}</code></span>
      </div>
    </div>
    <div class="diff-viewer">${coloredLines.join("")}</div>`;
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

      <div class="critic-summary-box">
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

  const execMode = tr.executionMode || (window._activeLocalDirHandle ? "LOCAL ANALYSIS" : "CLOUD EXECUTION");
  const output = [tr.stdout, tr.stderr].filter(Boolean).join("\n").trim();
  const duration = typeof tr.durationMs === "number" ? ` · ${tr.durationMs}ms` : "";

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);background:var(--c-surface)">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="color:${color};font-size:16px">${icon}</span>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px">
              <span>Test: <span style="font-family:var(--font-mono)">${escapeHtml(tr.script || "test")}</span></span>
              <span class="badge badge-secondary" style="font-size:10px">${escapeHtml(execMode)}</span>
            </div>
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
// renderRootCauseCard — separate Observed Facts from AI Inference
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
      riskBadge.textContent = `${fixPlan.riskLevel || "MODERATE"} RISK`;
      riskBadge.className = `badge risk-${(fixPlan.riskLevel || "moderate").toLowerCase()}`;
    }
  }

  const confidenceBadge = byId("root-cause-confidence");
  if (confidenceBadge) {
    const conf = fixPlan?.confidence ? Math.round(fixPlan.confidence * 100) : 92;
    confidenceBadge.textContent = isClean ? "100% Confidence" : `${conf}% Confidence`;
    confidenceBadge.className = conf >= 80 ? "badge badge-success" : "badge badge-warning";
  }

  const rootCauseContent = byId("root-cause-content");
  if (rootCauseContent) {
    const filesList = (fixPlan?.filesToChange || []).map((f) => (typeof f === "string" ? f : f.filePath));
    const evidenceItems = Array.isArray(fixPlan?.evidence)
      ? fixPlan.evidence
      : result.findings?.[0]?.evidence || [];

    rootCauseContent.innerHTML = `
      <div style="font-size:13px;color:var(--c-text);line-height:1.5">
        <strong>Diagnosis Summary:</strong> ${escapeHtml(fixPlan?.rootCause || result.summary || "No defects detected across repository.")}
      </div>

      <div class="rc-dual-panel">
        <div class="rc-section-card">
          <div class="rc-section-title rc-observed-facts-title">
            <span>🔬</span> OBSERVED FACTS (Verifiable)
          </div>
          <div style="font-size:12px;display:flex;flex-direction:column;gap:6px">
            <div><strong>Affected Files:</strong> ${filesList.length ? filesList.map((f) => `<code style="font-size:11px">${escapeHtml(f)}</code>`).join(", ") : "None (clean)"}</div>
            <div><strong>Evidence Points:</strong> ${evidenceItems.length ? evidenceItems.map((e) => `<div style="font-size:11px;color:var(--c-text-secondary);margin-top:2px">• ${escapeHtml(e)}</div>`).join("") : "Automated AST scan & Git blame clean"}</div>
            <div><strong>Symptom:</strong> <span style="color:var(--c-text-secondary)">${escapeHtml(result.summary || "Failing execution path")}</span></div>
          </div>
        </div>

        <div class="rc-section-card">
          <div class="rc-section-title rc-ai-inference-title">
            <span>🧠</span> AI REASONING &amp; IMPACT
          </div>
          <div style="font-size:12px;display:flex;flex-direction:column;gap:6px">
            <div><strong>Mechanism:</strong> <span style="color:var(--c-text-secondary)">${escapeHtml(fixPlan?.estimatedImpact || "Direct defect path isolated with GraphRAG call-graph mapping.")}</span></div>
            <div><strong>Rollback Strategy:</strong> <span style="color:var(--c-text-secondary)">${escapeHtml(fixPlan?.rollbackStrategy || "Standard git checkout revert")}</span></div>
            <div><strong>Approval Required:</strong> <span class="badge ${fixPlan?.requiresApproval ? "badge-warning" : "badge-secondary"}" style="font-size:10px">${fixPlan?.requiresApproval ? "YES" : "NO"}</span></div>
          </div>
        </div>
      </div>`;
  }

  const applyBtn = byId("apply-fix-btn");
  if (applyBtn) {
    applyBtn.style.display = isClean ? "none" : "inline-flex";
  }
  const commitBtn = byId("commit-fix-btn");
  if (commitBtn) {
    commitBtn.style.display = isClean ? "none" : "inline-flex";
  }

  card.style.display = "block";
}

// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// Helper: Detect if repo is local folder handle
// ────────────────────────────────────────────────────────────────────────────
function isLocalRepo(repoId) {
  if (repoId && typeof repoId === "string" && repoId.startsWith("local-")) return true;
  const repo = (window.state?.repositories || []).find((r) => r.id === repoId) ||
    (window.state?.activeRepository?.id === repoId ? window.state.activeRepository : null);
  if (repo?.isLocal) return true;
  if (window._activeLocalDirHandle && (!repoId || repoId === "local" || repo?.name === window._activeLocalDirHandle.name)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// loadGitTab — renders git status, branch ops, commit form, recent history
// ────────────────────────────────────────────────────────────────────────────
async function loadGitTab(repoId) {
  const gitView = byId("git-view");
  if (!gitView) return;

  if (!repoId) {
    repoId = window.state?.currentSession?.repositoryId || window.state?.activeRepository?.id;
  }

  // Support local repositories directly via in-browser isomorphic-git engine
  if (isLocalRepo(repoId) && window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      const [status, branchesData, logs] = await Promise.all([
        window.gitLocalEngine.getStatus(window._activeLocalDirHandle),
        window.gitLocalEngine.listBranches(window._activeLocalDirHandle).catch(() => ({ branches: ["main"], currentBranch: "main" })),
        window.gitLocalEngine.getHistory(window._activeLocalDirHandle, 5).catch(() => []),
      ]);

      const currentBranch = branchesData.currentBranch || status.branch || "main";
      const branchList = (Array.isArray(branchesData.branches) ? branchesData.branches : [currentBranch]).map((b) => {
        const name = typeof b === "string" ? b : (b.name || "main");
        return { name, current: name === currentBranch };
      });

      gitView.dataset.repoId = repoId || "local";
      gitView.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="font-weight:600;font-size:13px;color:var(--c-text)">Working Tree Status (Local)</div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-secondary btn-sm" data-action="git-pull">⬇️ Pull</button>
                <button class="btn btn-secondary btn-sm" data-action="git-fetch">🔄 Fetch</button>
                <button class="btn btn-secondary btn-sm" data-action="git-pr">🚀 Create PR</button>
              </div>
            </div>
            <div class="code-block">
Branch: ${escapeHtml(currentBranch)}
Clean: ${status.clean}
Files Changed: ${(status.entries || []).length}
${(status.entries || []).slice(0, 10).map((e) => `  ${e.staged ? "[staged] " : ""}${e.status}: ${e.filePath}`).join("\n")}
            </div>
          </div>

          <div>
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--c-text)">Branch Operations</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select class="form-select" id="git-tab-branch-select" style="width:160px;font-size:12px" onchange="gitSwitchBranch('${escapeHtml(repoId || "local")}', this.value)">
                ${branchList.map((b) => `<option value="${escapeHtml(b.name)}" ${b.current ? "selected" : ""}>${escapeHtml(b.name)}${b.current ? " (current)" : ""}</option>`).join("")}
              </select>
              <input class="form-input" id="git-tab-new-branch" placeholder="new-branch-name" style="width:140px;font-size:12px" />
              <button class="btn btn-secondary btn-sm" data-action="git-branch">+ Create Branch</button>
            </div>
          </div>

          <div>
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--c-text)">Safe Conventional Commit</div>
            <div style="display:flex;gap:8px">
              <input class="form-input" id="git-tab-commit-msg" placeholder="fix: apply verified patch" style="flex:1;font-size:12px" />
              <button class="btn btn-primary btn-sm" data-action="git-commit">Commit &amp; Push</button>
            </div>
          </div>

          <div>
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--c-text)">Recent Commit History</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${Array.isArray(logs) && logs.length > 0
          ? logs.map((l) => `
                    <div style="font-size:12px;padding:6px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);display:flex;justify-content:space-between">
                      <div>
                        <code>${escapeHtml((l.shortSha || l.shortHash || l.hash || "").slice(0, 7))}</code> — ${escapeHtml(l.subject || l.message || "")}
                      </div>
                      <span style="font-size:11px;color:var(--c-text-muted)">${escapeHtml(l.author || "")}</span>
                    </div>`).join("")
          : '<div class="text-muted" style="font-size:12px">No commits found.</div>'}
            </div>
          </div>
        </div>`;
      return;
    } catch (localErr) {
      console.warn("Could not load local Git tab via isomorphic-git:", localErr);
    }
  }

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
    if (isLocalRepo(repoId) && window._activeLocalDirHandle && window.gitLocalEngine?.pull) {
      const gitHubToken = localStorage.getItem("gda_github_pat") || localStorage.getItem("github_token");
      await window.gitLocalEngine.pull(window._activeLocalDirHandle, { token: gitHubToken });
      showToast("Pulled latest changes into local repository!", "success");
      loadGitTab(repoId);
      return;
    }
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
    if (isLocalRepo(repoId) && window._activeLocalDirHandle && window.gitLocalEngine?.fetch) {
      const gitHubToken = localStorage.getItem("gda_github_pat") || localStorage.getItem("github_token");
      await window.gitLocalEngine.fetch(window._activeLocalDirHandle, { token: gitHubToken });
      showToast("Fetch completed successfully!", "success");
      loadGitTab(repoId);
      return;
    }
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
    if (isLocalRepo(repoId) && window._activeLocalDirHandle && window.gitLocalEngine) {
      await window.gitLocalEngine.checkoutBranch(window._activeLocalDirHandle, branchName);
      showToast(`Switched to branch ${branchName}!`, "success");
      loadGitTab(repoId);
      return;
    }
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
    if (isLocalRepo(repoId) && window._activeLocalDirHandle && window.gitLocalEngine) {
      await window.gitLocalEngine.createBranch(window._activeLocalDirHandle, branchName);
      showToast(`Created & checked out ${branchName}!`, "success");
      if (input) input.value = "";
      loadGitTab(repoId);
      return;
    }
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

  const session = window.state.currentSession;
  const fixPlan = window.state.currentFixPlan || session?.fixPlan;

  // Local directory handle: apply patch directly to user's local PC folder files
  if (window._activeLocalDirHandle && window.gitLocalEngine && fixPlan?.filesToChange?.length) {
    try {
      if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = "Applying to files..."; }
      if (diffApplyBtn) { diffApplyBtn.disabled = true; diffApplyBtn.textContent = "Applying to files..."; }

      const fs = window.gitLocalEngine.getFS(window._activeLocalDirHandle);
      const appliedFiles = [];

      for (const fc of fixPlan.filesToChange) {
        if (!fc.filePath) continue;
        let original = "";
        try {
          original = await fs.promises.readFile(fc.filePath, { encoding: "utf8" });
        } catch (_) {}

        let newContent = fc.newContent || fc.suggestedCode;
        if (!newContent && fc.patch) {
          const lines = fc.patch.split("\n");
          const minusLines = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1).trim()).filter(Boolean);
          const plusLines = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).filter(Boolean);
          newContent = original;
          for (let i = 0; i < minusLines.length; i++) {
            const target = minusLines[i];
            const rep = plusLines[i] ?? "";
            if (target && newContent.includes(target)) {
              newContent = newContent.replace(target, rep);
            }
          }
        }
        if (!newContent) newContent = original;

        await window.gitLocalEngine.applyPatch(window._activeLocalDirHandle, fc.filePath, newContent);
        appliedFiles.push(fc.filePath);
      }

      await api.approveFix(session.id, { appliedLocally: true }).catch(() => {});

      showToast(`Applied patch to ${appliedFiles.length} file(s) in local folder!`, "success");
      if (applyBtn) { applyBtn.textContent = "Applied ✓"; applyBtn.disabled = true; }
      if (diffApplyBtn) { diffApplyBtn.textContent = "Applied ✓"; diffApplyBtn.disabled = true; }

      // Update Git Desktop view with the real newly modified files
      if (typeof window.loadGitDesktop === "function") {
        await window.loadGitDesktop(false);
      }
      return;
    } catch (err) {
      showToast(`Local patch error: ${err.message}`, "error");
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = "🔧 Apply Verified Patch"; }
      if (diffApplyBtn) { diffApplyBtn.disabled = false; diffApplyBtn.textContent = "🔧 Apply Patch"; }
      return;
    }
  }

  try {
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = "Applying..."; }
    if (diffApplyBtn) { diffApplyBtn.disabled = true; diffApplyBtn.textContent = "Applying..."; }

    const res = await api.approveFix(window.state.currentSession.id);
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

    const res = await api.revertFix(window.state.currentSession.id, window.state.currentBackupId);
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
  const repoId = window.state.currentSession?.repositoryId || byId("debug-repo")?.value || window.state.activeRepository?.id;
  const commitMsg = byId("git-tab-commit-msg")?.value?.trim() || "fix: resolve defect diagnosed by Git Debugging Agent";

  if (isLocalRepo(repoId) && window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      showToast("Staging changes in local repository...", "info");
      await window.gitLocalEngine.stageAll(window._activeLocalDirHandle);
      const commitRes = await window.gitLocalEngine.commit(window._activeLocalDirHandle, {
        message: commitMsg,
        author: { name: "AI Debugging Agent", email: "agent@gitdebugging.local" }
      });
      showToast(`Committed [${commitRes.shortSha || commitRes.sha.slice(0, 7)}] safely!`, "success");

      if (window.gitLocalEngine.push) {
        try {
          const gitHubToken = localStorage.getItem("gda_github_pat") || localStorage.getItem("github_token");
          await window.gitLocalEngine.push(window._activeLocalDirHandle, { token: gitHubToken });
          showToast("Pushed changes to remote!", "success");
        } catch (pushErr) {
          console.info("Local push notice:", pushErr.message);
        }
      }
      loadGitTab(repoId);
      return;
    } catch (err) {
      showToast(`Local commit failed: ${err.message}`, "error");
      return;
    }
  }

  if (!repoId) {
    showToast("No repository selected", "error");
    return;
  }

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
async function submitAgentSteer() {
  const session = window.state.currentSession;
  if (!session || !session.id) {
    showToast("No active debugging session to steer", "warning");
    return;
  }
  const input = document.getElementById("steer-guidance-input");
  const guidance = input?.value?.trim();
  if (!guidance) {
    showToast("Please enter guidance for the agent", "warning");
    input?.focus();
    return;
  }

  const btn = document.getElementById("steer-guidance-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Steering...";
  }

  try {
    await api.debugSteer(session.id, guidance);
    showToast("Guidance sent to AI Debugging Agent!", "success");
    if (input) input.value = "";
    appendLog(byId("logs-view"), `[STEER SENT] ${guidance}`);
  } catch (err) {
    showToast(`Failed to steer agent: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🎯 Send Guidance";
    }
  }
}

async function exportPostMortemMarkdown() {
  const session = window.state.currentSession;
  if (!session || !session.id) {
    showToast("No debug session available to export", "warning");
    return;
  }

  showToast("Generating Post-Mortem Report (.md)...", "info");
  try {
    const res = await api.debugExportMarkdown(session.id);
    const markdown = res.markdown || (typeof res === "string" ? res : JSON.stringify(res, null, 2));

    // Download as file
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-mortem-${session.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Also copy to clipboard for convenience
    try {
      await navigator.clipboard.writeText(markdown);
      showToast("Report downloaded & copied to clipboard!", "success");
    } catch (_) {
      showToast("Report downloaded successfully!", "success");
    }
  } catch (err) {
    showToast(`Export failed: ${err.message}`, "error");
  }
}

function openPatchEditorModal() {
  const fixPlan = window.state.currentFixPlan || window.state.currentSession?.fixPlan;
  if (!fixPlan || !fixPlan.filesToChange || !fixPlan.filesToChange.length) {
    showToast("No proposed patch to edit", "warning");
    return;
  }

  const firstFile = fixPlan.filesToChange[0];
  const filePath = typeof firstFile === "string" ? firstFile : firstFile.filePath;
  const content = typeof firstFile === "object" ? (firstFile.modifiedContent || firstFile.content || "") : "";

  const badge = document.getElementById("patch-editor-file-badge");
  const textarea = document.getElementById("patch-editor-textarea");
  if (badge) badge.textContent = filePath || "Modified File";
  if (textarea) {
    textarea.value = content;
    textarea.dataset.filePath = filePath;
  }

  const modal = document.getElementById("modal-patch-editor");
  if (modal) modal.style.display = "flex";
}

async function submitCustomPatchApproval() {
  const session = window.state.currentSession;
  if (!session || !session.id) return;
  const textarea = document.getElementById("patch-editor-textarea");
  const filePath = textarea?.dataset?.filePath;
  const modifiedContent = textarea?.value;

  if (!filePath) {
    showToast("No target file specified", "warning");
    return;
  }

  const btn = document.getElementById("btn-apply-custom-patch");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Applying...";
  }

  try {
    const customFiles = [{ filePath, modifiedContent }];
    const res = await api.debugApproveCustomFix(session.id, customFiles);
    showToast("Custom patch approved and applied!", "success");
    closeModal("modal-patch-editor");

    // Refresh diff view with updated fix
    if (res.session?.fixPlan) {
      window.setState("currentFixPlan", res.session.fixPlan);
      renderDiff(res.session.fixPlan, res.session.findings || []);
    }
  } catch (err) {
    showToast(`Failed to apply custom patch: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✅ Apply Verified Custom Patch";
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Miscellaneous public actions
// ────────────────────────────────────────────────────────────────────────────
function requestDetails() { switchTab("evidence"); }
function rejectFix() { showToast("Patch rejected. Agent ready for refined diagnosis.", "info"); }

// ────────────────────────────────────────────────────────────────────────────
// Window exports — public API surface
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
window.isLocalRepo = isLocalRepo;
window.loadGitTab = loadGitTab;
window.loadGitDesktop = async function (manual) {
  const rId = window.state?.activeRepository?.id || window.state?.currentSession?.repositoryId;
  return loadGitTab(rId);
};
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
window.submitAgentSteer = submitAgentSteer;
window.exportPostMortemMarkdown = exportPostMortemMarkdown;
window.openPatchEditorModal = openPatchEditorModal;
window.submitCustomPatchApproval = submitCustomPatchApproval;
