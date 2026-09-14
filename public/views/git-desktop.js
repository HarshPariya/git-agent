/**
 * Git Debugging Agent — Workspace B (Git Desktop) View Module
 * Full GitHub Desktop-style workflow:
 * - Changed files, status tracking, staging filters (all, staged, unstaged, untracked)
 * - Single-file diff inspection & Continuous multi-file all changes diff
 * - Groq Conventional Commit generator with scope & bulleted breakdown
 * - Semantic AI Commit Plan grouping with One-Click 'AI Commit All'
 * - Branch switcher with fast search and instant new branch checkout
 * - Push preview modal with branch target selection and safety policy check
 * - Executive Post-Push summary card with recent commits and PR launch
 */

let allRepoBranches = [];

// ── Lookups / Maps ────────────────────────────────────────────────────────────

const STATUS_CODE_MAP = { added: "A", deleted: "D", renamed: "R", untracked: "U", modified: "M", copied: "C" };
const RISK_BADGE_MAP = { high: "badge-danger", medium: "badge-warning" };
const STATUS_BADGE_MAP = {
  ADDED: "badge-success",
  DELETED: "badge-danger",
  UNTRACKED: "badge-accent",
  MODIFIED: "badge-warning",
  COPIED: "badge-info",
  RENAMED: "badge-info",
};
const TAB_PANEL_MAP = {
  "gd-diff": { btn: "gd-tab-btn-diff", panel: "panel-gd-diff" },
  "gd-all-diff": { btn: "gd-tab-btn-all-diff", panel: "panel-gd-all-diff" },
};
const LEFT_TAB_MAP = {
  changes: { tab: "gd-tab-changes", panel: "gd-panel-changes", style: "flex" },
  "commit-plan": { tab: "gd-tab-commit-plan", panel: "gd-panel-commit-plan", style: "flex" },
  history: { tab: "gd-tab-history", panel: "gd-panel-history", style: "block" },
};
const SCOPE_PRIORITY = [
  { has: (hasFrontend, hasApi) => hasFrontend && hasApi, value: "fullstack" },
  { has: (hasFrontend) => hasFrontend, value: "ui" },
  { has: (_, __, hasGit) => hasGit, value: "git" },
  { has: (_, hasApi) => hasApi, value: "api" },
  { has: (_, __, ___, hasTests) => hasTests, value: "tests" },
];
const DESCRIPTION_RULES = [
  { match: (p) => /api\.[jt]s$/.test(p), text: (p) => `- ${p}: add client API methods and backend endpoint handlers` },
  { match: (p) => /app\.[jt]s$/.test(p), text: (p) => `- ${p}: update application state management, event listeners, and UI views` },
  { match: (p) => p.includes("index.html"), text: (p) => `- ${p}: refine layout structure, modal dialogs, and interactive action controls` },
  { match: (p) => p.includes("styles.css"), text: (p) => `- ${p}: update design tokens, diff viewer syntax styling, and responsive layout rules` },
  { match: (p) => p.includes("git"), text: (p) => `- ${p}: enhance git operation engine, branch refspec resolution, and commit planning` },
  { match: (p) => p.includes("fs"), text: (p) => `- ${p}: expand filesystem navigation and OS file explorer dialog integration` },
];
const DESCRIPTION_DEFAULT = (p) => `- ${p}: apply component modifications and sync verified changes`;
const ACTION_DISPATCH = {
  refreshGitDesktop: () => refreshGitDesktop(),
  viewGitDesktopDiff: (value) => viewGitDesktopDiff(value),
  openSpecificFileInOs: (value, target) => openSpecificFileInOs(value, target?.dataset?.mode || "reveal"),
  checkoutSelectedBranch: (value) => checkoutSelectedBranch(value),
  toggleFileStaging: (value, target) => toggleFileStaging(target?.dataset?.path, target),
  toggleAllStaging: (value, target) => toggleAllStaging(target),
  generateAutoCommitMessage: (value) => generateAutoCommitMessage(value === "true"),
  commitFromGitDesktop: () => commitFromGitDesktop(),
  switchGitDesktopTab: (value) => switchGitDesktopTab(value),
  switchGitDesktopLeftTab: (value) => switchGitDesktopLeftTab(value),
  filterChangedFiles: (value) => filterChangedFiles(value),
  triggerAIAnalyzeChanges: () => triggerAIAnalyzeChanges(),
  triggerAICommitAll: () => triggerAICommitAll(),
  triggerGitFetch: () => triggerGitFetch(),
  triggerGitPull: () => triggerGitPull(),
  triggerGitSync: () => triggerGitSync(),
  openPushPreviewModal: () => openPushPreviewModal(),
  triggerAIShip: () => triggerAIShip(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const setGitDesktopState = (updates) =>
  window.setState("gitDesktop", { ...window.state.gitDesktop, ...updates });

const resolveStatusBadgeClass = (status) => STATUS_BADGE_MAP[status] ?? "badge-warning";

const resolveRiskBadgeClass = (risk) => RISK_BADGE_MAP[risk] ?? "badge-accent";

const resolveScope = ({ hasFrontend, hasApi, hasGit, hasTests }) =>
  SCOPE_PRIORITY.find((rule) => rule.has(hasFrontend, hasApi, hasGit, hasTests))?.value ?? "core";

const describeFile = (p) =>
  (DESCRIPTION_RULES.find((r) => r.match(p))?.text ?? DESCRIPTION_DEFAULT)(p);

// ── Core ──────────────────────────────────────────────────────────────────────

function applyGitStatusUpdate(status, repo = window.state.activeRepository, isBackground = true) {
  if (!status || !repo) return;
  setGitDesktopState({ gitStatus: status });

  // Update Header metadata & live branch
  const branchName = status.branch || repo.currentBranch || repo.defaultBranch || "main";
  const branchBtn = document.getElementById("gd-branch-name");
  if (branchBtn) branchBtn.innerHTML = `${escapeHtml(branchName)} <span style="font-size:9px">▾</span>`;

  const commitBranchLabel = document.getElementById("gd-commit-branch-label");
  if (commitBranchLabel) commitBranchLabel.textContent = branchName;

  const aheadBehindEl = document.getElementById("gd-ahead-behind");
  if (aheadBehindEl) aheadBehindEl.textContent = `↑ ${status.ahead || 0} · ↓ ${status.behind || 0}`;

  const workingStatusEl = document.getElementById("gd-working-status");
  if (workingStatusEl) {
    workingStatusEl.textContent = status.clean ? "Clean" : `${status.entries ? status.entries.length : 0} changes`;
    workingStatusEl.className = status.clean ? "badge badge-success" : "badge badge-warning";
  }

  // Sync navbar active repo badge with live branch
  const headerLabel = document.getElementById("header-active-repo-name");
  if (headerLabel) {
    headerLabel.textContent = `${repo.name} · ${branchName}`;
  }

  // Preserve previously selected checkboxes
  const prevFiles = window.state.gitDesktop?.changedFiles || [];
  const prevMap = new Map(prevFiles.map((f) => [f.filePath, f]));

  // Map status entries to changed files
  const changedFiles = (status.entries || []).map((entry) => {
    const code = STATUS_CODE_MAP[entry.status] ?? (entry.status === "added" ? "A" : entry.status === "deleted" ? "D" : entry.status === "untracked" ? "U" : "M");
    const isSensitive = (p) => /auth|key|\.env/.test(p);
    const isCore = (p) => /api|core/.test(p);
    const risk = isSensitive(entry.filePath) ? "high" : isCore(entry.filePath) ? "medium" : "low";
    const prev = prevMap.get(entry.filePath);
    const isSelected = prev ? prev.selected !== false : true;

    return {
      filePath: entry.filePath,
      status: entry.status,
      code,
      staged: entry.staged,
      selected: isSelected,
      additions: entry.status === "added" ? 1 : 0,
      deletions: 0,
      risk,
      logicalGroup: null,
    };
  });

  setGitDesktopState({ changedFiles });

  const countLabel = `${changedFiles.length}`;
  const changesCountEl = document.getElementById("gd-changes-count");
  if (changesCountEl) changesCountEl.textContent = countLabel;

  const statChanges = document.getElementById("stat-changes");
  if (statChanges) statChanges.textContent = `${countLabel} files`;

  renderGitDesktopChanges();

  // Auto-preview first changed file diff or keep current file diff if available
  if (changedFiles.length > 0) {
    const currentSelected = window.state.gitDesktop?.selectedFile;
    const fileToView = changedFiles.some((f) => f.filePath === currentSelected)
      ? currentSelected
      : changedFiles[0].filePath;
    viewGitDesktopDiff(fileToView, !isBackground);
  } else {
    const pathEl = document.getElementById("gd-diff-filepath");
    const currentPath = pathEl?.textContent || "";
    if (!currentPath.includes("Push to") && !currentPath.includes("Successful") && !currentPath.includes("Published")) {
      if (pathEl) pathEl.textContent = "Working tree is clean";
      const metaEl = document.getElementById("gd-diff-meta");
      if (metaEl) metaEl.textContent = "No uncommitted or modified files in repository.";
      const statusBadge = document.getElementById("gd-diff-status-badge");
      if (statusBadge) {
        statusBadge.textContent = "CLEAN";
        statusBadge.className = "badge badge-success";
        statusBadge.style.display = "inline-block";
      }
      const countBadge = document.getElementById("gd-all-diff-count");
      if (countBadge) countBadge.textContent = "0";

      const revealBtn = document.getElementById("gd-btn-reveal-os");
      const editBtn = document.getElementById("gd-btn-open-editor");
      if (revealBtn) revealBtn.style.display = "none";
      if (editBtn) editBtn.style.display = "none";

      const viewer = document.getElementById("gd-diff-viewer");
      if (viewer) {
        viewer.innerHTML = `
          <div class="empty-state" style="padding:60px 20px">
            <div class="empty-icon" style="font-size:32px;color:#10b981">✓</div>
            <div class="empty-title" style="font-size:15px;margin-top:8px">Working tree is clean</div>
            <div class="empty-desc" style="max-width:400px;margin:8px auto 0;color:var(--c-text-muted)">
              All changes committed and synchronized with your branch.
            </div>
          </div>`;
        window._currentRenderedDiffFile = null;
        window._currentRenderedDiffText = null;
      }
    }
  }
}

async function loadGitDesktop(manual = false) {
  let repo = window.state.activeRepository || window.state.repositories?.[0];
  if (!repo) {
    const savedId = localStorage.getItem("gda_active_repo_id");
    if (window.state.repositories?.length) {
      repo = window.state.repositories.find((r) => r.id === savedId) || window.state.repositories[0];
    } else {
      try {
        const res = await api.listRepositories();
        const repos = res.repositories || res || [];
        window.setState("repositories", repos);
        if (repos.length > 0) {
          repo = repos.find((r) => r.id === savedId) || repos[0];
        }
      } catch (_) { }
    }
  }

  // Auto-connect workspace if still no repo connected
  if (!repo) {
    try {
      const res = await api.connectRepository({ name: "Git-Agent", localPath: "." });
      if (res?.repository) {
        repo = res.repository;
        localStorage.setItem("gda_active_repo_id", repo.id);
        window.setState("activeRepository", repo);
      }
    } catch (_) { }
  }

  if (!repo) {
    const repoNameEl = document.getElementById("gd-repo-name");
    if (repoNameEl) repoNameEl.textContent = "No repository connected";
    const changesListEl = document.getElementById("gd-changes-list");
    if (changesListEl) {
      changesListEl.innerHTML = `
        <div class="empty-state" style="padding:36px 20px">
          <div class="empty-icon">📁</div>
          <div class="empty-title">No repository selected</div>
          <div class="empty-desc">Connect or select a repository to use Git Desktop.</div>
          <button class="btn btn-primary btn-sm" data-action="openFolderBrowser" style="margin-top:10px">Connect Repository</button>
        </div>`;
    }
    return;
  }

  window.setState("activeRepository", repo);
  const repoNameEl = document.getElementById("gd-repo-name");
  if (repoNameEl) repoNameEl.textContent = repo.name || repo.path || "Repository";

  try {
    connectGitDesktopStream(repo.id);
    const status = await api.getGitStatus(repo.id);
    applyGitStatusUpdate(status, repo, !manual);
  } catch (err) {
    console.error("Failed to load Git Desktop status:", err);
    if (manual) showToast(`Git Desktop error: ${err.message}`, "error");
  }
}

function updateCommitButtonText() {
  const btn = document.getElementById("gd-btn-commit");
  if (!btn) return;
  const repo = window.state.activeRepository;
  const branch = window.state.gitDesktop.gitStatus?.branch || repo?.currentBranch || repo?.defaultBranch || "main";
  const files = window.state.gitDesktop.changedFiles || [];
  const selectedCount = files.filter((f) => f.selected !== false).length;
  const countLabel = selectedCount > 0 ? ` (${selectedCount} files)` : files.length > 0 ? ` (${files.length} files)` : "";
  btn.innerHTML = `Commit to <span id="gd-commit-branch-label" style="font-weight:700;margin-left:2px">${escapeHtml(branch)}</span>${countLabel}`;
}

async function toggleFileStaging(filePath, target) {
  const repo = window.state.activeRepository;
  if (!repo || !filePath) return;
  const isChecked = target ? target.checked : true;
  const changedFiles = (window.state.gitDesktop.changedFiles || []).map((f) =>
    f.filePath === filePath ? { ...f, selected: isChecked, staged: isChecked } : f
  );
  setGitDesktopState({ changedFiles });
  renderGitDesktopChanges();

  try {
    if (isChecked) {
      await api.stageFile(repo.id, filePath);
    } else {
      await api.unstageFile(repo.id, filePath);
    }
  } catch (err) {
    console.warn("Staging sync warning:", err);
  }
}

async function toggleAllStaging(target) {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const isChecked = target ? target.checked : true;
  const changedFiles = (window.state.gitDesktop.changedFiles || []).map((f) => ({
    ...f,
    selected: isChecked,
    staged: isChecked,
  }));
  setGitDesktopState({ changedFiles });
  renderGitDesktopChanges();

  try {
    if (isChecked) {
      await api.stageAll(repo.id);
    } else {
      await api.unstageAll(repo.id);
    }
  } catch (err) {
    console.warn("Staging all sync warning:", err);
  }
}

function filterChangedFiles(filter) {
  setGitDesktopState({ currentFilter: filter });
  document.querySelectorAll(".git-filter-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-filter") === filter);
  });
  renderGitDesktopChanges();
}

