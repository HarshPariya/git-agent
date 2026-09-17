/**
 * Git Debugging Agent — Repositories & Connections View Module
 * Repository listings, active repo state, interactive folder browser, and GitHub integration
 */

async function loadRepositories() {
  const listEl = document.getElementById("repos-list");
  if (listEl) {
    listEl.innerHTML = [1, 2].map(() => `
      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="skeleton skeleton-text" style="width:120px;height:18px"></div>
          <div class="skeleton skeleton-text" style="width:60px;height:20px;border-radius:var(--r-full)"></div>
        </div>
        <div class="skeleton skeleton-text" style="width:80%;height:12px;margin-bottom:8px"></div>
        <div class="skeleton skeleton-text" style="width:40%;height:12px;margin-bottom:16px"></div>
        <div style="display:flex;gap:6px;border-top:1px solid var(--c-border);padding-top:12px">
          <div class="skeleton" style="width:80px;height:28px;border-radius:var(--r-sm)"></div>
          <div class="skeleton" style="width:100px;height:28px;border-radius:var(--r-sm)"></div>
        </div>
      </div>
    `).join("");
  }

  try {
    const data = await api.listRepositories();
    const repos = Array.isArray(data) ? data : data.repositories || [];
    window.setState("repositories", repos);
    if (typeof window.updateServerStatus === "function") window.updateServerStatus();

    // Restore user's explicitly selected repo from localStorage or auto-activate first
    const savedRepoId = localStorage.getItem('gda_active_repo_id');
    const currentRepoId = window.state.activeRepository?.id;
    const targetId = savedRepoId || currentRepoId;
    const match = targetId ? repos.find((r) => r.id === targetId) : null;
    await setActiveRepository(match || repos[0] || null);

    renderRepositoriesList();
    populateRepoDropdowns();
  } catch (err) {
    showToast(`Failed to load repositories: ${err.message}`, "error");
  }
}

function formatRepoDisplayPath(r) {
  if (!r) return "";
  const isGitAgent = (r.name || "").toLowerCase() === "git-agent";
  if (r.url && (isGitAgent || !r.url.includes("HarshPariya/git-agent"))) {
    return r.url;
  }
  const pathStr = r.localPath || "";
  if (!pathStr || pathStr.startsWith("/tmp/repositories/")) {
    return `Local Repository · ${r.name || "Project"}`;
  }
  return pathStr;
}

