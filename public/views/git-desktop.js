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
  linkLocalFolderToGitDesktop: () => linkLocalFolderToGitDesktop(),
  openGitDesktopFileEditor: (value, target) => openGitDesktopFileEditor(value || target?.dataset?.path),
  saveGitDesktopFile: () => saveGitDesktopFile(),
  discardGitChanges: (value, target) => discardGitChanges(value || target?.dataset?.path),
  discardAllGitChanges: () => discardAllGitChanges(),
  triggerGitStash: () => triggerGitStash(),
  triggerGitStashPop: () => triggerGitStashPop(),
  openGitStashModal: () => openGitStashModal(),
  saveNewGitStash: () => saveNewGitStash(),
  refreshGitStashes: () => refreshGitStashes(),
  popStashEntry: (value, target) => popStashEntry(value || target?.dataset?.index),
  dropStashEntry: (value, target) => dropStashEntry(value || target?.dataset?.index),
  viewStashDiff: (value, target) => viewStashDiff(value || target?.dataset?.index),
  hideStashDiff: () => hideStashDiff(),
  triggerGitUndoCommit: () => triggerGitUndoCommit(),
  stageGitHunk: (value, target) => stageGitHunk(value || target?.dataset?.hunkkey),
  discardGitHunk: (value, target) => discardGitHunk(value || target?.dataset?.hunkkey),
  deleteLocalBranch: (value) => deleteLocalBranch(value),
  filterBranchList: () => filterBranchList(),
  createAndCheckoutBranch: () => createAndCheckoutBranch(),
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

  // Update dynamic remote badge in Git Desktop header
  const remoteEl = document.getElementById("gd-remote-name");
  const isGitAgent = (repo.name || "").toLowerCase() === "git-agent";
  const hasRealUrl = repo.url && (isGitAgent || !repo.url.includes("HarshPariya/git-agent"));
  if (remoteEl) {
    if (hasRealUrl) {
      try {
        const u = new URL(repo.url);
        const pathPart = u.pathname.replace(/^\/|\.git$/g, "");
        remoteEl.textContent = pathPart ? `origin (${pathPart})` : "origin";
        remoteEl.title = repo.url;
      } catch {
        remoteEl.textContent = "origin";
        remoteEl.title = repo.url;
      }
    } else {
      remoteEl.textContent = "Local (No remote)";
      remoteEl.title = "Local repository without remote origin";
    }
  }

  // Update Push / Fetch button labels according to remote availability
  const pushBtn = document.querySelector('button[data-action="openPushPreviewModal"]');
  if (pushBtn) {
    pushBtn.innerHTML = hasRealUrl ? "⬆️ Push origin" : "⬆️ Publish Repo";
    pushBtn.title = hasRealUrl ? "Push commits to remote origin" : "Publish this local repository to GitHub";
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
    if (window.state.gitDesktop?.activeDiffTab === "gd-all-diff") {
      viewAllFilesDiff(false);
    } else {
      const currentSelected = window.state.gitDesktop?.selectedFile;
      const fileToView = changedFiles.some((f) => f.filePath === currentSelected)
        ? currentSelected
        : changedFiles[0].filePath;
      viewGitDesktopDiff(fileToView, !isBackground);
    }
  } else {
    setGitDesktopState({ selectedFile: null });
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

      const cleanHtml = `
        <div class="empty-state" style="padding:60px 20px">
          <div class="empty-icon" style="font-size:32px;color:#10b981">✓</div>
          <div class="empty-title" style="font-size:15px;margin-top:8px">Working tree is clean</div>
          <div class="empty-desc" style="max-width:400px;margin:8px auto 0;color:var(--c-text-muted)">
            All changes committed and synchronized with your branch.
          </div>
        </div>`;

      const viewer = document.getElementById("gd-diff-viewer");
      if (viewer) {
        viewer.innerHTML = cleanHtml;
        window._currentRenderedDiffFile = null;
        window._currentRenderedDiffText = null;
      }
      const allViewer = document.getElementById("gd-all-diff-viewer");
      if (allViewer) {
        allViewer.innerHTML = cleanHtml;
        allViewer.dataset.rendered = "";
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

  // If no repository is active or added yet, do not auto-connect anything!
  if (!repo) {
    const repoNameEl = document.getElementById("gd-repo-name");
    if (repoNameEl) repoNameEl.textContent = "No repository open";
    const branchBtn = document.getElementById("gd-branch-name");
    if (branchBtn) branchBtn.innerHTML = `No branch`;
    const remoteEl = document.getElementById("gd-remote-name");
    if (remoteEl) remoteEl.textContent = "No remote";
    const aheadBehindEl = document.getElementById("gd-ahead-behind");
    if (aheadBehindEl) aheadBehindEl.textContent = "↑ 0 · ↓ 0";
    const workingStatusEl = document.getElementById("gd-working-status");
    if (workingStatusEl) {
      workingStatusEl.textContent = "No repo";
      workingStatusEl.className = "badge";
    }
    const changesCountEl = document.getElementById("gd-changes-count");
    if (changesCountEl) changesCountEl.textContent = "0";

    const changesListEl = document.getElementById("gd-changes-list");
    if (changesListEl) {
      changesListEl.innerHTML = `
        <div class="empty-state" style="padding:36px 16px;text-align:center">
          <div class="empty-icon" style="font-size:32px;margin-bottom:12px">📁</div>
          <div class="empty-title" style="font-weight:600;font-size:14px">No repository selected</div>
          <div class="empty-desc" style="color:var(--c-text-muted);font-size:12px;margin:6px 0 16px;line-height:1.4">Open a local project folder or connect an existing repository.</div>
          <div style="display:flex;flex-direction:column;gap:8px;max-width:200px;margin:0 auto">
            <button class="btn btn-primary btn-sm" data-action="linkLocalFolderToGitDesktop">📂 Open Local Folder</button>
            <button class="btn btn-secondary btn-sm" data-action="openFolderBrowser">Browse Repositories</button>
          </div>
        </div>`;
    }

    const diffViewer = document.getElementById("gd-diff-viewer");
    if (diffViewer) {
      diffViewer.innerHTML = `
        <div class="empty-state" style="padding:60px 24px;text-align:center">
          <div class="empty-icon" style="font-size:48px;margin-bottom:16px">🚀</div>
          <h3 style="font-size:18px;font-weight:600;margin-bottom:8px">Welcome to Git Desktop</h3>
          <p style="color:var(--c-text-muted);max-width:460px;margin:0 auto 24px;font-size:14px;line-height:1.5">
            Open any project folder on your computer to track real modified files, review line-by-line diffs, create AI commit plans, and push directly to GitHub.
          </p>
          <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
            <button class="btn btn-primary" data-action="linkLocalFolderToGitDesktop" style="padding:8px 18px">📂 Open Local Folder</button>
            <button class="btn btn-secondary" data-action="openFolderBrowser" style="padding:8px 18px">📁 Add Existing Repo</button>
          </div>
        </div>`;
    }
    const pathEl = document.getElementById("gd-diff-filepath");
    if (pathEl) pathEl.textContent = "No repository open";
    const metaEl = document.getElementById("gd-diff-meta");
    if (metaEl) metaEl.textContent = "Open a local project folder or select a repository to inspect changes";
    return;
  }

  window.setState("activeRepository", repo);
  const repoNameEl = document.getElementById("gd-repo-name");
  if (repoNameEl) repoNameEl.textContent = repo.name || repo.path || "Repository";

  try {
    // Auto-restore previously linked local directory if available and granted
    if (!window._activeLocalDirHandle && typeof getStoredDirHandle === "function") {
      try {
        const handle = await getStoredDirHandle("active_dir");
        if (handle) {
          const perm = typeof handle.queryPermission === "function"
            ? await handle.queryPermission({ mode: "readwrite" }).catch(() => "prompt")
            : "prompt";
          if (perm === "granted") {
            window._activeLocalDirHandle = handle;
            const badge = document.getElementById("gd-local-folder-badge");
            const nameEl = document.getElementById("gd-local-folder-name");
            if (badge && nameEl) {
              nameEl.textContent = `Local: ${handle.name}`;
              badge.style.display = "inline-flex";
              badge.className = "badge badge-success";
            }
          }
        }
      } catch (_) {}
    }

    // Direct browser Git operations on user's PC folder
    if (window._activeLocalDirHandle && window.gitLocalEngine) {
      const status = await window.gitLocalEngine.getStatus(window._activeLocalDirHandle);
      applyGitStatusUpdate(status, repo, !manual);
      startLocalDirectoryWatcher(window._activeLocalDirHandle);
      return;
    }

    connectGitDesktopStream(repo.id);
    const status = await api.getGitStatus(repo.id);
    applyGitStatusUpdate(status, repo, !manual);
    loadGitStashCount(repo);
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
  btn.disabled = files.length === 0 || selectedCount === 0;
}

async function toggleFileStaging(filePath, target) {
  const repo = window.state.activeRepository;
  if (!filePath) return;
  const isChecked = target ? target.checked : true;

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      if (isChecked) {
        await window.gitLocalEngine.stageFile(window._activeLocalDirHandle, filePath);
      } else {
        await window.gitLocalEngine.unstageFile(window._activeLocalDirHandle, filePath);
      }
      const status = await window.gitLocalEngine.getStatus(window._activeLocalDirHandle);
      applyGitStatusUpdate(status, repo, true);
    } catch (err) {
      showToast(`Local staging error: ${err.message}`, "error");
    }
    return;
  }

  if (!repo) return;
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
  const isChecked = target ? target.checked : true;

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      if (isChecked) {
        await window.gitLocalEngine.stageAll(window._activeLocalDirHandle);
      } else {
        await window.gitLocalEngine.unstageAll(window._activeLocalDirHandle);
      }
      const status = await window.gitLocalEngine.getStatus(window._activeLocalDirHandle);
      applyGitStatusUpdate(status, repo, true);
    } catch (err) {
      showToast(`Local staging all error: ${err.message}`, "error");
    }
    return;
  }

  if (!repo) return;
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
      <div class="empty-state" style="padding:36px 16px;text-align:center">
        <div class="empty-icon" style="font-size:28px;color:#10b981">✓</div>
        <div class="empty-title" style="margin-top:6px;font-weight:600">No uncommitted changes</div>
        <div class="empty-desc" style="font-size:12px;color:var(--c-text-muted);margin-top:4px">Your working tree is completely clean and matches branch HEAD.</div>
      </div>`;
    updateCommitButtonText();
    return;
  }

  const allSelected = allChanged.length > 0 && allChanged.every((f) => f.selected !== false);

  let html = `<div style="display:flex;flex-direction:column">`;

  // Overview row for All Changed Files (Continuous diff) with Select All checkbox
  html += `
    <div class="git-change-row all-files-row" style="background:var(--c-surface-hover);font-weight:600;border-bottom:1.5px solid var(--c-border);display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:pointer" data-action="switchGitDesktopTab" data-value="gd-all-diff">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="gd-select-all" ${allSelected ? "checked" : ""} style="cursor:pointer;width:15px;height:15px;accent-color:var(--c-accent)" title="Select / Deselect All for commit" data-action="toggleAllStaging" data-stopprop="true">
        <span class="git-file-name" style="font-weight:700;color:var(--c-accent);cursor:pointer">
          All Changed Files (${allChanged.length})
        </span>
      </div>
      <div class="git-change-right">
        <span class="badge badge-secondary" style="font-size:10px;cursor:pointer">VIEW ALL</span>
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
        <div class="git-change-right" style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span class="badge ${riskBadgeClass}" style="font-size:9.5px">${f.risk.toUpperCase()}</span>
          <button class="btn btn-secondary btn-sm" style="padding:2px 7px;font-size:10px" data-action="viewGitDesktopDiff" data-value="${escapeHtml(f.filePath)}" data-stopprop="true" title="Inspect Diff">
            Diff
          </button>
          <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:10px" data-action="openGitDesktopFileEditor" data-path="${escapeHtml(f.filePath)}" data-stopprop="true" title="Edit this file online">
            ✏️
          </button>
          <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:10px;color:var(--c-danger)" data-action="discardGitChanges" data-path="${escapeHtml(f.filePath)}" data-stopprop="true" title="Discard uncommitted changes in this file">
            🗑️
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
    if (window._activeLocalDirHandle && window.gitLocalEngine) {
      try {
        const diff = await window.gitLocalEngine.getDiff(window._activeLocalDirHandle, "");
        if (diff) {
          try {
            const res = await api.generateCommitMessage(repo.id, { diffSnippet: diff.slice(0, 3000) });
            if (res?.summary) {
              summaryEl.value = res.summary;
              if (res.description) descEl.value = res.description;
              const branchLabel = document.getElementById("gd-commit-branch-label");
              if (branchLabel && res.branch) branchLabel.textContent = res.branch;
              return;
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

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

  setGitDesktopState({ selectedFile: filePath, activeDiffTab: "gd-diff" });

  const diffBtn = document.getElementById("gd-tab-btn-diff");
  const allDiffBtn = document.getElementById("gd-tab-btn-all-diff");
  const diffPanel = document.getElementById("panel-gd-diff");
  const allDiffPanel = document.getElementById("panel-gd-all-diff");

  if (diffBtn) diffBtn.className = "btn btn-secondary btn-sm";
  if (allDiffBtn) allDiffBtn.className = "btn btn-ghost btn-sm";
  if (diffPanel) diffPanel.style.display = "block";
  if (allDiffPanel) allDiffPanel.style.display = "none";

  const pathEl = document.getElementById("gd-diff-filepath");
  if (pathEl) pathEl.textContent = filePath;

  const statusBadge = document.getElementById("gd-diff-status-badge");
  const currentFileObj = (window.state.gitDesktop?.changedFiles || []).find((f) => f.filePath === filePath);
  if (statusBadge) {
    const code = currentFileObj?.code || "M";
    statusBadge.textContent = code === "A" ? "ADDED" : code === "D" ? "DELETED" : code === "U" ? "UNTRACKED" : "MODIFIED";
    statusBadge.className = `badge ${currentFileObj?.status === "added" ? "badge-success" : currentFileObj?.status === "deleted" ? "badge-danger" : "badge-accent"}`;
    statusBadge.style.display = "inline-block";
  }

  const metaEl = document.getElementById("gd-diff-meta");
  if (metaEl) {
    const code = currentFileObj?.code || "M";
    const statusText =
      code === "A"
        ? "New untracked/added file"
        : code === "D"
          ? "Deleted file"
          : code === "U"
            ? "Untracked working tree file"
            : "Modified file";
    metaEl.textContent = `${statusText} · ${filePath}`;
  }

  const revealBtn = document.getElementById("gd-btn-reveal-os");
  const editBtn = document.getElementById("gd-btn-open-editor");
  if (revealBtn) {
    revealBtn.dataset.value = filePath;
    revealBtn.style.display = "inline-flex";
  }
  if (editBtn) {
    editBtn.dataset.value = filePath;
    editBtn.style.display = "inline-flex";
  }

  const summaryInput = document.getElementById("gd-commit-summary");
  if (summaryInput && !summaryInput.value.trim()) {
    summaryInput.placeholder = `Update ${filePath.split("/").pop()}`;
  }

  const viewer = document.getElementById("gd-diff-viewer");
  const isDifferentFile = window._currentRenderedDiffFile !== filePath;

  // Background optimization: If background poll and diff is already rendered for this file, avoid redundant network fetch
  if (!showLoading && !isDifferentFile && window._currentRenderedDiffText !== null) {
    return;
  }

  if (viewer && (showLoading || isDifferentFile)) {
    viewer.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--c-text-muted)"><div class="spinner"></div><div style="margin-top:8px">Loading unified diff for ${escapeHtml(filePath)}...</div></div>`;
  }

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      const diffText = await window.gitLocalEngine.getDiff(window._activeLocalDirHandle, filePath);
      if (diffText?.trim()) {
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
      return;
    } catch (err) {
      if (viewer) viewer.innerHTML = `<div class="text-danger" style="padding:16px">Local diff error: ${escapeHtml(err.message)}</div>`;
      return;
    }
  }

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

async function viewAllFilesDiff(showLoading = true) {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  setGitDesktopState({ activeDiffTab: "gd-all-diff" });

  const diffBtn = document.getElementById("gd-tab-btn-diff");
  const allDiffBtn = document.getElementById("gd-tab-btn-all-diff");
  const diffPanel = document.getElementById("panel-gd-diff");
  const allDiffPanel = document.getElementById("panel-gd-all-diff");

  if (diffBtn) diffBtn.className = "btn btn-ghost btn-sm";
  if (allDiffBtn) allDiffBtn.className = "btn btn-secondary btn-sm";
  if (diffPanel) diffPanel.style.display = "none";
  if (allDiffPanel) allDiffPanel.style.display = "block";

  const pathEl = document.getElementById("gd-diff-filepath");
  if (pathEl) pathEl.textContent = "All Changed Files";

  const statusBadge = document.getElementById("gd-diff-status-badge");
  const files = window.state.gitDesktop?.changedFiles || [];
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
  if (viewer && showLoading && (!viewer.dataset.rendered || viewer.innerHTML.includes("empty-state"))) {
    viewer.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--c-text-muted)"><div class="spinner"></div><div style="margin-top:8px">Loading complete unified diff across all changed files...</div></div>`;
  }

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      const diffText = await window.gitLocalEngine.getDiff(window._activeLocalDirHandle, "");
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
      return;
    } catch (err) {
      if (viewer) viewer.innerHTML = `<div class="text-danger" style="padding:16px">Local diff error: ${escapeHtml(err.message)}</div>`;
      return;
    }
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

    if (viewer) viewer.dataset.rendered = "true";
    renderMultiFileDiff("gd-all-diff-viewer", diffText);
  } catch (err) {
    if (viewer) viewer.innerHTML = `<div class="text-danger" style="padding:16px">Error loading all diffs: ${escapeHtml(err.message)}</div>`;
  }
}