function renderGitDesktopChanges() {
  const container = document.getElementById("gd-changes-list");
  if (!container) return;

  const allChanged = window.state.gitDesktop.changedFiles || [];
  const countBadge = document.getElementById("gd-all-diff-count");
  if (countBadge) countBadge.textContent = allChanged.length;

  const changesCountEl = document.getElementById("gd-changes-count");
  if (changesCountEl) changesCountEl.textContent = allChanged.length;

  const filter = window.state.gitDesktop.currentFilter || "all";

  const FILTER_PREDICATES = {
    all: () => true,
    staged: (f) => f.staged,
    unstaged: (f) => !f.staged,
    untracked: (f) => f.status === "untracked",
  };

  const predicate = FILTER_PREDICATES[filter] || (() => true);
  const files = allChanged.filter(predicate);

  if (files.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:32px 16px">
        <div class="empty-icon">✓</div>
        <div class="empty-title">No changes found</div>
        <div class="empty-desc">No files matching filter "${filter}".</div>
      </div>`;
    updateCommitButtonText();
    return;
  }

  const allSelected = allChanged.length > 0 && allChanged.every((f) => f.selected !== false);

  let html = `<div style="display:flex;flex-direction:column">`;

  // Overview row for All Changed Files (Continuous diff) with Select All checkbox
  html += `
    <div class="git-change-row all-files-row" style="background:var(--c-surface-hover);font-weight:600;border-bottom:1.5px solid var(--c-border);display:flex;align-items:center;justify-content:space-between;padding:8px 12px">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="gd-select-all" ${allSelected ? "checked" : ""} style="cursor:pointer;width:15px;height:15px;accent-color:var(--c-accent)" title="Select / Deselect All for commit" data-action="toggleAllStaging">
        <span class="git-file-name" style="font-weight:700;color:var(--c-accent);cursor:pointer" data-action="switchGitDesktopTab" data-value="gd-all-diff">
          All Changed Files (${allChanged.length})
        </span>
      </div>
      <div class="git-change-right">
        <span class="badge badge-secondary" style="font-size:10px;cursor:pointer" data-action="switchGitDesktopTab" data-value="gd-all-diff">VIEW ALL</span>
      </div>
    </div>`;

  for (const f of files) {
    const riskBadgeClass = resolveRiskBadgeClass(f.risk);
    const groupBadge = f.logicalGroup ? `<span class="badge badge-accent" style="font-size:10px">${escapeHtml(f.logicalGroup)}</span>` : "";
    const isSelected = window.state.gitDesktop.selectedFile === f.filePath;

    html += `
      <div class="git-change-row ${isSelected ? "selected-row" : ""}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:7px 12px;${isSelected ? "background:var(--c-surface-active, rgba(59,130,246,0.08));border-left:3px solid var(--c-accent);" : ""}" data-action="viewGitDesktopDiff" data-value="${escapeHtml(f.filePath)}">
        <div class="git-change-left" style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
          <input type="checkbox" class="gd-file-check" data-path="${escapeHtml(f.filePath)}" ${f.selected !== false ? "checked" : ""} style="cursor:pointer;width:14px;height:14px;accent-color:var(--c-accent);flex-shrink:0" data-stopprop="true" data-action="toggleFileStaging">
          <span class="git-status-badge ${f.code}" style="flex-shrink:0">${f.code}</span>
          <span class="git-file-name" title="${escapeHtml(f.filePath)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${escapeHtml(f.filePath)}</span>
          ${groupBadge}
        </div>
        <div class="git-change-right" style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span class="badge ${riskBadgeClass}" style="font-size:9.5px">${f.risk.toUpperCase()}</span>
          <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:10.5px" data-action="viewGitDesktopDiff" data-value="${escapeHtml(f.filePath)}" data-stopprop="true">
            Diff
          </button>
        </div>
      </div>`;
  }
  html += `</div>`;
  container.innerHTML = html;

  updateCommitButtonText();

  // Auto-generate commit message when changes are rendered
  generateAutoCommitMessage(false);

  // Auto-preview first changed file if none selected
  const currentDiffPath = document.getElementById("gd-diff-filepath")?.textContent;
  if (files.length > 0 && (!currentDiffPath || currentDiffPath.includes("Select a file") || currentDiffPath.includes("In sync") || currentDiffPath.includes("clean"))) {
    viewGitDesktopDiff(files[0].filePath);
  }
}

async function generateAutoCommitMessage(force = false) {
  const repo = window.state.activeRepository;
  if (!repo) return;

  const summaryEl = document.getElementById("gd-commit-summary");
  const descEl = document.getElementById("gd-commit-desc");
  if (!summaryEl || !descEl) return;

  if (!force && summaryEl.value.trim()) return;

  const autoBtn = document.getElementById("gd-auto-generate-btn");
  if (autoBtn) {
    autoBtn.disabled = true;
    autoBtn.textContent = "⚡ Generating...";
  }

  try {
    const res = await api.generateCommitMessage(repo.id);
    if (res.summary) {
      summaryEl.value = res.summary;
      if (res.description) descEl.value = res.description;
      const branchLabel = document.getElementById("gd-commit-branch-label");
      if (branchLabel && res.branch) branchLabel.textContent = res.branch;
    }
  } catch (err) {
    const files = window.state.gitDesktop.changedFiles || [];
    if (files.length > 0) {
      const paths = files.map((f) => f.filePath || "");
      const hasApi = paths.some((p) => p.includes("api/") || p.includes("api."));
      const hasFrontend = paths.some((p) => p.startsWith("public/") || p.includes("html") || p.includes("css"));
      const hasGit = paths.some((p) => p.includes("git"));
      const hasTests = paths.some((p) => p.includes("test"));

      const scope = resolveScope({ hasFrontend, hasApi, hasGit, hasTests });
      const type = hasTests ? "test" : (files.some((f) => f.status === "added") ? "feat" : "fix");
      const topFileNames = paths.slice(0, 3).map((p) => p.split("/").pop().split(".")[0]).join(", ");
      summaryEl.value = `${type}(${scope}): update ${topFileNames}${paths.length > 3 ? ` and ${paths.length - 3} related components` : ""}`;

      descEl.value = paths.map(describeFile).slice(0, 8).join("\n");
    }
  } finally {
    if (autoBtn) {
      autoBtn.disabled = false;
      autoBtn.textContent = "✨ Auto-Generate";
    }
  }
}

async function viewGitDesktopDiff(filePath, showLoading = true) {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  setGitDesktopState({ selectedFile: filePath });

  const revealBtn = document.getElementById("gd-btn-reveal-os");
  const editBtn = document.getElementById("gd-btn-open-editor");
  if (revealBtn) revealBtn.style.display = "inline-flex";
  if (editBtn) editBtn.style.display = "inline-flex";

  const pathEl = document.getElementById("gd-diff-filepath");
  if (pathEl) pathEl.textContent = filePath;

  const statusBadge = document.getElementById("gd-diff-status-badge");
  if (statusBadge) {
    const fileObj = window.state.gitDesktop.changedFiles?.find((f) => f.filePath === filePath);
    const statusText = fileObj ? fileObj.status.toUpperCase() : "MODIFIED";
    statusBadge.textContent = statusText;
    statusBadge.style.display = "inline-block";
    statusBadge.className = `badge ${resolveStatusBadgeClass(statusText)}`;
  }

  const metaEl = document.getElementById("gd-diff-meta");
  if (metaEl) metaEl.textContent = `Unified diff for ${filePath}`;

  document.querySelectorAll(".git-change-row").forEach((r) => {
    const nameEl = r.querySelector(".git-file-name");
    r.classList.toggle("selected", nameEl?.getAttribute("title") === filePath);
  });

  const summaryInput = document.getElementById("gd-commit-summary");
  if (summaryInput && !summaryInput.value.trim()) {
    summaryInput.placeholder = `Update ${filePath.split("/").pop()}`;
  }

  const viewer = document.getElementById("gd-diff-viewer");
  const isDifferentFile = window._currentRenderedDiffFile !== filePath;
  if (viewer && (showLoading || isDifferentFile)) {
    viewer.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--c-text-muted)"><div class="spinner"></div><div style="margin-top:8px">Loading unified diff for ${escapeHtml(filePath)}...</div></div>`;
  }
  switchGitDesktopTab("gd-diff");

  try {
    const res = await api.getGitDiff(repo.id, filePath);
    let diffText = "";
    if (res?.diff?.trim()) {
      diffText = res.diff;
    } else if (typeof res === "string" && res.trim()) {
      diffText = res;
    } else if (res?.files && Array.isArray(res.files)) {
      const match = res.files.find((f) => f.filePath === filePath);
      if (match?.diff?.trim()) diffText = match.diff;
    }

    if (diffText) {
      if (diffText !== window._currentRenderedDiffText || isDifferentFile) {
        window._currentRenderedDiffFile = filePath;
        window._currentRenderedDiffText = diffText;
        renderFormattedDiff("gd-diff-viewer", diffText, filePath);
      }
      return;
    }

    if (viewer) {
      viewer.innerHTML = `
        <div class="empty-state" style="padding:40px 16px">
          <div class="empty-icon">✓</div>
          <div class="empty-title">In sync with repository</div>
          <div class="empty-desc">No active line differences detected for "${escapeHtml(filePath)}".</div>
        </div>`;
      window._currentRenderedDiffFile = filePath;
      window._currentRenderedDiffText = "";
    }
  } catch (err) {
    if (viewer) viewer.innerHTML = `<div class="text-danger" style="padding:16px">Error loading diff: ${escapeHtml(err.message)}</div>`;
  }
}