function renderRepositoriesList() {
  const listEl = document.getElementById("repos-list");
  if (!listEl) return;

  const repos = window.state.repositories || [];

  if (repos.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">📁</div>
        <div class="empty-title">No repositories connected</div>
        <div class="empty-desc">Add any local project from your laptop or import from GitHub to start autonomous AI debugging.</div>
        <div style="display:flex;gap:10px;margin-top:14px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-action="openFolderBrowser">📁 Add Local Folder</button>
          <button class="btn btn-github btn-sm" data-action="showGitHubModalFlow">🐙 Connect GitHub</button>
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = repos
    .map(
      (r) => {
        const isActive = window.state.activeRepository && window.state.activeRepository.id === r.id;
        return `
    <div class="card ${isActive ? 'active-repo-card' : ''}" style="display:flex;flex-direction:column;justify-content:space-between;${isActive ? 'border-color:var(--c-accent);box-shadow:0 0 0 1px var(--c-accent)' : ''}">
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
            <div style="width:32px;height:32px;border-radius:var(--r-md);background:var(--c-accent-light);color:var(--c-accent);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;border:1px solid var(--c-accent-border)">
              📁
            </div>
            <div style="min-width:0">
              <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.name)}</span>
                ${isActive ? '<span class="badge badge-accent">active</span>' : ""}
              </div>
              <div style="font-size:11px;color:var(--c-text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
                ${escapeHtml(formatRepoDisplayPath(r))}
              </div>
            </div>
          </div>
          <span class="badge badge-success" style="flex-shrink:0">connected</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--c-text-secondary);margin-bottom:14px;padding-left:40px">
          <span>🌿</span>
          <code style="font-size:11px">${escapeHtml(r.currentBranch || r.defaultBranch || r.branch || "main")}</code>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--c-border-subtle);padding-top:12px">
        ${isActive
            ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.85">✓ Active</button>`
            : `<button class="btn btn-secondary btn-sm" data-action="selectActiveRepo" data-value="${escapeHtml(r.id)}">Set Active</button>`
          }
        <button class="btn btn-secondary btn-sm" data-action="openRepoInGitDesktop" data-value="${escapeHtml(r.id)}">🖥️ Git Desktop</button>
        <button class="btn btn-primary btn-sm" data-action="quickDebugRepo" data-value="${escapeHtml(r.id)}">⚡ Debug</button>
        <button class="btn btn-secondary btn-sm" data-action="syncRepo" data-value="${escapeHtml(r.id)}">🔄 Sync</button>
        <button class="btn btn-danger btn-sm" data-action="disconnectRepo" data-value="${escapeHtml(r.id)}">Disconnect</button>
      </div>
    </div>
  `;
      }
    )
    .join("");
}

async function setActiveRepository(repo) {
  window.setState("activeRepository", repo);
  if (repo) {
    localStorage.setItem('gda_active_repo_id', repo.id);
  } else {
    localStorage.removeItem('gda_active_repo_id');
  }

  const label = document.getElementById('header-active-repo-name');
  if (label) {
    label.textContent = repo?.name || 'Select Local Repository';
  }

  const badge = document.getElementById('header-active-repo');
  if (badge) {
    const dot = badge.querySelector('.active-repo-dot');
    badge.style.opacity = repo ? '1' : '0.85';
    if (dot) dot.style.background = repo ? 'var(--c-success)' : 'var(--c-text-muted)';
  }

  populateRepoDropdowns();

  // Automatically fetch live branch and status across all views
  if (!repo) {
    if (window.state.currentPage === "git-desktop" && typeof window.loadGitDesktop === "function") {
      window.loadGitDesktop();
    }
    return;
  }

  try {
    const status = await api.getGitStatus(repo.id);
    if (!status) return;

    const gitDesktopState = { gitStatus: status };
    const branchName = status.branch || repo.currentBranch || repo.defaultBranch || 'main';
    if (label) label.textContent = `${repo.name} · ${branchName}`;

    const elements = {
      'gd-branch-name': branchName,
      'gd-repo-name': repo.name || repo.path,
      'stat-branch': branchName,
      'stat-changes': `${status.entries?.length || 0} files`,
    };

    Object.entries(elements).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });

    // Populate changed files for Git Desktop automatically
    if (Array.isArray(status.entries)) {
      const statusToCode = { added: "A", deleted: "D", renamed: "R", untracked: "?" };
      const isSensitive = (path) => ["auth", "key", ".env"].some((s) => path.includes(s));

      gitDesktopState.changedFiles = status.entries.map((entry) => ({
        filePath: entry.filePath,
        status: entry.status,
        code: statusToCode[entry.status] || "M",
        staged: entry.staged,
        additions: entry.status === "added" ? 1 : 0,
        deletions: 0,
        risk: isSensitive(entry.filePath) ? "high" : "low",
        logicalGroup: null,
      }));

      const countEl = document.getElementById("gd-changes-count");
      if (countEl) countEl.textContent = `${gitDesktopState.changedFiles.length} files`;

      window.setState("gitDesktop", { ...window.state.gitDesktop, ...gitDesktopState });

      if (typeof window.renderGitDesktopChanges === "function") {
        window.renderGitDesktopChanges();
      }
    }
  } catch (e) {
    console.warn("Could not fetch git status for active repo:", e);
  }

  // Refresh active page if Git Desktop is visible
  if (window.state.currentPage === "git-desktop" && typeof window.loadGitDesktop === "function") {
    window.loadGitDesktop();
  }
}

async function selectActiveRepo(repoId) {
  const match = window.state.repositories.find((r) => r.id === repoId);
  if (match) {
    await setActiveRepository(match);
    renderRepositoriesList();
    showToast(`Active repository set to ${match.name}`, "info");
  }
}

async function openRepoInGitDesktop(repoId) {
  await selectActiveRepo(repoId);
  navigate("git-desktop");
}

function openActiveRepoPicker() {
  if (window.state.repositories.length === 0) {
    openFolderBrowser();
    return;
  }
  navigate("repositories");
}

function populateRepoDropdowns() {
  const debugSelect = document.getElementById("debug-repo");
  const issuesSelect = document.getElementById("issues-repo-select");
  const prsSelect = document.getElementById("prs-repo-select");

  const options = (window.state.repositories || []).map((r) => {
    const branchLabel = r.currentBranch || r.defaultBranch || "feature/git-agent";
    return `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} (${escapeHtml(branchLabel)})</option>`;
  });

  const activeId = window.state.activeRepository ? window.state.activeRepository.id : "";
  const placeholder = (window.state.repositories || []).length === 0 ? "No repositories connected (Click to add)" : "Select repository...";

  if (debugSelect) {
    const currentVal = debugSelect.value || activeId;
    debugSelect.innerHTML = `<option value="">${placeholder}</option>` + options.join("");
    if (currentVal) debugSelect.value = currentVal;
  }
  if (issuesSelect) {
    const currentVal = issuesSelect.value || activeId;
    issuesSelect.innerHTML = `<option value="">${placeholder}</option>` + options.join("");
    if (currentVal) issuesSelect.value = currentVal;
  }
  if (prsSelect) {
    const currentVal = prsSelect.value || activeId;
    prsSelect.innerHTML = `<option value="">${placeholder}</option>` + options.join("");
    if (currentVal) prsSelect.value = currentVal;
  }
}

function quickDebugRepo(repoId) {
  const repo = (window.state.repositories || []).find((r) => r.id === repoId);
  if (repo) setActiveRepository(repo);
  navigate("debug");
  const select = document.getElementById("debug-repo");
  if (select) select.value = repoId;
}

async function syncRepo(repoId) {
  try {
    showToast("Syncing repository...", "info");
    await api.syncRepository(repoId);
    showToast("Repository synced successfully", "success");
    loadRepositories();
  } catch (err) {
    showToast(`Failed to sync repository: ${err.message}`, "error");
  }
}

async function indexRepo(repoId) {
  try {
    showToast("Indexing repository into GraphRAG...", "info");
    await api.indexRepository(repoId);
    showToast("GraphRAG code intelligence index updated", "success");
  } catch (err) {
    showToast(`Indexing failed: ${err.message}`, "error");
  }
}

async function disconnectRepo(repoId) {
  if (!confirm("Are you sure you want to disconnect this repository?")) return;
  // Prevent duplicate disconnect requests from double-clicks
  if (window._disconnectingRepos?.has(repoId)) return;
  window._disconnectingRepos = window._disconnectingRepos || new Set();
  window._disconnectingRepos.add(repoId);

  try {
    const updatedRepos = (window.state.repositories || []).filter((r) => r.id !== repoId);
    window.setState("repositories", updatedRepos);
    // Update the navbar pill immediately so "Connected" disappears as soon as the user disconnects.
    if (typeof window.updateServerStatus === "function") window.updateServerStatus();

    if (window.state.activeRepository?.id === repoId) {
      setActiveRepository(updatedRepos[0] || null);
    }

    renderRepositoriesList();
    if (typeof window.renderDashboardRepos === "function") {
      window.renderDashboardRepos(updatedRepos);
    }
    populateRepoDropdowns();

    const res = await api.disconnectRepository(repoId);
    showToast(
      res && res.alreadyDisconnected ? "Repository was already disconnected" : "Repository disconnected successfully",
      "info",
    );

    await loadRepositories();
    if (typeof window.loadDashboardStats === "function") {
      await window.loadDashboardStats();
    }
  } catch (err) {
    showToast(`Failed to disconnect: ${err.message}`, "error");
    await loadRepositories();
  } finally {
    window._disconnectingRepos.delete(repoId);
  }
}

// ============================================================
// FOLDER BROWSER & NATIVE OS PICKER
// ============================================================

function getFileIcon(ext) {
  const icons = {
    ".ts": "📘", ".tsx": "📘", ".js": "📙", ".jsx": "📙", ".mjs": "📙", ".cjs": "📙",
    ".py": "🐍", ".rb": "💎", ".go": "🐹", ".rs": "🦀", ".java": "☕", ".kt": "🎯",
    ".cs": "🔷", ".swift": "🍎", ".c": "⚙️", ".cpp": "⚙️", ".h": "⚙️",
    ".html": "🌐", ".css": "🎨", ".scss": "🎨", ".less": "🎨",
    ".json": "📋", ".yaml": "📋", ".yml": "📋", ".toml": "📋",
    ".md": "📝", ".mdx": "📝", ".txt": "📄",
    ".sh": "🖥️", ".bash": "🖥️", ".ps1": "🖥️", ".zsh": "🖥️",
    ".sql": "🗄️", ".graphql": "🔗", ".proto": "🔗",
    ".env": "🔐", ".dockerfile": "🐳", ".makefile": "🔨",
    ".xml": "📑", ".ini": "⚙️",
  };
  return icons[ext] || "📄";
}

function initDragAndDrop() {
  const dropOverlay = document.getElementById("global-drop-overlay");
  const folderDropzone = document.getElementById("folder-dropzone");
  let dragCounter = 0;

  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    if (dropOverlay) dropOverlay.classList.add("active");
    if (folderDropzone) folderDropzone.classList.add("dragover");
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (dropOverlay) dropOverlay.classList.remove("active");
      if (folderDropzone) folderDropzone.classList.remove("dragover");
    }
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropOverlay) dropOverlay.classList.remove("active");
    if (folderDropzone) folderDropzone.classList.remove("dragover");

    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;

    const item = items[0];
    let folderName = "";

    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        folderName = entry.name;
      }
    }

    if (!folderName && item.getAsFile) {
      const file = item.getAsFile();
      if (file) {
        folderName = file.name;
      }
    }

    if (!folderName) {
      showToast("Please drag and drop a project folder", "error");
      return;
    }

    showToast(`Locating dropped folder "${folderName}"...`, "info");
    try {
      const res = await api.resolveFolder(folderName, [], window.state.currentBrowsedPath);
      if (res && res.resolvedPath && res.exists) {
        showToast(`Found: ${res.resolvedPath}`, "info");
        await connectSpecificFolder(res.folderName || folderName, res.resolvedPath);
        return;
      }
    } catch (err) {
      console.warn("Folder drop resolve error:", err);
    }

    await connectSpecificFolder(folderName, folderName);
  });
}

async function openLocalFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    showToast(
      "File System Access API is not supported in this browser. Please use Chrome, Edge, Brave, or Opera for direct local folder access.",
      "warning",
    );
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (!dirHandle) return;

    showToast(`Detecting Git repository in "${dirHandle.name}"...`, "info");
    const detection = await window.gitLocalEngine.detectRepository(dirHandle);

    if (!detection.isGit) {
      const initConfirm = confirm(
        `"${dirHandle.name}" is not a Git repository.\n\nWould you like to initialize a new Git repository in this folder?`
      );
      if (initConfirm) {
        showToast("Initializing Git repository...", "info");
        await window.gitLocalEngine.initRepository(dirHandle);
      } else {
        showToast("Folder selection cancelled (not a Git repository)", "info");
        return;
      }
    }

    window._activeLocalDirHandle = dirHandle;
    const localRepo = {
      id: "local-" + dirHandle.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: dirHandle.name,
      isLocal: true,
      mode: "LOCAL",
      dirHandle,
      currentBranch: detection.branch || "main",
      defaultBranch: detection.branch || "main",
      remotes: detection.remotes || [],
      url: detection.url || "",
      path: dirHandle.name,
      updatedAt: new Date().toISOString(),
    };

    if (typeof window.saveStoredDirHandle === "function") {
      await window.saveStoredDirHandle("active_dir", dirHandle).catch(() => {});
    }
    localStorage.setItem("gda_active_repo_id", localRepo.id);

    const existing = (window.state.repositories || []).filter((r) => r.id !== localRepo.id);
    window.setState("repositories", [localRepo, ...existing]);
    window.setState("activeRepository", localRepo);

    showToast(`Opened local repository: ${dirHandle.name} (${detection.branch || "main"})`, "success");

    if (typeof window.renderRepositoriesList === "function") window.renderRepositoriesList();
    if (typeof window.populateRepoDropdowns === "function") window.populateRepoDropdowns();
    if (typeof window.navigate === "function") window.navigate("git-desktop");
  } catch (err) {
    if (err.name !== "AbortError") {
      showToast(`Failed to open folder: ${err.message}`, "error");
    }
  }
}

async function triggerNativeFolderPicker() {
  await openLocalFolder();
}

function setupFolderDropZone() {
  const dropZone = document.getElementById("folder-drop-zone");
  if (!dropZone) return;

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--c-accent)";
    dropZone.style.background = "var(--c-accent-bg, rgba(26,86,219,0.08))";
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "var(--c-border)";
    dropZone.style.background = "var(--c-surface-hover)";
  });

  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--c-border)";
    dropZone.style.background = "var(--c-surface-hover)";

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const item = items[0];
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) {
        showToast(`Locating dropped folder "${entry.name}"...`, "info");
        try {
          const res = await api.resolveFolder(entry.name, [], window.state.currentBrowsedPath);
          if (res && res.resolvedPath && res.exists) {
            await connectSpecificFolder(res.folderName || entry.name, res.resolvedPath);
            return;
          }
        } catch (err) {
          // Fall through
        }
        await connectSpecificFolder(entry.name, entry.name);
      } else {
        triggerNativeFolderPicker();
      }
    }
  });
}

async function handleNativeFolderSelected(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const firstPath = files[0].webkitRelativePath || "";
  const rootFolderName = firstPath.split("/")[0] || "Selected Folder";
  const sampleFiles = Array.from(files)
    .slice(0, 15)
    .map((f) => {
      const rel = f.webkitRelativePath || "";
      return rel.split("/").slice(1).join("/");
    })
    .filter(Boolean);

  showToast(`Connecting folder "${rootFolderName}"...`, "info");

  try {
    const res = await api.resolveFolder(rootFolderName, sampleFiles, window.state.currentBrowsedPath);
    if (res && res.resolvedPath && res.exists) {
      showToast(`Found: ${res.resolvedPath}`, "info");
      await connectSpecificFolder(res.folderName || rootFolderName, res.resolvedPath);
      return;
    }
  } catch (err) {
    console.warn("Folder auto-resolution error:", err);
  }

  // Connect repository directly by folder name
  await connectSpecificFolder(rootFolderName, rootFolderName);
}

function openFolderBrowser(targetPath = "") {
  openModal("modal-folder-browser");
  const pathInput = document.getElementById("folder-path-input");
  if (pathInput && targetPath) {
    pathInput.value = targetPath;
  }
}

async function browseToDirectory(dirPath = "") {
  const cleanDirPath = sanitizePath(dirPath);
  const pathEl = document.getElementById("folder-current-path");
  const listEl = document.getElementById("folder-list");
  const detectedCard = document.getElementById("folder-repo-detected");
  const pathInput = document.getElementById("folder-path-input");

  if (pathEl) pathEl.textContent = "Loading...";
  if (listEl) {
    listEl.innerHTML = `<div class="text-muted" style="text-align:center;padding:24px"><div class="spinner"></div><div style="margin-top:8px">Reading directories & files...</div></div>`;
  }
  if (detectedCard) detectedCard.style.display = "none";

  try {
    const data = await api.browseFilesystem(cleanDirPath);
    window.setState("currentBrowsedPath", data.currentPath);

    if (pathEl) pathEl.textContent = data.currentPath;
    if (pathInput) pathInput.value = data.currentPath;

    // Render PC workspace roots & drives
    const quickpicksEl = document.getElementById("folder-workspace-quickpicks");
    if (quickpicksEl) {
      const shortcuts = Array.isArray(data.shortcuts) ? data.shortcuts : [];
      let qHtml = "";
      shortcuts.forEach((s) => {
        const isCurrent = s.path === data.currentPath;
        qHtml += `
          <div class="folder-shortcut-pill ${isCurrent ? "active-shortcut" : ""}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600" data-action="browseToDirectory" data-value="${escapeHtml(s.path).replace(/\\/g, "\\\\")}">
            <span>${escapeHtml(s.name)}</span>
          </div>`;
      });
      quickpicksEl.innerHTML = qHtml;
    }

    const folderName = data.currentPath.split(/[\\/]/).filter(Boolean).pop() || "Folder";
    if (detectedCard) {
      detectedCard.style.display = "flex";
      const titleEl = detectedCard.querySelector(".current-target-title");
      const nameEl = document.getElementById("folder-repo-name");
      const btn = document.getElementById("folder-connect-current-btn");

      if (data.isGitRepo) {
        detectedCard.style.border = "1.5px solid var(--c-success)";
        if (titleEl) titleEl.innerHTML = "🌿 Git Repository Detected";
        if (nameEl) nameEl.textContent = `${folderName} — ${data.currentPath}`;
        if (btn) btn.textContent = "➕ Add This Repository Directly";
      } else {
        detectedCard.style.border = "1.5px solid var(--c-accent-border)";
        if (titleEl) titleEl.innerHTML = "📁 Local Workspace Folder";
        if (nameEl) nameEl.textContent = `${folderName} — ${data.currentPath}`;
        if (btn) btn.textContent = "➕ Add This Folder Directly";
      }
      window.setState("browsedFolderGit", { name: folderName, path: data.currentPath });
    }

    let rowsHtml = "";

    // Parent directory row
    if (data.parentPath) {
      rowsHtml += `
        <div class="folder-row folder-row-up" data-action="browseToDirectory" data-value="${escapeHtml(data.parentPath).replace(/\\/g, "\\\\")}">
          <div class="folder-row-left">
            <span class="folder-icon">📂</span>
            <span class="folder-name">.. (Go Up to Parent Directory)</span>
          </div>
          <span style="font-size:12px;color:var(--c-text-muted)">Up</span>
        </div>
      `;
    }

    if (!data.directories || data.directories.length === 0) {
      rowsHtml += `
        <div class="text-muted" style="text-align:center;padding:20px;font-size:13px">
          No subdirectories in this folder.
        </div>
      `;
    } else {
      data.directories.forEach((dir) => {
        const escapedPath = escapeHtml(dir.path).replace(/\\/g, "\\\\");
        const escapedName = escapeHtml(dir.name);

        rowsHtml += `
          <div class="folder-row" data-action="browseToDirectory" data-value="${escapedPath}">
            <div class="folder-row-left">
              <span class="folder-icon">${dir.isGitRepo ? "🌿" : "📁"}</span>
              <span class="folder-name">${escapedName}</span>
              ${dir.isGitRepo ? '<span class="badge badge-success">Git Repo</span>' : '<span class="badge badge-secondary" style="font-size:10px">Folder</span>'}
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" data-action="browseToDirectory" data-value="${escapedPath}">📂 Open</button>
              <button class="btn btn-primary btn-sm" data-action="connectSpecificFolder" data-value="${escapedName}" data-extra="${escapedPath}">➕ Add Directly</button>
            </div>
          </div>
        `;
      });
    }

    if (data.files && data.files.length > 0) {
      rowsHtml += `
        <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);padding:8px 0 4px;text-transform:uppercase;letter-spacing:.05em;border-top:1px solid var(--c-border-subtle);margin-top:8px">
          Files in this folder
        </div>
      `;
      data.files.forEach((file) => {
        const escapedName = escapeHtml(file.name);
        const sizeLabel = file.sizeBytes > 1024
          ? `${(file.sizeBytes / 1024).toFixed(1)} KB`
          : `${file.sizeBytes} B`;
        const fileIcon = getFileIcon(file.ext);
        rowsHtml += `
          <div class="folder-row" style="padding-left:4px;opacity:0.9">
            <div class="folder-row-left">
              <span class="folder-icon">${fileIcon}</span>
              <span class="folder-name">${escapedName}</span>
              <span style="font-size:10px;color:var(--c-text-muted);font-family:var(--font-mono)">${escapeHtml(file.ext)}</span>
            </div>
            <span style="font-size:11px;color:var(--c-text-muted);font-family:var(--font-mono)">${sizeLabel}</span>
          </div>
        `;
      });
    }

    if (listEl) listEl.innerHTML = rowsHtml;
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `
        <div class="text-danger" style="text-align:center;padding:20px;font-size:13px">
          ${escapeHtml(err.message || "Failed to read directory")}
        </div>
      `;
    }
  }
}

async function connectCurrentBrowsedFolder() {
  if (!window.state.currentBrowsedPath) return;
  const folderName = window.state.currentBrowsedPath.split(/[\\/]/).filter(Boolean).pop() || "Local Repo";
  await connectSpecificFolder(folderName, window.state.currentBrowsedPath);
}

async function connectSpecificFolder(name, localPath, dirHandle = null) {
  closeModal("modal-folder-browser");
  try {
    showToast(`Connecting ${name}...`, "info");
    const res = await api.connectRepository({
      name,
      localPath,
    });
    showToast(`Connected ${name} successfully!`, "success");
    if (res.repository) {
      localStorage.setItem('gda_active_repo_id', res.repository.id);
    }
    await loadRepositories();
    if (typeof window.loadDashboardStats === "function") {
      await window.loadDashboardStats();
    }
    if (res.repository) {
      if (dirHandle) {
        window._activeLocalDirHandle = dirHandle;
        if (typeof window.startLocalDirectorySync === "function") {
          window.startLocalDirectorySync(res.repository.id, dirHandle);
        }
      }
      await setActiveRepository(res.repository);
      const debugSelect = document.getElementById("debug-repo");
      if (debugSelect) debugSelect.value = res.repository.id;
      const issuesSelect = document.getElementById("issues-repo-select");
      if (issuesSelect) issuesSelect.value = res.repository.id;
      const prsSelect = document.getElementById("prs-repo-select");
      if (prsSelect) prsSelect.value = res.repository.id;
      if (typeof window.navigate === "function") {
        window.navigate("git-desktop");
      }
    }
  } catch (err) {
    showToast(`Failed to connect folder: ${err.message}`, "error");
  }
}

function sanitizePath(raw) {
  if (!raw) return "";
  let clean = String(raw).trim();
  clean = clean.replace(/^["']|["']$/g, "").trim();
  return clean;
}

function browseToEnteredPath() {
  const input = document.getElementById("folder-path-input");
  const target = sanitizePath(input?.value);
  if (!target) {
    showToast("Please enter or paste a valid folder path", "error");
    return;
  }
  browseToDirectory(target);
}

async function connectEnteredPath() {
  const input = document.getElementById("folder-path-input");
  const target = sanitizePath(input?.value);
  if (!target) {
    showToast("Please enter or paste a valid folder path", "error");
    return;
  }
  const folderName = target.split(/[\\/]/).filter(Boolean).pop() || "Local Repo";
  await connectSpecificFolder(folderName, target);
}

async function connectWorkspaceFolder() {
  closeModal("modal-folder-browser");
  showToast("Connecting current workspace (Git-Agent)...", "info");
  try {
    const res = await api.connectRepository({
      name: "Git-Agent",
      localPath: ".",
    });
    showToast("Connected Git-Agent successfully!", "success");
    if (res.repository) {
      localStorage.setItem('gda_active_repo_id', res.repository.id);
    }
    await loadRepositories();
    if (res.repository) {
      await setActiveRepository(res.repository);
      if (typeof window.navigate === "function") {
        window.navigate("git-desktop");
      }
    }
  } catch (err) {
    showToast(`Failed to connect workspace: ${err.message}`, "error");
  }
}

function openGitHubModalFromBrowser() {
  closeModal("modal-folder-browser");
  showGitHubModalFlow();
}

async function connectGitHubUrl() {
  const input = document.getElementById("github-url-input");
  const raw = sanitizePath(input?.value);
  if (!raw) {
    showToast("Please enter a valid GitHub repository URL", "error");
    return;
  }
  let url = raw;
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("git@")) {
    url = `https://github.com/${url.replace(/^\/+/, "")}`;
  }
  const name = url.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || "GitHub Repo";
  closeModal("modal-folder-browser");
  await connectSelectedGitHubRepo(name, url);
}

