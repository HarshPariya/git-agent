/**
 * Git Debugging Agent — Repositories & Connections View Module
 * Repository listings, active repo state, interactive folder browser, and GitHub integration
 */

async function loadRepositories() {
  try {
    const data = await api.listRepositories();
    const repos = Array.isArray(data) ? data : data.repositories || [];
    window.state.repositories = repos;

    // Restore user's explicitly selected repo from localStorage or auto-activate first
    const savedRepoId = localStorage.getItem('gda_active_repo_id');
    if (savedRepoId) {
      const match = repos.find((r) => r.id === savedRepoId);
      if (match) await setActiveRepository(match);
      else if (repos.length > 0) await setActiveRepository(repos[0]);
      else await setActiveRepository(null);
    } else if (window.state.activeRepository) {
      const match = repos.find((r) => r.id === window.state.activeRepository.id);
      if (match) await setActiveRepository(match);
      else if (repos.length > 0) await setActiveRepository(repos[0]);
      else await setActiveRepository(null);
    } else if (repos.length > 0) {
      await setActiveRepository(repos[0]);
    } else {
      await setActiveRepository(null);
    }

    renderRepositoriesList();
    populateRepoDropdowns();
  } catch (err) {
    showToast(`Failed to load repositories: ${err.message}`, "error");
  }
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
          <button class="btn btn-primary btn-sm" onclick="openFolderBrowser()">📁 Add Local Folder</button>
          <button class="btn btn-github btn-sm" onclick="showGitHubModalFlow()">🐙 Connect GitHub</button>
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-weight:700;font-size:15px;display:flex;align-items:center;gap:6px">
            ${escapeHtml(r.name)}
            ${isActive ? '<span class="badge badge-accent">active</span>' : ""}
          </div>
          <span class="badge badge-success">connected</span>
        </div>
        <div style="font-size:12px;color:var(--c-text-muted);margin-bottom:8px;word-break:break-all;font-family:var(--font-mono)">
          ${escapeHtml(r.localPath || r.url || "")}
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--c-text-secondary);margin-bottom:14px">
          <span>🌿 branch:</span>
          <code>${escapeHtml(r.currentBranch || r.defaultBranch || r.branch || "main")}</code>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--c-border);padding-top:12px">
        ${isActive
            ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.85">✓ Active</button>`
            : `<button class="btn btn-secondary btn-sm" onclick="selectActiveRepo('${escapeHtml(r.id)}')">Set Active</button>`
          }
        <button class="btn btn-secondary btn-sm" onclick="openRepoInGitDesktop('${escapeHtml(r.id)}')">🖥️ Git Desktop</button>
        <button class="btn btn-primary btn-sm" onclick="quickDebugRepo('${escapeHtml(r.id)}')">⚡ Debug</button>
        <button class="btn btn-secondary btn-sm" onclick="syncRepo('${escapeHtml(r.id)}')">🔄 Sync</button>
        <button class="btn btn-danger btn-sm" onclick="disconnectRepo('${escapeHtml(r.id)}')">Disconnect</button>
      </div>
    </div>
  `;
      }
    )
    .join("");
}

async function setActiveRepository(repo) {
  window.state.activeRepository = repo;
  if (repo) {
    localStorage.setItem('gda_active_repo_id', repo.id);
  } else {
    localStorage.removeItem('gda_active_repo_id');
  }

  const label = document.getElementById('header-active-repo-name');
  if (label) {
    label.textContent = repo ? (repo.name || "Local Repo") : 'Select Local Repository';
  }

  const badge = document.getElementById('header-active-repo');
  if (badge) {
    const dot = badge.querySelector('.active-repo-dot');
    if (repo) {
      badge.style.opacity = '1';
      if (dot) dot.style.background = 'var(--c-success)';
    } else {
      badge.style.opacity = '0.85';
      if (dot) dot.style.background = 'var(--c-text-muted)';
    }
  }

  populateRepoDropdowns();

  // Automatically fetch live branch and status across all views
  if (repo) {
    try {
      const status = await api.getGitStatus(repo.id);
      if (status) {
        window.state.gitDesktop.gitStatus = status;
        const branchName = status.branch || repo.currentBranch || repo.defaultBranch || 'main';
        if (label) {
          label.textContent = `${repo.name} · ${branchName}`;
        }
        const gdBranch = document.getElementById('gd-branch-name');
        if (gdBranch) gdBranch.textContent = branchName;
        const gdRepo = document.getElementById('gd-repo-name');
        if (gdRepo) gdRepo.textContent = repo.name || repo.path;
        const statBranch = document.getElementById('stat-branch');
        if (statBranch) statBranch.textContent = branchName;
        const statChanges = document.getElementById('stat-changes');
        if (statChanges) statChanges.textContent = `${status.entries ? status.entries.length : 0} files`;

        // Populate changed files for Git Desktop automatically
        if (status.entries && Array.isArray(status.entries)) {
          window.state.gitDesktop.changedFiles = status.entries.map((entry) => {
            let code = "M";
            if (entry.status === "added") code = "A";
            else if (entry.status === "deleted") code = "D";
            else if (entry.status === "renamed") code = "R";
            else if (entry.status === "untracked") code = "?";

            return {
              filePath: entry.filePath,
              status: entry.status,
              code,
              staged: entry.staged,
              additions: entry.status === "added" ? 1 : 0,
              deletions: 0,
              risk: entry.filePath.includes("auth") || entry.filePath.includes("key") || entry.filePath.includes(".env") ? "high" : "low",
              logicalGroup: null,
            };
          });

          const countEl = document.getElementById("gd-changes-count");
          if (countEl) countEl.textContent = `${window.state.gitDesktop.changedFiles.length} files`;
          if (typeof window.renderGitDesktopChanges === "function") {
            window.renderGitDesktopChanges();
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch git status for active repo:", e);
    }
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
  try {
    window.state.repositories = (window.state.repositories || []).filter((r) => r.id !== repoId);
    if (window.state.activeRepository && window.state.activeRepository.id === repoId) {
      setActiveRepository(window.state.repositories.length > 0 ? window.state.repositories[0] : null);
    }
    renderRepositoriesList();
    if (typeof window.renderDashboardRepos === "function") {
      window.renderDashboardRepos(window.state.repositories);
    }
    populateRepoDropdowns();

    await api.disconnectRepository(repoId);
    showToast("Repository disconnected successfully", "info");

    await loadRepositories();
    if (typeof window.loadDashboardStats === "function") {
      await window.loadDashboardStats();
    }
  } catch (err) {
    showToast(`Failed to disconnect: ${err.message}`, "error");
    await loadRepositories();
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

    openFolderBrowser();
    const pathInput = document.getElementById("folder-path-input");
    if (pathInput) {
      pathInput.value = folderName;
      pathInput.focus();
    }
    showToast(`Folder "${folderName}" detected. Please confirm the path and click Connect.`, "info");
  });
}

async function triggerNativeFolderPicker() {
  const btn = document.getElementById("btn-open-os-dialog") || document.getElementById("open-os-dialog-btn");
  const origHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Opening OS Dialog...`;
  }
  showToast("Opening system folder dialog...", "info");

  try {
    const res = await api.pickNativeFolderDialog();
    if (res && res.path && !res.cancelled) {
      showToast(`Selected: ${res.path}`, "success");
      await connectSpecificFolder(res.folderName || "Repository", res.path);
      return;
    } else if (res && res.cancelled) {
      showToast("Folder selection cancelled", "info");
      return;
    }
  } catch (err) {
    console.warn("Backend OS native dialog error, trying browser picker:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }

  if (typeof window.showDirectoryPicker === "function") {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: "read" });
      if (dirHandle && dirHandle.name) {
        showToast(`Locating folder "${dirHandle.name}" on your system...`, "info");
        const res = await api.resolveFolder(dirHandle.name, [], window.state.currentBrowsedPath);
        if (res && res.resolvedPath && res.exists) {
          showToast(`Found: ${res.resolvedPath}`, "success");
          await connectSpecificFolder(res.folderName || dirHandle.name, res.resolvedPath);
          return;
        } else {
          openFolderBrowser();
          const pathInput = document.getElementById("folder-path-input");
          if (pathInput) {
            pathInput.value = dirHandle.name;
            pathInput.focus();
          }
          showToast(`Folder "${dirHandle.name}" selected. Please confirm full path and click Connect.`, "info");
          return;
        }
      }
    } catch (fsErr) {
      if (fsErr.name === "AbortError") {
        showToast("Folder selection cancelled", "info");
        return;
      }
      console.warn("Browser showDirectoryPicker fallback error:", fsErr);
    }
  }

  const input = document.getElementById("native-folder-input");
  if (input) {
    input.value = "";
    input.click();
  }
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
        const res = await api.resolveFolder(entry.name, [], window.state.currentBrowsedPath);
        if (res && res.resolvedPath && res.exists) {
          await connectSpecificFolder(res.folderName || entry.name, res.resolvedPath);
        } else {
          triggerNativeFolderPicker();
        }
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

  showToast(`Locating folder "${rootFolderName}" on your computer...`, "info");

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

  openFolderBrowser();
  const pathInput = document.getElementById("folder-path-input");
  if (pathInput) {
    pathInput.value = rootFolderName;
    pathInput.focus();
  }
  showToast(`Folder "${rootFolderName}" detected. Verify or paste the full path and click Connect.`, "info");
}