async function openCurrentFileInOs(mode = "reveal") {
  const filePath = window.state.gitDesktop?.selectedFile || document.getElementById("gd-diff-filepath")?.textContent;
  const isPlaceholder = !filePath || /Select a file|In sync|All Changed Files/.test(filePath);
  if (isPlaceholder) {
    showToast("Please select a specific file from the changes list", "warning");
    return;
  }
  await openSpecificFileInOs(filePath, mode);
}

async function openSpecificFileInOs(filePath, mode = "reveal") {
  const repo = window.state.activeRepository;
  const actionName = mode === "edit" ? `Opening ${filePath} in editor...` : `Revealing ${filePath} in File Explorer...`;
  showToast(actionName, "info");

  try {
    const res = await api.openInOs(filePath, repo?.id || "", mode);
    if (res?.success) {
      showToast(res.message || "Opened successfully in OS", "success");
    } else {
      showToast(`OS error: ${res.error || res.message}`, "error");
    }
  } catch (err) {
    showToast(`OS action error: ${err.message}`, "error");
  }
}

async function viewAllFilesDiff() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  const pathEl = document.getElementById("gd-diff-filepath");
  if (pathEl) pathEl.textContent = "All Changed Files";

  const statusBadge = document.getElementById("gd-diff-status-badge");
  const files = window.state.gitDesktop.changedFiles || [];
  if (statusBadge) {
    statusBadge.textContent = `${files.length} FILES`;
    statusBadge.style.display = "inline-block";
    statusBadge.className = "badge badge-accent";
  }

  const metaEl = document.getElementById("gd-diff-meta");
  if (metaEl) metaEl.textContent = `Continuous unified diff across ${files.length} modified files`;

  const revealBtn = document.getElementById("gd-btn-reveal-os");
  const editBtn = document.getElementById("gd-btn-open-editor");
  if (revealBtn) revealBtn.style.display = "none";
  if (editBtn) editBtn.style.display = "none";

  const countBadge = document.getElementById("gd-all-diff-count");
  if (countBadge) countBadge.textContent = files.length;

  const viewer = document.getElementById("gd-all-diff-viewer");
  if (viewer) {
    viewer.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--c-text-muted)"><div class="spinner"></div><div style="margin-top:8px">Loading complete unified diff across all changed files...</div></div>`;
  }

  try {
    const res = await api.getGitDiff(repo.id, "");
    const diffText = (res && res.diff) || (typeof res === "string" ? res : "");

    if (!diffText?.trim()) {
      if (viewer) {
        viewer.innerHTML = `
          <div class="empty-state" style="padding:48px 20px">
            <div class="empty-icon">✓</div>
            <div class="empty-title">Working tree is clean</div>
            <div class="empty-desc">No active line differences detected across repository.</div>
          </div>`;
      }
      return;
    }

    renderMultiFileDiff("gd-all-diff-viewer", diffText);
  } catch (err) {
    if (viewer) viewer.innerHTML = `<div class="text-danger" style="padding:16px">Error loading all diffs: ${escapeHtml(err.message)}</div>`;
  }
}