// ============================================================
// GITHUB INTEGRATION MODAL FLOW
// ============================================================

function showGitHubModalFlow() {
  if (window.state.gitHubConnected) {
    showGitHubReposModal();
  } else {
    showGitHubConnectModal();
  }
}

async function loadGitHubStatus() {
  try {
    const status = await api.getGitHubStatus();
    const isConnected = Boolean(status?.connected);
    window.setState("gitHubConnected", isConnected);
    window.setState("gitHubUsername", status?.username || null);

    const elements = {
      githubDesc: document.getElementById("status-github"),
      githubIcon: document.getElementById("status-github-icon"),
      githubBtn: document.getElementById("github-connect-btn"),
      statusView: document.getElementById("github-status-view"),
      connectForm: document.getElementById("github-connect-form"),
      connectedView: document.getElementById("github-connected-view"),
      usernameEl: document.getElementById("github-username"),
    };

    const githubSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`;

    const { githubDesc, githubIcon, githubBtn, statusView, connectForm, connectedView, usernameEl } = elements;

    if (isConnected) {
      if (githubDesc) githubDesc.textContent = `Connected as @${status.username}`;
      if (githubIcon) {
        githubIcon.className = "agent-phase-icon done";
        githubIcon.textContent = "✓";
      }
      if (githubBtn) {
        githubBtn.textContent = `✓ @${status.username}`;
        githubBtn.className = "btn btn-secondary btn-sm";
        githubBtn.dataset.action = "navigateToSettings";
        githubBtn.removeAttribute('onclick');
      }
      if (statusView) statusView.style.display = "none";
      if (connectForm) connectForm.style.display = "none";
      if (connectedView) {
        connectedView.style.display = "block";
        if (usernameEl) usernameEl.textContent = `@${status.username}`;
      }
    } else {
      if (githubDesc) githubDesc.textContent = "Not connected — click header to link account";
      if (githubIcon) {
        githubIcon.className = "agent-phase-icon pending";
        githubIcon.textContent = "🔗";
      }
      if (githubBtn) {
        githubBtn.innerHTML = `${githubSvg} Connect GitHub`;
        githubBtn.dataset.action = "showGitHubConnectModal";
        githubBtn.removeAttribute('onclick');
      }
      if (statusView) {
        statusView.innerHTML = `<div class="text-muted" style="font-size:13px;margin-bottom:12px">Connect your GitHub Personal Access Token to link cloud repositories, issues, and PRs.</div>`;
        statusView.style.display = "block";
      }
      if (connectForm) connectForm.style.display = "flex";
      if (connectedView) connectedView.style.display = "none";
    }
  } catch (err) {
    console.error("Error loading GitHub status:", err);
  }
}

function showGitHubConnectModal() {
  openModal("modal-github-connect");
}

async function connectGitHub() {
  const tokenInput = document.getElementById("github-token-input");
  const token = tokenInput?.value.trim();
  if (!token) {
    showToast("Please enter a personal access token", "error");
    return;
  }
  await performGitHubConnect(token);
}

async function connectGitHubFromModal() {
  const tokenInput = document.getElementById("modal-github-token");
  const token = tokenInput?.value.trim();
  if (!token) {
    showToast("Please enter a personal access token", "error");
    return;
  }
  await performGitHubConnect(token);
  closeModal("modal-github-connect");
}

async function performGitHubConnect(token) {
  try {
    showToast("Connecting to GitHub...", "info");
    const res = await api.connectGitHub(token);
    localStorage.setItem("gda_github_pat", token);
    showToast(`Connected as @${res.login || res.username || "user"}!`, "success");
    await loadGitHubStatus();
  } catch (err) {
    showToast(`GitHub connection failed: ${err.message}`, "error");
  }
}

async function disconnectGitHub() {
  try {
    await api.disconnectGitHub();
    localStorage.removeItem("gda_github_pat");
    showToast("GitHub disconnected", "info");
    await loadGitHubStatus();
  } catch (err) {
    showToast(`Failed to disconnect: ${err.message}`, "error");
  }
}

async function showGitHubReposModal() {
  if (!window.state.gitHubConnected) {
    showGitHubConnectModal();
    return;
  }

  openModal("modal-github-repos");
  const listEl = document.getElementById("github-repos-list");
  if (!listEl) return;

  listEl.innerHTML = `<div class="text-muted" style="font-size:13px;text-align:center;padding:24px"><div class="spinner"></div><div style="margin-top:8px">Fetching repositories from GitHub...</div></div>`;

  try {
    const repos = await api.listGitHubRepos();
    const cachedRepos = Array.isArray(repos) ? repos : [];
    window.setState("cachedGitHubRepos", cachedRepos);
    renderGitHubReposModalList(cachedRepos);
  } catch (err) {
    listEl.innerHTML = `<div class="text-danger" style="font-size:13px;padding:20px">Failed to load GitHub repos: ${escapeHtml(err.message)}</div>`;
  }
}

function filterGitHubRepos() {
  const search = document.getElementById("github-repo-search")?.value.toLowerCase().trim() || "";
  const filtered = window.state.cachedGitHubRepos.filter(
    (r) =>
      r.name.toLowerCase().includes(search) ||
      (r.description && r.description.toLowerCase().includes(search)),
  );
  renderGitHubReposModalList(filtered);
}

function renderGitHubReposModalList(repos) {
  const listEl = document.getElementById("github-repos-list");
  if (!listEl) return;

  if (repos.length === 0) {
    listEl.innerHTML = `<div class="text-muted" style="font-size:13px;text-align:center;padding:24px">No repositories found.</div>`;
    return;
  }

  listEl.innerHTML = repos
    .map(
      (r) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);background:var(--c-surface)">
        <div style="flex:1;padding-right:12px">
          <div style="font-weight:600;font-size:14px;color:var(--c-text)">${escapeHtml(r.name)}</div>
          <div style="font-size:12px;color:var(--c-text-muted)">${escapeHtml(r.description || "No description")}</div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="connectSelectedGitHubRepo" data-value="${escapeHtml(r.name)}" data-extra="${escapeHtml(r.cloneUrl)}">
          Connect Repo
        </button>
      </div>
    `,
    )
    .join("");
}