function openFolderBrowser(targetPath = "") {
  openModal("modal-folder-browser");
  browseToDirectory(targetPath || "");
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
    window.state.currentBrowsedPath = data.currentPath;

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
          <div class="folder-shortcut-pill ${isCurrent ? "active-shortcut" : ""}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600" onclick="browseToDirectory('${escapeHtml(s.path).replace(/\\/g, "\\\\")}')">
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
      window.state.browsedFolderGit = { name: folderName, path: data.currentPath };
    }

    let rowsHtml = "";

    // Parent directory row
    if (data.parentPath) {
      rowsHtml += `
        <div class="folder-row folder-row-up" onclick="browseToDirectory('${escapeHtml(data.parentPath).replace(/\\/g, "\\\\")}')">
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
          <div class="folder-row" onclick="browseToDirectory('${escapedPath}')">
            <div class="folder-row-left">
              <span class="folder-icon">${dir.isGitRepo ? "🌿" : "📁"}</span>
              <span class="folder-name">${escapedName}</span>
              ${dir.isGitRepo ? '<span class="badge badge-success">Git Repo</span>' : '<span class="badge badge-secondary" style="font-size:10px">Folder</span>'}
            </div>
            <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
              <button class="btn btn-secondary btn-sm" onclick="browseToDirectory('${escapedPath}')">📂 Open</button>
              <button class="btn btn-primary btn-sm" onclick="connectSpecificFolder('${escapedName}', '${escapedPath}')">➕ Add Directly</button>
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

async function connectSpecificFolder(name, localPath) {
  closeModal("modal-folder-browser");
  try {
    showToast(`Connecting ${name}...`, "info");
    const res = await api.connectRepository({
      name,
      localPath,
    });
    showToast(`Connected ${name} successfully!`, "success");
    await loadRepositories();
    if (typeof window.loadDashboardStats === "function") {
      await window.loadDashboardStats();
    }
    if (res.repository) {
      setActiveRepository(res.repository);
      const debugSelect = document.getElementById("debug-repo");
      if (debugSelect) debugSelect.value = res.repository.id;
      const issuesSelect = document.getElementById("issues-repo-select");
      if (issuesSelect) issuesSelect.value = res.repository.id;
      const prsSelect = document.getElementById("prs-repo-select");
      if (prsSelect) prsSelect.value = res.repository.id;
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
    window.state.gitHubConnected = Boolean(status && status.connected);
    window.state.gitHubUsername = status?.username || null;

    const githubDesc = document.getElementById("status-github");
    const githubIcon = document.getElementById("status-github-icon");
    const githubBtn = document.getElementById("github-connect-btn");
    const statusView = document.getElementById("github-status-view");
    const connectForm = document.getElementById("github-connect-form");
    const connectedView = document.getElementById("github-connected-view");
    const usernameEl = document.getElementById("github-username");

    if (window.state.gitHubConnected) {
      if (githubDesc) githubDesc.textContent = `Connected as @${status.username}`;
      if (githubIcon) {
        githubIcon.className = "agent-phase-icon done";
        githubIcon.textContent = "✓";
      }
      if (githubBtn) {
        githubBtn.innerHTML = `✓ @${status.username}`;
        githubBtn.className = "btn btn-secondary btn-sm";
        githubBtn.onclick = () => navigate("settings");
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
        githubBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
          Connect GitHub
        `;
        githubBtn.onclick = showGitHubConnectModal;
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
    showToast(`Connected as @${res.username}!`, "success");
    await loadGitHubStatus();
  } catch (err) {
    showToast(`GitHub connection failed: ${err.message}`, "error");
  }
}

async function disconnectGitHub() {
  try {
    await api.disconnectGitHub();
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
    window.state.cachedGitHubRepos = Array.isArray(repos) ? repos : [];
    renderGitHubReposModalList(window.state.cachedGitHubRepos);
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
        <button class="btn btn-primary btn-sm" onclick="connectSelectedGitHubRepo('${escapeHtml(r.name)}', '${escapeHtml(r.cloneUrl)}')">
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
      setActiveRepository(res.repository);
    }
  } catch (err) {
    showToast(`Failed to connect repository: ${err.message}`, "error");
  }
}

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