function renderMultiFileDiff(containerId, diffText) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!diffText?.trim()) {
    el.innerHTML = `<div class="empty-state" style="padding:32px"><div class="empty-title">No diff content</div></div>`;
    return;
  }

  const fileChunks = diffText.split(/(?=diff --git )/g).filter(Boolean);
  let html = `<div style="display:flex;flex-direction:column;gap:16px">`;

  fileChunks.forEach((chunk) => {
    const firstLine = chunk.split("\n")[0] || "";
    const match = /diff --git a\/(.*?) b\/(.*)/.exec(firstLine);
    const filePath = match ? match[2] : (firstLine.replace("diff --git ", "") || "Modified File");

    const lines = chunk.split("\n");
    let additions = 0;
    let deletions = 0;
    lines.forEach((l) => {
      if (l.startsWith("+") && !l.startsWith("+++")) additions++;
      if (l.startsWith("-") && !l.startsWith("---")) deletions++;
    });

    html += `
      <div class="diff-viewer" style="border:1px solid var(--c-border);border-radius:var(--r-md);overflow:hidden;background:#ffffff">
        <div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid var(--c-border);font-family:var(--font-mono);font-size:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:700;color:var(--c-text)">${escapeHtml(filePath)}</span>
            <span class="badge badge-success" style="font-size:10.5px">+${additions}</span>
            <span class="badge badge-danger" style="font-size:10.5px">-${deletions}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" data-action="openSpecificFileInOs" data-value="${escapeHtml(filePath)}" data-mode="reveal">📂 Reveal</button>
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" data-action="openSpecificFileInOs" data-value="${escapeHtml(filePath)}" data-mode="edit">📝 Open</button>
            <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px" data-action="viewGitDesktopDiff" data-value="${escapeHtml(filePath)}">🔍 Inspect</button>
          </div>
        </div>`;

    let lineNumOld = 0;
    let lineNumNew = 0;

    const SKIP_PREFIXES = ["diff --git", "index ", "--- ", "+++ ", "new file mode"];

    const renderDiffLine = {
      chunk: (escaped) => `<div class="diff-file-row diff-line-chunk"><div class="diff-line-number" style="background:#f1f5f9;color:#64748b">...</div><div class="diff-line-content">${escaped}</div></div>`,
      add: (escaped, num) => `<div class="diff-file-row diff-line-add"><div class="diff-line-number" style="background:#dcfce7;color:#15803d">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
      del: (escaped, num) => `<div class="diff-file-row diff-line-del"><div class="diff-line-number" style="background:#fee2e2;color:#b91c1c">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
      context: (escaped, num) => `<div class="diff-file-row diff-line-context"><div class="diff-line-number">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SKIP_PREFIXES.some((p) => line.startsWith(p))) continue;
      const escaped = escapeHtml(line);

      if (line.startsWith("@@")) {
        const hunkMatch = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunkMatch) {
          lineNumOld = parseInt(hunkMatch[1], 10);
          lineNumNew = parseInt(hunkMatch[2], 10);
        }
        html += renderDiffLine.chunk(escaped);
      } else if (line.startsWith("+")) {
        html += renderDiffLine.add(escaped, lineNumNew > 0 ? lineNumNew++ : "+");
      } else if (line.startsWith("-")) {
        html += renderDiffLine.del(escaped, lineNumOld > 0 ? lineNumOld++ : "-");
      } else {
        if (lineNumOld > 0) lineNumOld++;
        if (lineNumNew > 0) lineNumNew++;
        html += renderDiffLine.context(escaped, lineNumNew > 0 ? (lineNumNew - 1) : "");
      }
    }

    html += `</div>`;
  });

  html += `</div>`;
  el.innerHTML = html;
}

function renderFormattedDiff(containerId, diffText, filePath = "") {
  const el = document.getElementById(containerId);
  if (!el) return;

  const lines = diffText.split("\n");
  let additionsCount = 0;
  let deletionsCount = 0;

  lines.forEach((l) => {
    if (l.startsWith("+") && !l.startsWith("+++")) additionsCount++;
    if (l.startsWith("-") && !l.startsWith("---")) deletionsCount++;
  });

  let html = `<div class="diff-viewer" style="border:1px solid var(--c-border);border-radius:var(--r-md);overflow:hidden;background:#ffffff">`;

  if (filePath) {
    html += `
      <div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid var(--c-border);font-family:var(--font-mono);font-size:11.5px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;color:var(--c-text)">${escapeHtml(filePath)}</span>
        <div style="display:flex;gap:6px">
          <span class="badge badge-success" style="font-size:10.5px">+${additionsCount}</span>
          <span class="badge badge-danger" style="font-size:10.5px">-${deletionsCount}</span>
          <span style="color:var(--c-text-muted);font-size:11px;margin-left:4px">${lines.length} lines</span>
        </div>
      </div>`;
  }

  let lineNumOld = 0;
  let lineNumNew = 0;

  const renderDiffLine = {
    chunk: (escaped) => `<div class="diff-file-row diff-line-chunk"><div class="diff-line-number" style="background:#f1f5f9;color:#64748b">...</div><div class="diff-line-content">${escaped}</div></div>`,
    add: (escaped, num) => `<div class="diff-file-row diff-line-add"><div class="diff-line-number" style="background:#dcfce7;color:#15803d">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
    del: (escaped, num) => `<div class="diff-file-row diff-line-del"><div class="diff-line-number" style="background:#fee2e2;color:#b91c1c">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
    context: (escaped, num) => `<div class="diff-file-row diff-line-context"><div class="diff-line-number">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const escaped = escapeHtml(line);

    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        lineNumOld = parseInt(match[1], 10);
        lineNumNew = parseInt(match[2], 10);
      }
      html += renderDiffLine.chunk(escaped);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      html += renderDiffLine.add(escaped, lineNumNew > 0 ? lineNumNew++ : "+");
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      html += renderDiffLine.del(escaped, lineNumOld > 0 ? lineNumOld++ : "-");
    } else {
      if (lineNumOld > 0) lineNumOld++;
      if (lineNumNew > 0) lineNumNew++;
      html += renderDiffLine.context(escaped, lineNumNew > 0 ? (lineNumNew - 1) : "");
    }
  }

  html += `</div>`;
  el.innerHTML = html;
}