async function connectSelectedGitHubRepo(name, cloneUrl) {
  closeModal("modal-github-repos");
  try {
    showToast(`Connecting ${name}...`, "info");
    const res = await api.connectRepository({
      name,
      url: cloneUrl,
    });
    showToast(`Connected ${name}!`, "success");
    await loadRepositories();
    if (typeof window.loadDashboardStats === "function") {
      await window.loadDashboardStats();
    }
    if (res.repository) {
      await setActiveRepository(res.repository);
      const debugSelect = document.getElementById("debug-repo");
      if (debugSelect) debugSelect.value = res.repository.id;
      const issuesSelect = document.getElementById("issues-repo-select");
      if (issuesSelect) issuesSelect.value = res.repository.id;
      const prsSelect = document.getElementById("prs-repo-select");
      if (prsSelect) prsSelect.value = res.repository.id;
      if (typeof window.navigate === "function") {
        window.navigate("git-desktop");
      }
    }
  } catch (err) {
    showToast(`Failed to connect repository: ${err.message}`, "error");
  }
}
// ends
// Event delegation for data-action attributes
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const { action, value, extra } = target.dataset;
  const actions = {
    selectActiveRepo: () => selectActiveRepo(value),
    openRepoInGitDesktop: () => openRepoInGitDesktop(value),
    syncRepo: () => syncRepo(value),
    disconnectRepo: () => disconnectRepo(value),
    browseToDirectory: () => browseToDirectory(value),
    connectSpecificFolder: () => connectSpecificFolder(value, extra),
    connectSelectedGitHubRepo: () => connectSelectedGitHubRepo(value, extra),
    openGitHubModalFromBrowser: () => openGitHubModalFromBrowser(),
    connectGitHubUrl: () => connectGitHubUrl(),
    connectEnteredPath: () => connectEnteredPath(),
    connectWorkspaceFolder: () => connectWorkspaceFolder(),
    triggerNativeFolderPicker: () => triggerNativeFolderPicker(),
  };

  actions[action]?.();
});