function renderMultiFileDiff(containerId, diffText) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const cleanText = (diffText || "").replace(/\r/g, "");
  if (!cleanText.trim()) {
    el.innerHTML = `<div class="empty-state" style="padding:32px"><div class="empty-title">No diff content</div></div>`;
    return;
  }

  const fileChunks = cleanText.split(/(?:\n|^)(?=diff --git a\/)/).filter(Boolean);
  let html = `<div style="display:flex;flex-direction:column;gap:16px">`;

  fileChunks.forEach((chunk) => {
    const lines = chunk.trim().split("\n");
    const firstLine = lines[0] || "";
    const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(firstLine);
    const filePath = match ? match[2].trim() : (firstLine.replace(/^diff --git a\//, "").replace(/^diff --git /, "").trim() || "Modified File");

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
    let renderedLinesCount = 0;

    const SKIP_PREFIXES = [
      "diff --git", "index ", "--- ", "+++ ", "new file mode",
      "deleted file mode", "old mode", "new mode", "similarity index",
      "rename from", "rename to", "\\ No newline at end of file"
    ];

    const renderDiffLine = {
      chunk: (escaped) => `<div class="diff-file-row diff-line-chunk"><div class="diff-line-number" style="background:#f1f5f9;color:#64748b">...</div><div class="diff-line-content">${escaped}</div></div>`,
      add: (escaped, num) => `<div class="diff-file-row diff-line-add"><div class="diff-line-number" style="background:#dcfce7;color:#15803d">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
      del: (escaped, num) => `<div class="diff-file-row diff-line-del"><div class="diff-line-number" style="background:#fee2e2;color:#b91c1c">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
      context: (escaped, num) => `<div class="diff-file-row diff-line-context"><div class="diff-line-number">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("Binary files")) {
        html += `<div class="diff-file-row diff-line-chunk"><div class="diff-line-number" style="background:#f1f5f9;color:#64748b">...</div><div class="diff-line-content" style="color:var(--c-text-muted);font-style:italic">Binary file (diff not displayed)</div></div>`;
        renderedLinesCount++;
        continue;
      }
      if (SKIP_PREFIXES.some((p) => line.startsWith(p))) continue;
      const escaped = escapeHtml(line);

      if (line.startsWith("@@")) {
        const hunkMatch = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunkMatch) {
          lineNumOld = parseInt(hunkMatch[1], 10);
          lineNumNew = parseInt(hunkMatch[2], 10);
        }
        html += renderDiffLine.chunk(escaped);
        renderedLinesCount++;
      } else if (line.startsWith("+")) {
        html += renderDiffLine.add(escaped, lineNumNew > 0 ? lineNumNew++ : "+");
        renderedLinesCount++;
      } else if (line.startsWith("-")) {
        html += renderDiffLine.del(escaped, lineNumOld > 0 ? lineNumOld++ : "-");
        renderedLinesCount++;
      } else {
        if (lineNumOld > 0) lineNumOld++;
        if (lineNumNew > 0) lineNumNew++;
        html += renderDiffLine.context(escaped, lineNumNew > 0 ? (lineNumNew - 1) : "");
        renderedLinesCount++;
      }
    }

    if (renderedLinesCount === 0) {
      html += `<div class="diff-file-row diff-line-chunk"><div class="diff-line-number" style="background:#f1f5f9;color:#64748b">...</div><div class="diff-line-content" style="color:var(--c-text-muted);font-style:italic">File mode changed or empty file</div></div>`;
    }

    html += `</div>`;
  });

  html += `</div>`;
  el.innerHTML = html;
}

const _activeHunkPatches = new Map();

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
  let currentHunkIndex = -1;
  let currentHunkLines = [];
  let activeKey = null;

  const flushHunk = (key, hunkLines) => {
    if (!key || !hunkLines.length || !filePath) return;
    const patchHeader = `--- a/${filePath}\n+++ b/${filePath}\n`;
    _activeHunkPatches.set(key, {
      filePath,
      patch: patchHeader + hunkLines.join("\n") + "\n",
    });
  };

  const renderDiffLine = {
    chunk: (escaped, hunkKey) => `
      <div class="diff-hunk-bar" style="display:flex;justify-content:space-between;align-items:center;padding:5px 12px;background:#f1f5f9;border-top:1px solid var(--c-border);border-bottom:1px solid var(--c-border);font-family:var(--font-mono);font-size:11px">
        <span style="color:#0284c7;font-weight:600">${escaped}</span>
        ${filePath ? `
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:10px;color:var(--c-primary);background:#e0f2fe;border:1px solid #bae6fd" data-action="stageGitHunk" data-hunkkey="${hunkKey}" title="Stage only this hunk">
            + Stage Hunk
          </button>
          <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:10px;color:var(--c-danger);background:#fee2e2;border:1px solid #fecaca" data-action="discardGitHunk" data-hunkkey="${hunkKey}" title="Discard changes in this hunk">
            ✕ Discard Hunk
          </button>
        </div>` : ""}
      </div>`,
    add: (escaped, num) => `<div class="diff-file-row diff-line-add"><div class="diff-line-number" style="background:#dcfce7;color:#15803d">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
    del: (escaped, num) => `<div class="diff-file-row diff-line-del"><div class="diff-line-number" style="background:#fee2e2;color:#b91c1c">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
    context: (escaped, num) => `<div class="diff-file-row diff-line-context"><div class="diff-line-number">${num}</div><div class="diff-line-content">${escaped}</div></div>`,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const escaped = escapeHtml(line);

    if (line.startsWith("@@")) {
      if (activeKey) {
        flushHunk(activeKey, currentHunkLines);
      }
      currentHunkIndex++;
      activeKey = `${filePath}::hunk_${currentHunkIndex}`;
      currentHunkLines = [line];

      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        lineNumOld = parseInt(match[1], 10);
        lineNumNew = parseInt(match[2], 10);
      }
      html += renderDiffLine.chunk(escaped, activeKey);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      if (activeKey) currentHunkLines.push(line);
      html += renderDiffLine.add(escaped, lineNumNew > 0 ? lineNumNew++ : "+");
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      if (activeKey) currentHunkLines.push(line);
      html += renderDiffLine.del(escaped, lineNumOld > 0 ? lineNumOld++ : "-");
    } else {
      if (activeKey && !line.startsWith("diff --git") && !line.startsWith("index ")) {
        currentHunkLines.push(line);
      }
      if (lineNumOld > 0) lineNumOld++;
      if (lineNumNew > 0) lineNumNew++;
      html += renderDiffLine.context(escaped, lineNumNew > 0 ? (lineNumNew - 1) : "");
    }
  }

  if (activeKey) {
    flushHunk(activeKey, currentHunkLines);
  }

  html += `</div>`;
  el.innerHTML = html;
}

async function stageGitHunk(hunkKey) {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const hunkInfo = _activeHunkPatches.get(hunkKey);
  if (!hunkInfo || !hunkInfo.patch) {
    showToast("Hunk patch data not found", "warning");
    return;
  }

  showToast("Staging hunk...", "info");
  try {
    await api.gitStageHunk(repo.id, hunkInfo.patch);
    showToast("Hunk staged successfully!", "success");
    await loadGitDesktop(false);
    if (hunkInfo.filePath) {
      await viewGitDesktopDiff(hunkInfo.filePath, false);
    }
  } catch (err) {
    showToast(`Failed to stage hunk: ${err.message}`, "error");
  }
}

async function discardGitHunk(hunkKey) {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const hunkInfo = _activeHunkPatches.get(hunkKey);
  if (!hunkInfo || !hunkInfo.patch) {
    showToast("Hunk patch data not found", "warning");
    return;
  }

  if (!confirm("Are you sure you want to discard this hunk? This cannot be undone.")) {
    return;
  }

  showToast("Discarding hunk...", "info");
  try {
    await api.gitDiscardHunk(repo.id, hunkInfo.patch);
    showToast("Hunk discarded successfully!", "success");
    await loadGitDesktop(false);
    if (hunkInfo.filePath) {
      await viewGitDesktopDiff(hunkInfo.filePath, false);
    }
  } catch (err) {
    showToast(`Failed to discard hunk: ${err.message}`, "error");
  }
}

function switchGitDesktopTab(tabName) {
  setGitDesktopState({ activeDiffTab: tabName });
  const diffBtn = document.getElementById("gd-tab-btn-diff");
  const allDiffBtn = document.getElementById("gd-tab-btn-all-diff");
  const diffPanel = document.getElementById("panel-gd-diff");
  const allDiffPanel = document.getElementById("panel-gd-all-diff");

  if (diffBtn) diffBtn.className = tabName === "gd-diff" ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm";
  if (allDiffBtn) allDiffBtn.className = tabName === "gd-all-diff" ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm";

  if (diffPanel) diffPanel.style.display = tabName === "gd-diff" ? "block" : "none";
  if (allDiffPanel) allDiffPanel.style.display = tabName === "gd-all-diff" ? "block" : "none";

  if (tabName === "gd-all-diff") {
    viewAllFilesDiff(true);
  } else if (tabName === "gd-diff") {
    const currentSelected = window.state.gitDesktop?.selectedFile;
    const files = window.state.gitDesktop?.changedFiles || [];
    const fileToView = files.some((f) => f.filePath === currentSelected) ? currentSelected : (files[0]?.filePath);
    if (fileToView) {
      viewGitDesktopDiff(fileToView, false);
    }
  }
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

    // Direct local commit via isomorphic-git on user's local PC folder
    if (window._activeLocalDirHandle && window.gitLocalEngine) {
      try {
        const fileList = filesToCommit || (selectedFiles.length > 0 ? selectedFiles.map((f) => f.filePath) : allFiles.map((f) => f.filePath));
        const secretReport = await window.gitLocalEngine.scanSecrets(window._activeLocalDirHandle, fileList);
        if (!secretReport.clean) {
          const preview = secretReport.matches.slice(0, 3).map((s) => `${s.file}:${s.line || 1} (${s.rule})`).join("\n");
          if (!confirm(`⚠️ SECRET SCANNER ALERT:\nDetected potential secret(s) in local files:\n\n${preview}\n\nAre you sure you want to commit these changes?`)) {
            showToast("Commit aborted due to potential secrets", "warning");
            btn.disabled = false;
            setGitDesktopState({ isActionRunning: false });
            return;
          }
        }

        if (stageAll) {
          await window.gitLocalEngine.stageAll(window._activeLocalDirHandle);
        } else if (filesToCommit) {
          for (const f of filesToCommit) {
            await window.gitLocalEngine.stageFile(window._activeLocalDirHandle, f);
          }
        }

        const commitRes = await window.gitLocalEngine.commit(window._activeLocalDirHandle, {
          message: fullMessage,
          author: {
            name: window.state.user?.name || "Developer",
            email: window.state.user?.email || "developer@local.host",
          },
        });

        showToast(`Committed locally: ${summary} (${commitRes.shortSha})`, "success");
        if (summaryInput) summaryInput.value = "";
        if (descInput) descInput.value = "";

        // Send event to n8n post-commit webhook
        fetch("/api/internal/automation/post-commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repository: repo.name,
            branch: window.state.gitDesktop.gitStatus?.branch || "main",
            commitHash: commitRes.sha,
            commitMessage: fullMessage,
            author: window.state.user?.name || "Developer",
          }),
        }).catch(() => {});

        await loadGitDesktop(false);
      } catch (err) {
        showToast(`Local commit error: ${err.message}`, "error");
      } finally {
        setGitDesktopState({ isActionRunning: false });
        if (btn) {
          btn.disabled = false;
          updateCommitButtonText();
        }
      }
      return;
    }

    // Pre-commit secret scanning guardrail
    try {
      const scanRes = await api.gitScanSecrets(repo.id);
      if (scanRes && scanRes.secrets && scanRes.secrets.length > 0) {
        const preview = scanRes.secrets.slice(0, 3).map((s) => `${s.filePath}:${s.lineNumber} (${s.rule})`).join("\n");
        const extra = scanRes.secrets.length > 3 ? `\n...and ${scanRes.secrets.length - 3} more` : "";
        if (!confirm(`⚠️ SECRET SCANNER ALERT:\nDetected ${scanRes.secrets.length} potential secret(s) or API key(s) in repository:\n\n${preview}${extra}\n\nAre you sure you want to commit these changes?`)) {
          showToast("Commit aborted due to potential secrets", "warning");
          btn.disabled = false;
          setGitDesktopState({ isActionRunning: false });
          return;
        }
      }
    } catch (_) {
      // Secret scan failed non-fatally
    }

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

async function loadGitStashCount(repo = window.state.activeRepository) {
  if (!repo) return;
  try {
    const res = await api.gitStashList(repo.id);
    const count = Array.isArray(res) ? res.length : (res.stashes?.length || 0);
    const badge = document.getElementById("gd-stash-count");
    if (badge) badge.textContent = String(count);
  } catch (err) {
    console.debug("Failed to load stash count:", err);
  }
}

async function openGitStashModal() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }
  const modal = document.getElementById("modal-git-stash");
  if (modal) modal.style.display = "flex";
  await refreshGitStashes();
}

async function refreshGitStashes() {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const container = document.getElementById("stash-list-container");
  const countEl = document.getElementById("stash-modal-count");
  if (!container) return;

  container.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:12px">Loading stashes...</div>`;

  try {
    const res = await api.gitStashList(repo.id);
    const stashes = Array.isArray(res) ? res : (res.stashes || []);
    if (countEl) countEl.textContent = String(stashes.length);
    const badge = document.getElementById("gd-stash-count");
    if (badge) badge.textContent = String(stashes.length);

    if (!stashes.length) {
      container.innerHTML = `<div class="text-muted" style="text-align:center;padding:24px;font-size:12px">No stashed changes found.</div>`;
      return;
    }

    container.innerHTML = stashes.map((s) => `
      <div style="padding:10px 14px;border-bottom:1px solid var(--c-border-subtle);display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="overflow:hidden;flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge badge-accent" style="font-size:10px;font-family:var(--font-mono)">stash@{${s.index}}</span>
            <span style="font-weight:600;font-size:12.5px;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.message)}</span>
          </div>
          <div style="font-size:11px;color:var(--c-text-muted);margin-top:3px;display:flex;gap:8px">
            <span>🌿 ${escapeHtml(s.branch || "working-tree")}</span>
            <span>·</span>
            <span>🕒 ${escapeHtml(s.date || "")}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" data-action="viewStashDiff" data-index="${s.index}">
            🔍 Diff
          </button>
          <button class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px" data-action="popStashEntry" data-index="${s.index}">
            📤 Pop
          </button>
          <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:11px;color:var(--c-danger)" data-action="dropStashEntry" data-index="${s.index}">
            🗑️
          </button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div class="text-danger" style="padding:14px;font-size:12px">Error loading stashes: ${escapeHtml(err.message)}</div>`;
  }
}

async function saveNewGitStash() {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const input = document.getElementById("new-stash-msg-input");
  const msg = input?.value?.trim() || "WIP stash from Git Desktop";
  showToast("Stashing changes...", "info");
  try {
    await api.gitStash(repo.id, msg);
    showToast("Changes stashed!", "success");
    if (input) input.value = "";
    await refreshGitStashes();
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Stash failed: ${err.message}`, "error");
  }
}

async function popStashEntry(index) {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const idx = parseInt(index, 10);
  showToast(`Popping stash@{${isNaN(idx) ? 0 : idx}}...`, "info");
  try {
    await api.gitStashPop(repo.id, isNaN(idx) ? undefined : idx);
    showToast("Stash applied and popped!", "success");
    await refreshGitStashes();
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Failed to pop stash: ${err.message}`, "error");
  }
}

async function dropStashEntry(index) {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const idx = parseInt(index, 10);
  if (!confirm(`Are you sure you want to permanently delete stash@{${idx}}?`)) return;
  try {
    await api.gitStashDrop(repo.id, idx);
    showToast(`Stash@{${idx}} dropped`, "success");
    await refreshGitStashes();
    await loadGitStashCount(repo);
  } catch (err) {
    showToast(`Failed to drop stash: ${err.message}`, "error");
  }
}

async function viewStashDiff(index) {
  const repo = window.state.activeRepository;
  if (!repo) return;
  const idx = parseInt(index, 10);
  const container = document.getElementById("stash-diff-container");
  const contentEl = document.getElementById("stash-diff-content");
  const titleEl = document.getElementById("stash-diff-title");
  if (!container || !contentEl) return;

  container.style.display = "block";
  contentEl.textContent = "Loading stash diff...";
  if (titleEl) titleEl.textContent = `Diff for stash@{${idx}}`;

  try {
    const diff = await api.gitStashDiff(repo.id, idx);
    contentEl.textContent = diff || "(No diff content for this stash)";
  } catch (err) {
    contentEl.textContent = `Error loading stash diff: ${err.message}`;
  }
}

function hideStashDiff() {
  const container = document.getElementById("stash-diff-container");
  if (container) container.style.display = "none";
}

async function triggerGitStash() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  const msg = prompt("Enter stash message (optional):", "WIP stash from Git Desktop");
  if (msg === null) return;

  showToast("Stashing changes...", "info");
  try {
    await api.gitStash(repo.id, msg || "WIP stash");
    showToast("Changes stashed successfully!", "success");
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Stash failed: ${err.message}`, "error");
  }
}

async function triggerGitStashPop() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  showToast("Restoring stashed changes...", "info");
  try {
    await api.gitStashPop(repo.id);
    showToast("Stash applied and popped successfully!", "success");
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Stash pop failed: ${err.message}`, "error");
  }
}

async function triggerGitUndoCommit() {
  const repo = window.state.activeRepository;
  if (!repo) {
    showToast("Select a repository first", "warning");
    return;
  }

  if (!confirm("Undo the most recent commit? The commit will be soft-reset, and all changes will remain preserved in your working tree.")) {
    return;
  }

  showToast("Undoing last commit...", "info");
  try {
    const res = await api.gitUndoCommit(repo.id, false);
    showToast(`Undone commit [${res.shortHash}]: ${res.undoneMessage || "Commit reset"}`, "success");
    await loadGitDesktop(false);
  } catch (err) {
    if (err.message && err.message.includes("already been pushed")) {
      showToast(`⚠️ Remote Safeguard: ${err.message}`, "error");
    } else {
      showToast(`Undo failed: ${err.message}`, "error");
    }
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
  if (!repo && !window._activeLocalDirHandle) {
    showToast("Select a repository first", "warning");
    return;
  }

  const container = document.getElementById("branch-list-container");
  if (container) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px;font-size:12px"><div class="spinner"></div><div style="margin-top:6px">Loading branches...</div></div>`;
  }
  openModal("modal-branch-switcher");

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      const data = await window.gitLocalEngine.listBranches(window._activeLocalDirHandle);
      allRepoBranches = (data.branches || []).map((b) => ({
        name: b,
        current: b === data.currentBranch,
        remote: null,
      }));
      renderBranchSwitcherList(allRepoBranches);
      return;
    } catch (err) {
      if (container) {
        container.innerHTML = `<div class="text-danger" style="padding:16px;font-size:12px">Error loading local branches: ${escapeHtml(err.message)}</div>`;
      }
      return;
    }
  }

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
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px;font-size:12px">No branches found. Connect a repository with a remote to see all branches.</div>`;
    return;
  }

  const currentBranchObj = branches.find((b) => b.current || b.name === currentBranch);
  const localBranches = branches.filter((b) => !b.remote && (b.current || b.name !== currentBranch));
  const remoteBranches = branches.filter((b) => b.remote);

  const renderBranchItem = (b) => {
    const isCurrent = b.current || b.name === currentBranch;
    const isRemote = !!b.remote;
    return `
      <div class="branch-list-item ${isCurrent ? "active-branch" : ""}"
           data-action="checkoutSelectedBranch"
           data-value="${escapeHtml(b.name)}"
           data-remote="${escapeHtml(b.remote || "")}"
           style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-radius:8px;margin-bottom:2px;transition:background 0.15s;${isCurrent ? "background:var(--c-accent-light);border:1px solid var(--c-accent-border);" : "border:1px solid transparent;"}">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="font-size:14px;flex-shrink:0">${isCurrent ? "✓" : isRemote ? "🌐" : "🌿"}</span>
          <div style="min-width:0">
            <div style="font-family:var(--font-mono);font-size:12.5px;font-weight:${isCurrent ? "700" : "500"};color:${isCurrent ? "var(--c-accent)" : "var(--c-text)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(b.name)}</div>
            ${isRemote ? `<div style="font-size:10px;color:var(--c-text-muted)">${escapeHtml(b.remote || "origin")}</div>` : ""}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${isCurrent ? '<span class="badge badge-accent" style="font-size:10px">current</span>' : `<span style="font-size:11px;color:var(--c-text-muted)">${isRemote ? "checkout →" : "switch"}</span>`}
          ${!isCurrent && !isRemote ? `<button class="btn btn-ghost btn-xs" data-action="deleteLocalBranch" data-value="${escapeHtml(b.name)}" title="Delete branch ${escapeHtml(b.name)}" style="padding:2px 6px;font-size:11px;color:var(--c-danger);opacity:0.75" onclick="event.stopPropagation()">🗑️</button>` : ""}
        </div>
      </div>`;
  };

  let html = "";

  // Current branch section
  if (currentBranchObj) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.06em;padding:4px 4px 6px">Current Branch</div>`;
    html += renderBranchItem(currentBranchObj);
  }

  // Local branches
  const otherLocal = localBranches.filter((b) => !b.current && b.name !== currentBranch);
  if (otherLocal.length > 0) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.06em;padding:10px 4px 6px">Local Branches</div>`;
    html += otherLocal.map(renderBranchItem).join("");
  }

  // Remote branches
  if (remoteBranches.length > 0) {
    html += `<div style="font-size:10px;font-weight:700;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:0.06em;padding:10px 4px 6px">Remote Branches</div>`;
    html += remoteBranches.map(renderBranchItem).join("");
  }

  container.innerHTML = html;

  // Hover effect
  container.querySelectorAll(".branch-list-item:not(.active-branch)").forEach((el) => {
    el.addEventListener("mouseenter", () => { el.style.background = "var(--c-surface-hover)"; el.style.borderColor = "var(--c-border)"; });
    el.addEventListener("mouseleave", () => { el.style.background = ""; el.style.borderColor = "transparent"; });
  });
}