function switchGitDesktopTab(tabName) {
  const diffBtn = document.getElementById("gd-tab-btn-diff");
  const allDiffBtn = document.getElementById("gd-tab-btn-all-diff");
  const diffPanel = document.getElementById("panel-gd-diff");
  const allDiffPanel = document.getElementById("panel-gd-all-diff");

  if (diffBtn) diffBtn.className = tabName === "gd-diff" ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm";
  if (allDiffBtn) allDiffBtn.className = tabName === "gd-all-diff" ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm";

  if (diffPanel) diffPanel.style.display = tabName === "gd-diff" ? "block" : "none";
  if (allDiffPanel) allDiffPanel.style.display = tabName === "gd-all-diff" ? "block" : "none";

  if (tabName === "gd-all-diff") viewAllFilesDiff();
}

function switchGitDesktopLeftTab(tab) {
  const mapping = LEFT_TAB_MAP[tab] ?? LEFT_TAB_MAP.history;
  const { tab: tabId, panel: panelId, style } = mapping;

  // Remove active from all tabs, hide all panels
  ["gd-tab-changes", "gd-tab-commit-plan", "gd-tab-history"].forEach((id) => {
    document.getElementById(id)?.classList.remove("active");
  });
  ["gd-panel-changes", "gd-panel-commit-plan", "gd-panel-history"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  // Activate the selected tab
  document.getElementById(tabId)?.classList.add("active");
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = style;

  if (tab === "commit-plan" && !window.state.gitDesktop.commitPlan) {
    triggerAIAnalyzeChanges();
  }
  if (tab === "history" && typeof window.loadGitDesktopHistory === "function") {
    window.loadGitDesktopHistory();
  }
}

async function commitFromGitDesktop() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  const summaryInput = document.getElementById("gd-commit-summary");
  const descInput = document.getElementById("gd-commit-desc");
  const summary = summaryInput ? (summaryInput.value.trim() || summaryInput.placeholder.replace("Update ", "").trim()) : "";
  const desc = descInput ? descInput.value.trim() : "";

  if (!summary || summary === "Summary (required)") {
    showToast("Please enter a commit summary", "warning");
    summaryInput?.focus();
    return;
  }

  const fullMessage = desc ? `${summary}\n\n${desc}` : summary;
  const btn = document.getElementById("gd-btn-commit");
  if (btn) {
    const allFiles = window.state.gitDesktop.changedFiles || [];
    const selectedFiles = allFiles.filter((f) => f.selected !== false);
    if (allFiles.length > 0 && selectedFiles.length === 0) {
      showToast("Please select at least one changed file to commit", "warning");
      return;
    }

    btn.disabled = true;
    setGitDesktopState({ isActionRunning: true });
    const stageAll = selectedFiles.length === allFiles.length;
    const filesToCommit = stageAll ? null : selectedFiles.map((f) => f.filePath);

    try {
      const res = await api.gitCommit(
        repo.id,
        fullMessage,
        stageAll,
        filesToCommit,
      );
      if (res.success) {
        showToast(`Committed: ${summary}`, "success");
        if (summaryInput) summaryInput.value = "";
        if (descInput) descInput.value = "";
        await loadGitDesktop(false);
      } else {
        showToast(`Commit failed: ${res.error || res.message}`, "error");
      }
    } catch (err) {
      showToast(`Commit error: ${err.message}`, "error");
    } finally {
      setGitDesktopState({ isActionRunning: false });
      if (btn) {
        btn.disabled = false;
        updateCommitButtonText();
      }
    }
  }
}