// Window exports
window.loadRepositories = loadRepositories;
window.renderRepositoriesList = renderRepositoriesList;
window.setActiveRepository = setActiveRepository;
window.selectActiveRepo = selectActiveRepo;
window.openRepoInGitDesktop = openRepoInGitDesktop;
window.openActiveRepoPicker = openActiveRepoPicker;
window.populateRepoDropdowns = populateRepoDropdowns;
window.quickDebugRepo = quickDebugRepo;
window.syncRepo = syncRepo;
window.indexRepo = indexRepo;
window.disconnectRepo = disconnectRepo;
window.openFolderBrowser = openFolderBrowser;
window.browseToDirectory = browseToDirectory;
window.connectCurrentBrowsedFolder = connectCurrentBrowsedFolder;
window.connectSpecificFolder = connectSpecificFolder;
window.connectWorkspaceFolder = connectWorkspaceFolder;
window.browseToEnteredPath = browseToEnteredPath;
window.connectEnteredPath = connectEnteredPath;
window.triggerNativeFolderPicker = triggerNativeFolderPicker;
window.handleNativeFolderSelected = handleNativeFolderSelected;
window.setupFolderDropZone = setupFolderDropZone;
window.initDragAndDrop = initDragAndDrop;
window.getFileIcon = getFileIcon;
window.showGitHubModalFlow = showGitHubModalFlow;
window.loadGitHubStatus = loadGitHubStatus;
window.showGitHubConnectModal = showGitHubConnectModal;
window.connectGitHub = connectGitHub;
window.connectGitHubFromModal = connectGitHubFromModal;
window.disconnectGitHub = disconnectGitHub;
window.showGitHubReposModal = showGitHubReposModal;
window.filterGitHubRepos = filterGitHubRepos;
window.connectSelectedGitHubRepo = connectSelectedGitHubRepo;
window.openGitHubModalFromBrowser = openGitHubModalFromBrowser;
window.connectGitHubUrl = connectGitHubUrl;