function filterBranchList() {
  const query = document.getElementById("branch-search-input")?.value?.toLowerCase() || "";
  const filtered = allRepoBranches.filter((b) => b.name.toLowerCase().includes(query));
  renderBranchSwitcherList(filtered);
}

async function checkoutSelectedBranch(branchName) {
  const repo = window.state.activeRepository;
  if (!repo && !window._activeLocalDirHandle) return;

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      await window.gitLocalEngine.checkoutBranch(window._activeLocalDirHandle, branchName);
      closeModal("modal-branch-switcher");
      showToast(`Switched to local branch '${branchName}'`, "success");
      await loadGitDesktop(false);
      return;
    } catch (err) {
      showToast(`Failed to switch branch: ${err.message}`, "error");
      return;
    }
  }

  // Find branch data to check if it's remote-only
  const branchData = allRepoBranches.find((b) => b.name === branchName);
  const isRemoteOnly = branchData?.remote && !branchData.current;

  try {
    // For remote branches, we checkout with the plain name — git will auto-create local tracking
    await api.checkoutBranch(repo.id, branchName, false);
    closeModal("modal-branch-switcher");
    showToast(`Switched to branch '${branchName}'${isRemoteOnly ? " (tracking remote)" : ""}`, "success");
    // Refresh status
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Failed to switch branch: ${err.message}`, "error");
  }
}

async function deleteLocalBranch(branchName) {
  const repo = window.state.activeRepository;
  if (!branchName) return;

  if (!confirm(`Are you sure you want to delete local branch "${branchName}"?`)) return;

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      await window.gitLocalEngine.deleteBranch(window._activeLocalDirHandle, branchName);
      showToast(`Branch "${branchName}" deleted successfully.`, "success");
      const data = await window.gitLocalEngine.listBranches(window._activeLocalDirHandle);
      allRepoBranches = (data.branches || []).map((b) => ({
        name: b,
        current: b === data.currentBranch,
        remote: null,
      }));
      renderBranchSwitcherList(allRepoBranches);
      await loadGitDesktop(false);
      return;
    } catch (err) {
      showToast(`Failed to delete local branch: ${err.message}`, "error");
      return;
    }
  }

  if (!repo) return;

  try {
    await api.gitDeleteBranch(repo.id, branchName, false);
    showToast(`Branch "${branchName}" deleted successfully.`, "success");
    const data = await api.getGitBranches(repo.id);
    allRepoBranches = data.branches || [];
    renderBranchSwitcherList(allRepoBranches);
    await loadGitDesktop(false);
  } catch (err) {
    if (confirm(`Failed to delete branch "${branchName}": ${err.message}\n\nDo you want to force delete it (-D)?`)) {
      try {
        await api.gitDeleteBranch(repo.id, branchName, true);
        showToast(`Branch "${branchName}" force-deleted.`, "success");
        const data = await api.getGitBranches(repo.id);
        allRepoBranches = data.branches || [];
        renderBranchSwitcherList(allRepoBranches);
        await loadGitDesktop(false);
      } catch (fErr) {
        showToast(`Force delete failed: ${fErr.message}`, "error");
      }
    }
  }
}


async function createAndCheckoutBranch() {
  const repo = window.state.activeRepository;
  const input = document.getElementById("new-branch-name-input");
  const branchName = input ? input.value.trim() : "";

  if (!branchName) {
    showToast("Branch name is required", "warning");
    input?.focus();
    return;
  }

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      await window.gitLocalEngine.createBranch(window._activeLocalDirHandle, branchName);
      closeModal("modal-branch-switcher");
      if (input) input.value = "";
      showToast(`Created & switched to new local branch '${branchName}'`, "success");
      await loadGitDesktop(false);
      return;
    } catch (err) {
      showToast(`Failed to create local branch: ${err.message}`, "error");
      return;
    }
  }

  if (!repo) return;

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
    // Use same origin — API_BASE is "" for same-origin deployments (Vercel/Render)
    // window.location.origin handles all deployment scenarios correctly
    const apiBase = (typeof API_BASE !== "undefined" && API_BASE) ? API_BASE : "";
    const streamUrl = `${apiBase}/api/git/stream/${encodeURIComponent(repoId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    _sseSource = new EventSource(streamUrl);
    _sseSource._repoId = repoId;
    _sseSource._retryCount = 0;

    _sseSource.addEventListener("git-status", (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload?.status && window.state?.currentPage === "git-desktop" && !window.state?.gitDesktop?.isActionRunning) {
          applyGitStatusUpdate(payload.status, window.state.activeRepository, true);
        }
      } catch (_) { }
    });

    _sseSource.onerror = () => {
      // SSE not supported on serverless — the 2-second polling below handles updates
      // Close and don't attempt to reconnect (avoids error spam on Vercel)
      if (_sseSource) {
        _sseSource._retryCount = (_sseSource._retryCount || 0) + 1;
        if (_sseSource._retryCount > 3) {
          _sseSource.close();
          _sseSource = null;
        }
      }
    };
  } catch (err) {
    console.warn("SSE connection error:", err);
  }
}