async function triggerAIAnalyzeChanges() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Please select a repository first", "warning");
    return;
  }

  const btn = document.getElementById("gd-btn-analyze");
  const summaryEl = document.getElementById("gd-ai-summary");
  const planContainer = document.getElementById("gd-commit-plan-container");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⚡ Analyzing...`;
  }
  if (summaryEl) summaryEl.textContent = "AI is inspecting AST symbols, imports, and git diffs...";

  try {
    const data = await api.analyzeChanges(repo.id);
    const plan = data.plan || data;
    setGitDesktopState({ commitPlan: plan });

    if (summaryEl) {
      summaryEl.textContent = plan.summary || `${plan.totalFiles} files grouped into ${plan.groups.length} logical commits.`;
    }

    if (plan.changedFiles && Array.isArray(plan.changedFiles)) {
      const changedFiles = plan.changedFiles.map((f) => ({
        ...f,
        code: STATUS_CODE_MAP[f.status] ?? "M",
      }));
      setGitDesktopState({ changedFiles });
      renderGitDesktopChanges();
    }

    // Call modular commit plan component renderer if available
    if (typeof window.renderCommitPlanView === "function") {
      window.renderCommitPlanView(plan);
    } else if (planContainer) {
      if (!plan.groups?.length) {
        planContainer.innerHTML = `
          <div class="empty-state" style="padding:24px">
            <div class="empty-title">Working tree clean</div>
            <div class="empty-desc">No changes required for commit planning.</div>
          </div>`;
        const commitAllBtn = document.getElementById("gd-btn-commit-all");
        if (commitAllBtn) commitAllBtn.style.display = "none";
        return;
      }

      let planHtml = "";
      plan.groups.forEach((grp, idx) => {
        const { type, scope, subject } = grp.suggestedCommit || {};
        const commitMsg = grp.suggestedCommit ? `${type}${scope ? `(${scope})` : ""}: ${subject}` : grp.name;
        const riskClass = resolveRiskBadgeClass(grp.risk);

        planHtml += `
          <div class="commit-plan-card">
            <div class="commit-plan-header">
              <div>
                <span class="badge badge-accent" style="margin-bottom:4px">Commit ${idx + 1}</span>
                <div class="commit-plan-title">${escapeHtml(commitMsg)}</div>
              </div>
              <span class="badge ${riskClass}">${grp.risk.toUpperCase()} RISK</span>
            </div>
            <div class="commit-plan-reason">${escapeHtml(grp.reason || "Logical semantic group")}</div>
            <div class="commit-plan-meta">
              <span>📦 ${grp.files.length} file${grp.files.length > 1 ? "s" : ""}</span>
              <span>🧪 ~${grp.testCount || grp.files.length} tests</span>
            </div>
            <div class="commit-plan-files">
              ${grp.files.map((f) => `<span class="commit-file-pill">${escapeHtml(f)}</span>`).join("")}
            </div>
          </div>`;
      });
      planContainer.innerHTML = planHtml;
      const commitAllBtn = document.getElementById("gd-btn-commit-all");
      if (commitAllBtn) commitAllBtn.style.display = "inline-flex";
    }

    switchGitDesktopLeftTab("commit-plan");
    showToast(`AI grouped ${plan.totalFiles || plan.groups.length} files into ${plan.groups.length} logical commits!`, "success");
  } catch (err) {
    if (summaryEl) summaryEl.textContent = `Analysis failed: ${err.message}`;
    showToast(`Error analyzing changes: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `⚡ AI Analyze Changes`;
    }
  }
}

async function triggerAICommitAll() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  const btn = document.getElementById("gd-btn-commit-all");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Committing...";
  }

  try {
    const groups = window.state.gitDesktop.commitPlan?.groups;
    const res = await api.executeCommitPlan(repo.id, groups);

    if (res.success) {
      showToast(`Successfully created ${res.totalCreated} logical commits!`, "success");
      await loadGitDesktop();
      const commitAllBtn = document.getElementById("gd-btn-commit-all");
      if (commitAllBtn) commitAllBtn.style.display = "none";
      const planContainer = document.getElementById("gd-commit-plan-container");
      if (planContainer) {
        planContainer.innerHTML = `
          <div class="empty-state" style="padding:24px">
            <div class="empty-icon">✓</div>
            <div class="empty-title">All groups committed!</div>
            <div class="empty-desc">${res.totalCreated} verified commits created on branch '${res.branch}'.</div>
          </div>`;
      }
    } else {
      showToast(`Commit failed: ${res.message || res.error}`, "error");
    }
  } catch (err) {
    showToast(`Commit error: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⚡ Commit All Groups";
    }
  }
}

async function triggerGitFetch() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  showToast("Fetching remote references...", "info");
  try {
    await api.gitFetch(repo.id);
    await loadGitDesktop();
    showToast("Fetched latest refs from origin", "success");
  } catch (err) {
    showToast(`Fetch error: ${err.message}`, "error");
  }
}

async function triggerGitPull() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  try {
    const res = await api.gitPull(repo.id);

    const hasConflict = !res.success && (res.error?.includes("conflict") || res.output?.includes("conflict"));
    if (hasConflict) {
      showToast("Merge conflict encountered during pull! Opening Conflict Center...", "warning");
      navigate("conflicts");
      return;
    }

    await loadGitDesktop();
    showToast(res.success ? "Pulled successfully" : "Pull failed", res.success ? "success" : "error");
  } catch (err) {
    showToast(`Pull error: ${err.message}`, "error");
  }
}

async function triggerGitSync() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  showToast("Syncing with remote...", "info");
  try {
    const res = await api.gitSync(repo.id);
    await loadGitDesktop();

    if (res.actionRequired === "diverged") {
      showToast("Branches have diverged! Rebase or merge required.", "warning");
    } else {
      showToast(res.message, "success");
    }
  } catch (err) {
    showToast(`Sync error: ${err.message}`, "error");
  }
}

async function openPushPreviewModal() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  const targetRepoEl = document.getElementById("push-target-repo");
  if (targetRepoEl) targetRepoEl.textContent = repo.name || repo.path;

  const currentBranch = window.state.gitDesktop.gitStatus?.branch || repo.currentBranch || repo.defaultBranch || "main";
  const currentBranchEl = document.getElementById("push-current-branch");
  if (currentBranchEl) currentBranchEl.textContent = currentBranch;

  const branchSelect = document.getElementById("push-target-branch-select");
  const customInput = document.getElementById("push-custom-branch-input");
  if (customInput) customInput.style.display = "none";

  if (branchSelect) {
    branchSelect.innerHTML = `<option value="${escapeHtml(currentBranch)}">🌿 Current branch: ${escapeHtml(currentBranch)}</option>`;
  }

  const PROTECTED_BRANCHES = ["main", "master", "production"];
  const isProtected = PROTECTED_BRANCHES.includes(currentBranch);
  const branchRuleEl = document.getElementById("push-check-branch");
  if (branchRuleEl) {
    branchRuleEl.textContent = isProtected ? "Protected branch (requires review)" : "PASSED (Safe branch)";
    branchRuleEl.className = isProtected ? "badge badge-warning" : "badge badge-success";
  }

  const commitsListEl = document.getElementById("push-commits-list");
  if (commitsListEl) {
    commitsListEl.innerHTML = `<div class="text-muted" style="font-size:12px;text-align:center;padding:10px"><div class="spinner"></div><div style="margin-top:4px">Checking outgoing commits...</div></div>`;
  }
  openModal("modal-push-preview");

  try {
    const branchesData = await api.getGitBranches(repo.id);
    const branches = branchesData.branches || [];
    if (branchSelect) {
      const otherBranches = branches.filter((b) => b.name !== currentBranch);
      const otherOpts = otherBranches.map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join("");
      branchSelect.innerHTML = `
        <option value="${escapeHtml(currentBranch)}">🌿 Current branch (${escapeHtml(currentBranch)})</option>
        ${otherBranches.length > 0 ? `<optgroup label="Available Repository Branches">${otherOpts}</optgroup>` : ""}
        <option value="__custom__">➕ Push to custom / new branch name...</option>`;
    }
  } catch (e) {
    console.warn("Could not fetch branches for push modal:", e);
  }

  try {
    const logData = await api.getGitLog(repo.id, 10);
    const commits = logData.commits || logData.entries || [];
    const countEl = document.getElementById("push-commits-count");
    if (countEl) countEl.textContent = `${commits.length} outgoing commit(s)`;

    if (commitsListEl) {
      commitsListEl.innerHTML = commits.length === 0
        ? `<div class="text-muted" style="font-size:12px;text-align:center;padding:12px">No outgoing commits waiting. Remote is up to date.</div>`
        : commits.map((c) => `
          <div style="display:flex;align-items:center;gap:8px;font-size:11.5px;padding:5px 8px;border-bottom:1px solid var(--c-border-subtle)">
            <code style="font-weight:700;color:var(--c-accent);font-size:11px">${escapeHtml(c.shortHash || c.hash?.slice(0, 7) || "")}</code>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.subject || c.message || "")}</span>
          </div>`).join("");
    }
  } catch (err) {
    if (commitsListEl) {
      commitsListEl.innerHTML = `<div class="text-muted" style="font-size:12px">Commit log checked.</div>`;
    }
  }
}

function onPushTargetBranchChanged() {
  const select = document.getElementById("push-target-branch-select");
  const customInput = document.getElementById("push-custom-branch-input");
  if (!select || !customInput) return;

  const showCustom = select.value === "__custom__";
  customInput.style.display = showCustom ? "block" : "none";
  if (showCustom) customInput.focus();
}

async function executePushFromModal() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  const select = document.getElementById("push-target-branch-select");
  const customInput = document.getElementById("push-custom-branch-input");
  let targetBranch = select?.value ?? "";
  if (targetBranch === "__custom__" && customInput) {
    targetBranch = customInput.value.trim();
  }
  targetBranch ||= window.state.gitDesktop.gitStatus?.branch || repo.currentBranch || "main";

  const remote = document.getElementById("push-remote-select")?.value || "origin";
  const setUpstream = document.getElementById("push-set-upstream")?.checked !== false;
  const forceWithLease = document.getElementById("push-force-with-lease")?.checked === true;

  const btn = document.getElementById("confirm-push-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = `Pushing to ${targetBranch}...`;
  }

  try {
    const res = await api.gitPush(repo.id, remote, targetBranch, setUpstream, forceWithLease);
    closeModal("modal-push-preview");
    await loadGitDesktop();

    if (typeof window.renderPushSummaryView === "function") {
      await window.renderPushSummaryView(remote, targetBranch, res.output || res.message);
    }
    showToast(`Successfully pushed to ${remote}/${targetBranch}!`, "success");
  } catch (err) {
    showToast(`Push failed: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Confirm & Push to Remote";
    }
  }
}

async function openBranchSwitcherModal() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  const container = document.getElementById("branch-list-container");
  if (container) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px;font-size:12px"><div class="spinner"></div><div style="margin-top:6px">Loading branches...</div></div>`;
  }
  openModal("modal-branch-switcher");

  try {
    const data = await api.getGitBranches(repo.id);
    allRepoBranches = data.branches || [];
    renderBranchSwitcherList(allRepoBranches);
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="text-danger" style="padding:16px;font-size:12px">Error loading branches: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderBranchSwitcherList(branches) {
  const container = document.getElementById("branch-list-container");
  if (!container) return;

  const currentBranch = window.state.gitDesktop.gitStatus?.branch || window.state.activeRepository?.currentBranch || "main";

  if (branches.length === 0) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px;font-size:12px">No branches found.</div>`;
    return;
  }

  container.innerHTML = branches.map((b) => {
    const isCurrent = b.name === currentBranch || b.current;
    return `
      <div class="branch-list-item ${isCurrent ? "active-branch" : ""}" data-action="checkoutSelectedBranch" data-value="${escapeHtml(b.name)}">
        <div style="display:flex;align-items:center;gap:8px">
          <span>${isCurrent ? "✓" : "🌿"}</span>
          <span style="font-family:var(--font-mono);font-size:12.5px">${escapeHtml(b.name)}</span>
        </div>
        ${isCurrent ? '<span class="badge badge-accent">current</span>' : '<span style="font-size:11px;color:var(--c-text-muted)">checkout</span>'}
      </div>`;
  }).join("");
}

function filterBranchList() {
  const query = document.getElementById("branch-search-input")?.value?.toLowerCase() || "";
  const filtered = allRepoBranches.filter((b) => b.name.toLowerCase().includes(query));
  renderBranchSwitcherList(filtered);
}

async function checkoutSelectedBranch(branchName) {
  const repo = window.state.activeRepository;
  if (!repo) return;

  try {
    await api.checkoutBranch(repo.id, branchName, false);
    closeModal("modal-branch-switcher");
    showToast(`Switched to branch '${branchName}'`, "success");
    if (typeof window.setActiveRepository === "function") {
      await window.setActiveRepository(repo);
    }
  } catch (err) {
    showToast(`Failed to switch branch: ${err.message}`, "error");
  }
}

async function createAndCheckoutBranch() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  const input = document.getElementById("new-branch-name-input");
  const branchName = input ? input.value.trim() : "";

  if (!branchName) {
    showToast("Branch name is required", "warning");
    input?.focus();
    return;
  }

  try {
    await api.checkoutBranch(repo.id, branchName, true);
    closeModal("modal-branch-switcher");
    if (input) input.value = "";
    showToast(`Created & switched to new branch '${branchName}'`, "success");
    if (typeof window.setActiveRepository === "function") {
      await window.setActiveRepository(repo);
    }
  } catch (err) {
    showToast(`Failed to create branch: ${err.message}`, "error");
  }
}

async function triggerAIShip() {
  const repo = window.state.activeRepository;
  if (!repo) return;

  const confirmed = confirm("🚀 Launch AI Ship?\n\nThis will automatically:\n1. Analyze and group all changed files\n2. Commit with verified Conventional Commits\n3. Push to remote\n4. Create a Pull Request on GitHub\n\nProceed?");
  if (!confirmed) return;

  showToast("AI Ship in progress...", "info");
  try {
    const res = await api.gitShip(repo.id);
    await loadGitDesktop();
    showToast(res.message, "success");
  } catch (err) {
    showToast(`AI Ship error: ${err.message}`, "error");
  }
}