// Auto-refresh when window focus or tab visibility changes
window.addEventListener("focus", () => {
  if (window.state?.currentPage === "git-desktop" && !window.state?.gitDesktop?.isActionRunning) {
    if (window._activeLocalDirHandle && window.state?.activeRepository) {
      checkLocalDirectoryChanges(window.state.activeRepository.id, window._activeLocalDirHandle).catch(() => {});
    }
    loadGitDesktop(false).catch(() => { });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && window.state?.currentPage === "git-desktop" && !window.state?.gitDesktop?.isActionRunning) {
    if (window._activeLocalDirHandle && window.state?.activeRepository) {
      checkLocalDirectoryChanges(window.state.activeRepository.id, window._activeLocalDirHandle).catch(() => {});
    }
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

// IndexedDB Directory Handle Persistence
function openHandlesDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("git_agent_storage", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveStoredDirHandle(key, handle) {
  try {
    const db = await openHandlesDb();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, key);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  } catch (_) {
    return false;
  }
}

async function getStoredDirHandle(key) {
  try {
    const db = await openHandlesDb();
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get(key);
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch (_) {
    return null;
  }
}

window.saveStoredDirHandle = saveStoredDirHandle;
window.getStoredDirHandle = getStoredDirHandle;

async function scanDirectoryHandle(dirHandle, basePath = "") {
  const files = [];
  const IGNORED_DIRS = new Set([
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    "venv",
    "env",
    ".env",
    "node_modules",
    ".cache",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".turbo",
    ".gemini",
    ".idea",
    ".vscode",
    "coverage",
    "temp",
    "temp_git_test",
    "scratch",
    "$RECYCLE.BIN",
  ]);

  const IGNORED_EXTS = new Set([
    ".pyc",
    ".pyo",
    ".pyd",
    ".class",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".log",
    ".tmp",
    ".swp",
    ".DS_Store",
    ".bin",
  ]);

  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === "directory") {
      if (
        IGNORED_DIRS.has(name) ||
        name.startsWith(".") ||
        name.startsWith("temp_") ||
        name.endsWith(".egg-info")
      ) {
        continue;
      }
      const relPath = basePath ? `${basePath}/${name}` : name;
      const subFiles = await scanDirectoryHandle(entry, relPath);
      files.push(...subFiles);
    } else if (entry.kind === "file") {
      const ext = name.includes(".") ? "." + name.split(".").pop().toLowerCase() : "";
      if (
        IGNORED_EXTS.has(ext) ||
        name === ".DS_Store" ||
        name === "Thumbs.db" ||
        name.startsWith(".~") ||
        name.endsWith(".tmp") ||
        name.endsWith(".log")
      ) {
        continue;
      }
      try {
        const file = await entry.getFile();
        // Skip binary and oversized files (> 1MB)
        if (file.size <= 1048576) {
          const content = await file.text();
          // Skip if binary (contains null bytes)
          if (!content.includes("\0")) {
            const relPath = basePath ? `${basePath}/${name}` : name;
            files.push({ filePath: relPath, content, lastModified: file.lastModified, size: file.size });
          }
        }
      } catch (_) {}
    }
  }
  return files;
}

function startLocalDirectoryWatcher(dirHandle) {
  if (!dirHandle) return;
  window._activeLocalDirHandle = dirHandle;
  if (_localDirWatcherInterval) clearInterval(_localDirWatcherInterval);

  _localDirWatcherInterval = setInterval(async () => {
    if (_isScanningLocalDir || !window._activeLocalDirHandle || !window.gitLocalEngine) return;
    _isScanningLocalDir = true;
    try {
      const status = await window.gitLocalEngine.getStatus(window._activeLocalDirHandle);
      const prevEntries = window.state.gitDesktop?.gitStatus?.entries || [];
      const changed = JSON.stringify(status.entries) !== JSON.stringify(prevEntries);
      if (changed) {
        applyGitStatusUpdate(status, window.state.activeRepository, true);
      }
    } catch (_) {}
    finally {
      _isScanningLocalDir = false;
    }
  }, 2000);
}

// Backward-compatible alias
async function startLocalDirectorySync(repoId, dirHandle) {
  startLocalDirectoryWatcher(dirHandle);
}

async function linkLocalFolderToGitDesktop() {
  if (typeof window.showDirectoryPicker !== "function") {
    showToast("File System Access API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Brave.", "warning");
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (!dirHandle) return;

    // Detect REAL Git repository via isomorphic-git
    const repoInfo = await window.gitLocalEngine.detectRepository(dirHandle);
    if (!repoInfo.isGit) {
      const wantInit = confirm(`The folder "${dirHandle.name}" does not contain a .git directory.\n\nWould you like to initialize a new Git repository here?`);
      if (wantInit) {
        await window.gitLocalEngine.initRepository(dirHandle);
        showToast(`Initialized Git repository in ${dirHandle.name}`, "success");
      } else {
        showToast("Please choose a folder that contains a Git repository.", "info");
        return;
      }
    }

    const localRepo = {
      id: `local-${dirHandle.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
      name: dirHandle.name,
      path: dirHandle.name,
      isLocal: true,
      currentBranch: repoInfo.branch || "main",
      defaultBranch: "main",
      url: repoInfo.url || ""
    };

    window._activeLocalDirHandle = dirHandle;
    if (typeof saveStoredDirHandle === "function") {
      await saveStoredDirHandle("active_dir", dirHandle);
    }

    window.setState("activeRepository", localRepo);
    localStorage.setItem("gda_active_repo_id", localRepo.id);

    const badge = document.getElementById("gd-local-folder-badge");
    const nameEl = document.getElementById("gd-local-folder-name");
    if (badge && nameEl) {
      nameEl.textContent = `Local: ${dirHandle.name}`;
      badge.style.display = "inline-flex";
      badge.className = "badge badge-success";
    }

    showToast(`Connected local Git repository: ${dirHandle.name}`, "success");
    startLocalDirectoryWatcher(dirHandle);
    await loadGitDesktop(true);
  } catch (err) {
    if (err.name !== "AbortError") {
      showToast(`Failed to link folder: ${err.message}`, "error");
    }
  }
}

async function openGitDesktopFileEditor(filePath = "") {
  const modal = document.getElementById("modal-git-file-editor");
  const pathInput = document.getElementById("git-editor-filepath");
  const contentInput = document.getElementById("git-editor-content");
  if (!modal || !pathInput || !contentInput) return;

  pathInput.value = filePath || "";
  contentInput.value = "";

  if (filePath) {
    if (window._activeLocalDirHandle) {
      try {
        const parts = filePath.split("/").filter(Boolean);
        let curr = window._activeLocalDirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          curr = await curr.getDirectoryHandle(parts[i]);
        }
        const fileHandle = await curr.getFileHandle(parts[parts.length - 1]);
        const file = await fileHandle.getFile();
        contentInput.value = await file.text();
      } catch (_) {}
    }
  }

  modal.style.display = "flex";
}

async function saveGitDesktopFile() {
  const repo = window.state.activeRepository;
  const pathInput = document.getElementById("git-editor-filepath");
  const contentInput = document.getElementById("git-editor-content");
  const saveBtn = document.getElementById("btn-save-git-file");
  const filePath = (pathInput?.value || "").trim();
  const content = contentInput?.value || "";

  if (!filePath) {
    showToast("File path is required", "warning");
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = "Saving...";
  }

  try {
    if (window._activeLocalDirHandle) {
      try {
        const parts = filePath.split("/").filter(Boolean);
        let curr = window._activeLocalDirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          curr = await curr.getDirectoryHandle(parts[i], { create: true });
        }
        const fileHandle = await curr.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (diskErr) {
        console.warn("Could not write to local directory handle:", diskErr);
      }
    } else if (repo) {
      await api.syncGitFile(repo.id, filePath, content, "write");
    }

    const modal = document.getElementById("modal-git-file-editor");
    if (modal) modal.style.display = "none";

    showToast(`Saved ${filePath}`, "success");
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Failed to save file: ${err.message}`, "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = "💾 Save File";
    }
  }
}

async function discardGitChanges(filePath = null) {
  const repo = window.state.activeRepository;
  const targetDesc = filePath ? filePath : "all uncommitted changes";
  if (!confirm(`Are you sure you want to discard ${targetDesc}? This action cannot be undone.`)) {
    return;
  }

  if (window._activeLocalDirHandle && window.gitLocalEngine) {
    try {
      if (filePath) {
        await window.gitLocalEngine.discardFile(window._activeLocalDirHandle, filePath);
      } else {
        const allFiles = window.state.gitDesktop.changedFiles || [];
        for (const f of allFiles) {
          await window.gitLocalEngine.discardFile(window._activeLocalDirHandle, f.filePath).catch(() => {});
        }
      }
      showToast(`Discarded ${targetDesc}`, "info");
      const status = await window.gitLocalEngine.getStatus(window._activeLocalDirHandle);
      applyGitStatusUpdate(status, repo, false);
      return;
    } catch (err) {
      showToast(`Failed to discard local changes: ${err.message}`, "error");
      return;
    }
  }

  if (!repo) return;

  try {
    await api.discardGitChanges(repo.id, filePath);
    showToast(`Discarded ${targetDesc}`, "info");
    await loadGitDesktop(false);
  } catch (err) {
    showToast(`Failed to discard changes: ${err.message}`, "error");
  }
}

async function discardAllGitChanges() {
  return discardGitChanges(null);
}

// Window exports
window.refreshGitDesktop = refreshGitDesktop;
window.loadGitDesktop = loadGitDesktop;
window.linkLocalFolderToGitDesktop = linkLocalFolderToGitDesktop;
window.openGitDesktopFileEditor = openGitDesktopFileEditor;
window.saveGitDesktopFile = saveGitDesktopFile;
window.discardGitChanges = discardGitChanges;
window.discardAllGitChanges = discardAllGitChanges;
window.startLocalDirectorySync = startLocalDirectorySync;
window.startLocalDirectoryWatcher = startLocalDirectoryWatcher;
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
window.updateCommitButtonText = updateCommitButtonText;
window.stageGitHunk = stageGitHunk;
window.discardGitHunk = discardGitHunk;
window.openGitStashModal = openGitStashModal;
window.refreshGitStashes = refreshGitStashes;
window.saveNewGitStash = saveNewGitStash;
window.popStashEntry = popStashEntry;
window.dropStashEntry = dropStashEntry;
window.viewStashDiff = viewStashDiff;
window.hideStashDiff = hideStashDiff;
window.triggerGitUndoCommit = triggerGitUndoCommit;

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