// Event delegation for data-action attributes
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  if (target.dataset.stopprop === "true") e.stopPropagation();

  const action = target.dataset.action;
  const handler = ACTION_DISPATCH[action];
  if (handler) handler(target.dataset.value, target);
});

async function refreshGitDesktop() {
  const btn = document.getElementById("gd-btn-refresh");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "🔄 Refreshing...";
  }
  showToast("Refreshing Git status...", "info");
  try {
    await loadGitDesktop(false);
    showToast("Git status up to date", "success");
  } catch (err) {
    showToast(`Refresh error: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "🔄 Refresh";
    }
  }
}

let _sseSource = null;

function connectGitDesktopStream(repoId) {
  if (!repoId || typeof EventSource === "undefined") return;
  if (_sseSource && _sseSource._repoId === repoId && _sseSource.readyState !== EventSource.CLOSED) return;

  if (_sseSource) {
    _sseSource.close();
    _sseSource = null;
  }

  try {
    const token = localStorage.getItem("gda_token");
    const streamUrl = `/api/git/stream/${encodeURIComponent(repoId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    _sseSource = new EventSource(streamUrl);
    _sseSource._repoId = repoId;

    _sseSource.addEventListener("git-status", (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload?.status && window.state?.currentPage === "git-desktop" && !window.state?.gitDesktop?.isActionRunning) {
          applyGitStatusUpdate(payload.status, window.state.activeRepository, true);
        }
      } catch (_) { }
    });

    _sseSource.onerror = () => {
      // EventSource auto-reconnects
    };
  } catch (err) {
    console.warn("SSE connection error:", err);
  }
}

// Auto-refresh when window focus or tab visibility changes
window.addEventListener("focus", () => {
  if (window.state?.currentPage === "git-desktop" && !window.state?.gitDesktop?.isActionRunning) {
    loadGitDesktop(false).catch(() => { });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && window.state?.currentPage === "git-desktop" && !window.state?.gitDesktop?.isActionRunning) {
    loadGitDesktop(false).catch(() => { });
  }
});

// Periodic background polling (every 2s) like GitHub Desktop
if (!window._gitDesktopPoller) {
  window._gitDesktopPoller = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      window.state?.currentPage === "git-desktop" &&
      (window.state?.activeRepository || localStorage.getItem("gda_active_repo_id")) &&
      !window.state?.gitDesktop?.isActionRunning
    ) {
      loadGitDesktop(false).catch(() => { });
    }
  }, 2000);
}

// ── Client Directory Watcher (File System Access API for Deployed / Cloud Mode) ──
let _localDirWatcherInterval = null;
const _knownLocalFileMtimes = new Map();
let _isScanningLocalDir = false;

async function scanDirectoryHandle(dirHandle, basePath = "") {
  const files = [];
  const IGNORED = new Set([".git", "node_modules", ".cache", "dist", "build", ".gemini", "$RECYCLE.BIN"]);
  for await (const [name, entry] of dirHandle.entries()) {
    if (IGNORED.has(name) || name.startsWith(".")) continue;
    const relPath = basePath ? `${basePath}/${name}` : name;
    if (entry.kind === "file") {
      try {
        const file = await entry.getFile();
        if (file.size <= 1048576) {
          const content = await file.text();
          files.push({ filePath: relPath, content, lastModified: file.lastModified, size: file.size });
        }
      } catch (_) { }
    } else if (entry.kind === "directory") {
      const subFiles = await scanDirectoryHandle(entry, relPath);
      files.push(...subFiles);
    }
  }
  return files;
}

async function startLocalDirectorySync(repoId, dirHandle) {
  if (!repoId || !dirHandle) return;
  window._activeLocalDirHandle = dirHandle;

  try {
    const files = await scanDirectoryHandle(dirHandle);
    _knownLocalFileMtimes.clear();
    for (const f of files) {
      _knownLocalFileMtimes.set(f.filePath, f.lastModified);
    }
    // Batch sync to server
    if (files.length > 0) {
      await api.syncGitWorkspace(repoId, files.map((f) => ({ filePath: f.filePath, content: f.content })));
      await loadGitDesktop(false);
    }
  } catch (err) {
    console.warn("Initial local directory sync warning:", err);
  }

  // Start polling directory handle for changes (every 1.5s)
  if (_localDirWatcherInterval) clearInterval(_localDirWatcherInterval);
  _localDirWatcherInterval = setInterval(() => {
    checkLocalDirectoryChanges(repoId, dirHandle).catch(() => { });
  }, 1500);
}

async function checkLocalDirectoryChanges(repoId, dirHandle) {
  if (_isScanningLocalDir || !dirHandle || !repoId) return;
  _isScanningLocalDir = true;
  try {
    const files = await scanDirectoryHandle(dirHandle);
    let hasChanges = false;
    for (const f of files) {
      const prevMtime = _knownLocalFileMtimes.get(f.filePath);
      if (prevMtime === undefined || prevMtime !== f.lastModified) {
        _knownLocalFileMtimes.set(f.filePath, f.lastModified);
        hasChanges = true;
        await api.syncGitFile(repoId, f.filePath, f.content, "write");
      }
    }
    if (hasChanges) {
      await loadGitDesktop(false);
    }
  } catch (_) {
  } finally {
    _isScanningLocalDir = false;
  }
}

// Window exports
window.refreshGitDesktop = refreshGitDesktop;
window.loadGitDesktop = loadGitDesktop;
window.startLocalDirectorySync = startLocalDirectorySync;
window.scanDirectoryHandle = scanDirectoryHandle;
window.filterChangedFiles = filterChangedFiles;
window.renderGitDesktopChanges = renderGitDesktopChanges;
window.generateAutoCommitMessage = generateAutoCommitMessage;
window.viewGitDesktopDiff = viewGitDesktopDiff;
window.openCurrentFileInOs = openCurrentFileInOs;
window.openSpecificFileInOs = openSpecificFileInOs;
window.viewAllFilesDiff = viewAllFilesDiff;
window.renderMultiFileDiff = renderMultiFileDiff;
window.renderFormattedDiff = renderFormattedDiff;
window.switchGitDesktopTab = switchGitDesktopTab;
window.switchGitDesktopLeftTab = switchGitDesktopLeftTab;
window.commitFromGitDesktop = commitFromGitDesktop;
window.triggerAIAnalyzeChanges = triggerAIAnalyzeChanges;
window.triggerAICommitAll = triggerAICommitAll;
window.triggerGitFetch = triggerGitFetch;
window.triggerGitPull = triggerGitPull;
window.triggerGitSync = triggerGitSync;
window.openPushPreviewModal = openPushPreviewModal;
window.onPushTargetBranchChanged = onPushTargetBranchChanged;
window.executePushFromModal = executePushFromModal;
window.openBranchSwitcherModal = openBranchSwitcherModal;
window.renderBranchSwitcherList = renderBranchSwitcherList;
window.filterBranchList = filterBranchList;
window.checkoutSelectedBranch = checkoutSelectedBranch;
window.createAndCheckoutBranch = createAndCheckoutBranch;
window.triggerAIShip = triggerAIShip;
window.toggleFileStaging = toggleFileStaging;
window.toggleAllStaging = toggleAllStaging;
window.updateCommitButtonText = updateCommitButtonText;

document.addEventListener("change", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "toggleFileStaging") {
    toggleFileStaging(target.dataset.path, target);
  } else if (action === "toggleAllStaging") {
    toggleAllStaging(target);
  }
});
