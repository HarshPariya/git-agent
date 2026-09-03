/**
 * CodeGPT Unified Enterprise Platform
 * Mode 1: Autonomous AI Coding IDE (File tree, Editor, Copilot Agent)
 * Mode 2: Normal Conversation & Enterprise GraphRAG
 */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

  // ── 1. State & Identity ───────────────────────────────────────────────────
  const getTenantId = () => {
    const key = "codegpt_tenant_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = "t-" + crypto.randomUUID().replace(/-/g, "").substring(0, 12);
      localStorage.setItem(key, id);
    }
    return id;
  };

  const tenantId = getTenantId();
  const userId = tenantId;
  const userRole = "admin";
  let authToken = localStorage.getItem("codegpt_auth_token") || "";

  let currentMode = localStorage.getItem("codegpt_app_mode") || "ide";
  let activeWorkspaceName = localStorage.getItem("codegpt_workspace_name") || "ai-chatbot";
  let activeWorkspaceId = localStorage.getItem("codegpt_active_workspace") || "ws-default-cloud";
  let ideSessionId = "ide-" + Date.now().toString(36);
  let chatSessionId = "chat-" + Date.now().toString(36);

  let activeFileHandle = null;
  let activeFilePath = "src/app.ts";
  let activeFileContent = "";
  let activeFileOriginalContent = "";
  let isFileDirty = false;

  let workspaceDirectoryHandle = null;
  const localFileHandles = new Map(); // relativePath -> FileSystemFileHandle
  const localFolderHandles = new Map(); // relativePath -> FileSystemDirectoryHandle

  let isIdeSubmitting = false;
  let isChatSubmitting = false;

  const activeDocumentIds = new Set();

  const identityHeaders = () => {
    const headers = {
      "x-tenant-id": tenantId,
      "x-user-id": userId,
      "x-user-role": userRole,
      "x-workspace-id": activeWorkspaceId,
    };
    if (authToken.trim()) headers["Authorization"] = `Bearer ${authToken.trim()}`;
    return headers;
  };

  // ── 2. DOM Elements ───────────────────────────────────────────────────────
  const btnModeIde = document.getElementById("btn-mode-ide");
  const btnModeChat = document.getElementById("btn-mode-chat");
  const viewIde = document.getElementById("view-ide");
  const viewChat = document.getElementById("view-chat");

  const btnOpenFolder = document.getElementById("btn-open-folder");
  const headerWorkspaceName = document.getElementById("header-workspace-name");
  const explorerRootLabel = document.getElementById("explorer-root-label");
  const statusWorkspacePath = document.getElementById("status-workspace-path");
  const statusActiveLang = document.getElementById("status-active-lang");
  const displayAuthUser = document.getElementById("display-auth-user");
  const healthDot = document.getElementById("health-dot");
  const toastContainer = document.getElementById("toast-container");

  // IDE Explorer Elements
  const ideFileTree = document.getElementById("ide-file-tree");
  const btnNewFile = document.getElementById("btn-new-file");
  const btnNewFolder = document.getElementById("btn-new-folder");
  const btnRefreshTree = document.getElementById("btn-refresh-tree");
  const btnCollapseTree = document.getElementById("btn-collapse-tree");

  // Editor Elements
  const editorTabsBar = document.getElementById("editor-tabs-bar");
  const editorCurrentFilename = document.getElementById("editor-current-filename");
  const editorDirtyDot = document.getElementById("editor-dirty-dot");
  const editorLineNumbers = document.getElementById("editor-line-numbers");
  const editorCodeTextarea = document.getElementById("editor-code-textarea");
  const btnEditorSave = document.getElementById("btn-editor-save");
  const btnEditorExplain = document.getElementById("btn-editor-explain");
  const btnEditorRunTest = document.getElementById("btn-editor-run-test");
  const btnEditorDeleteFile = document.getElementById("btn-editor-delete-file");
  const btnEditorCopy = document.getElementById("btn-editor-copy");
  const editorWelcomeScreen = document.getElementById("editor-welcome-screen");
  const editorActionBar = document.getElementById("editor-action-bar-wrapper");
  const editorCodeContainer = document.getElementById("editor-code-container");
  const btnWelcomeOpenFolder = document.getElementById("btn-welcome-open-folder");
  const btnWelcomeNewFile = document.getElementById("btn-welcome-new-file");
  const btnWelcomeChatMode = document.getElementById("btn-welcome-chat-mode");

  // Agent Copilot Elements
  const ideAgentMessages = document.getElementById("ide-agent-messages");
  const ideUserInput = document.getElementById("ide-user-input");
  const btnIdeSend = document.getElementById("btn-ide-send");
  const btnIdeNewChat = document.getElementById("btn-ide-new-chat");
  const agentActiveContextPill = document.getElementById("agent-active-context-pill");

  // Chat Mode Elements
  const chatModeMessages = document.getElementById("chat-mode-messages");
  const chatUserInput = document.getElementById("chat-user-input");
  const btnChatSend = document.getElementById("btn-chat-send");
  const chatFileInput = document.getElementById("chat-file-input");
  const btnChatUploadDoc = document.getElementById("btn-chat-upload-doc");
  const btnChatAttach = document.getElementById("btn-chat-attach");
  const chatUploadedDocsList = document.getElementById("chat-uploaded-docs-list");

  // ── 3. Mode Switcher ──────────────────────────────────────────────────────
  const switchMode = (mode) => {
    currentMode = mode;
    localStorage.setItem("codegpt_app_mode", mode);

    if (mode === "ide") {
      btnModeIde?.classList.add("active");
      btnModeChat?.classList.remove("active");
      viewIde?.classList.add("active-view");
      viewChat?.classList.remove("active-view");
    } else {
      btnModeChat?.classList.add("active");
      btnModeIde?.classList.remove("active");
      viewChat?.classList.add("active-view");
      viewIde?.classList.remove("active-view");
    }
  };

  btnModeIde?.addEventListener("click", () => switchMode("ide"));
  btnModeChat?.addEventListener("click", () => switchMode("chat"));
  switchMode(currentMode);

  if (displayAuthUser) displayAuthUser.textContent = `👤 ${tenantId.slice(0, 8)}…`;

  // ── 4. Toast Notifications ────────────────────────────────────────────────
  const showToast = (message, type = "info") => {
    if (!toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("toast-visible"));
    setTimeout(() => {
      toast.classList.remove("toast-visible");
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  };

  const escapeHtml = (text) => {
    if (typeof text !== "string") return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const updateActiveContextPill = (filePath) => {
    if (!agentActiveContextPill) return;
    const name = filePath ? filePath.split("/").pop() : "None";
    agentActiveContextPill.textContent = filePath ? `📄 Active: ${name}` : "📄 Active: None";
    agentActiveContextPill.title = filePath || "No active file";
  };

  // ── 5. File System & Tree Explorer ─────────────────────────────────────────
  const renderEmptyExplorerState = () => {
    if (!ideFileTree) return;
    ideFileTree.innerHTML = `
      <div class="explorer-empty-state">
        <span class="empty-state-icon">📁</span>
        <h4>No Folder Opened</h4>
        <p>Choose a local workspace folder to inspect files, edit code, and enable autonomous AI tools.</p>
        <button id="btn-explorer-open-folder" class="btn-explorer-cta">📁 Open Folder</button>
      </div>`;
    document.getElementById("btn-explorer-open-folder")?.addEventListener("click", openLocalWorkspaceFolder);
    editorWelcomeScreen?.classList.remove("is-hidden");
    editorActionBar?.classList.add("is-hidden");
    editorCodeContainer?.classList.add("is-hidden");
  };

  const openLocalWorkspaceFolder = async () => {
    try {
      if ("showDirectoryPicker" in window) {
        const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        workspaceDirectoryHandle = dirHandle;
        activeWorkspaceName = dirHandle.name;
        localStorage.setItem("codegpt_workspace_name", activeWorkspaceName);

        updateWorkspaceHeader(activeWorkspaceName, "Local Authorized");
        showToast(`Opened workspace: ${activeWorkspaceName}`, "success");
        await renderLocalDirectoryTree(dirHandle);
      } else {
        loadServerWorkspaceTree();
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        showToast(`Workspace open failed: ${err.message}`, "error");
      }
    }
  };

  const updateWorkspaceHeader = (name, modeLabel = "Local") => {
    if (headerWorkspaceName) headerWorkspaceName.textContent = `${name} (${modeLabel})`;
    if (explorerRootLabel) explorerRootLabel.textContent = name;
    if (statusWorkspacePath) statusWorkspacePath.textContent = `📁 ${name}`;
  };

  btnOpenFolder?.addEventListener("click", openLocalWorkspaceFolder);
  btnWelcomeOpenFolder?.addEventListener("click", openLocalWorkspaceFolder);
  btnWelcomeNewFile?.addEventListener("click", () => openInlineCreator("file"));
  btnWelcomeChatMode?.addEventListener("click", () => switchMode("chat"));

  const getFileIcon = (filename) => {
    if (/\.(py)$/i.test(filename)) return "🐍";
    if (/\.(ts|tsx)$/i.test(filename)) return "📘";
    if (/\.(js|jsx|mjs|cjs)$/i.test(filename)) return "🟨";
    if (/\.(json)$/i.test(filename)) return "📦";
    if (/\.(css|scss)$/i.test(filename)) return "🎨";
    if (/\.(html)$/i.test(filename)) return "🌐";
    if (/\.(md|txt)$/i.test(filename)) return "📄";
    if (/\.(sql)$/i.test(filename)) return "🗄️";
    if (/\.(sh|bat|ps1)$/i.test(filename)) return "⚡";
    if (/\.(yml|yaml|toml|env.*)$/i.test(filename)) return "⚙️";
    return "📄";
  };

  const detectLanguage = (filename) => {
    if (/\.py$/i.test(filename)) return "Python";
    if (/\.ts$/i.test(filename)) return "TypeScript";
    if (/\.tsx$/i.test(filename)) return "TypeScript React";
    if (/\.js$/i.test(filename)) return "JavaScript";
    if (/\.jsx$/i.test(filename)) return "JavaScript React";
    if (/\.json$/i.test(filename)) return "JSON";
    if (/\.css$/i.test(filename)) return "CSS";
    if (/\.html$/i.test(filename)) return "HTML";
    if (/\.md$/i.test(filename)) return "Markdown";
    if (/\.sql$/i.test(filename)) return "SQL";
    return "Plain Text";
  };

  // ── Multi-Tab & Folder State Management ────────────────────────────────────
  let openTabs = []; // Array of open file paths, e.g. ['docs/architecture.md', 'src/app.ts']
  const tabCache = new Map(); // path -> { content, originalContent, isDirty, handle }
  const expandedFolderPaths = new Set(); // Set of relative folder paths currently expanded

  const fetchAndDisplayServerFile = async (filePath) => {
    try {
      const res = await fetch(`/api/workspace-files/read?path=${encodeURIComponent(filePath)}`, {
        headers: identityHeaders(),
      });
      const data = await res.json();
      if (data && data.success && typeof data.content === "string") {
        activeFileContent = data.content;
        activeFileOriginalContent = data.content;
        setDirty(false);
        tabCache.set(filePath, { content: data.content, originalContent: data.content, isDirty: false, handle: null });
        renderEditorCode(data.content);
      } else {
        renderEditorCode("// Unable to read file content");
      }
    } catch (err) {
      renderEditorCode(`// Error reading file: ${err.message}`);
    }
  };

  // Render Directory Tree from W3C FileSystemDirectoryHandle
  const renderLocalDirectoryTree = async (dirHandle, preserveActiveFile = true) => {
    if (!ideFileTree) return;
    ideFileTree.innerHTML = "";
    localFileHandles.clear();
    localFolderHandles.clear();
    localFolderHandles.set("", dirHandle);

    const rootWrapper = document.createElement("div");

    const IGNORED_LOCAL_NAMES = new Set([
      ".git",
      "node_modules",
      "dist",
      ".cache",
      ".turbo",
      ".next",
      "package-lock.zip",
    ]);

    async function scanDirectory(handle, currentRelPath, parentDomEl) {
      const entries = [];
      for await (const [name, entry] of handle.entries()) {
        if (IGNORED_LOCAL_NAMES.has(name) || name.startsWith(".env")) continue;
        entries.push({ name, entry });
      }

      // Sort: Directories first, then files alphabetically
      entries.sort((a, b) => {
        if (a.entry.kind === b.entry.kind) return a.name.localeCompare(b.name);
        return a.entry.kind === "directory" ? -1 : 1;
      });

      for (const { name, entry } of entries) {
        const itemRelPath = currentRelPath ? `${currentRelPath}/${name}` : name;

        if (entry.kind === "directory") {
          localFolderHandles.set(itemRelPath, entry);

          // Preserve expanded folder state
          const isExpanded = expandedFolderPaths.has(itemRelPath) || (!currentRelPath && !itemRelPath.startsWith("."));
          if (isExpanded) expandedFolderPaths.add(itemRelPath);

          const folderNode = document.createElement("div");
          folderNode.className = "tree-node folder-node";
          folderNode.innerHTML = `
            <span class="chevron-icon">${isExpanded ? "▼" : "▶"}</span>
            <span class="tree-node-icon">${isExpanded ? "📂" : "📁"}</span>
            <span class="tree-item-name">${escapeHtml(name)}</span>`;

          const subContainer = document.createElement("div");
          subContainer.className = "tree-subfolder";
          subContainer.style.display = isExpanded ? "block" : "none";

          folderNode.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = subContainer.style.display !== "none";
            subContainer.style.display = isOpen ? "none" : "block";
            folderNode.querySelector(".chevron-icon").textContent = isOpen ? "▶" : "▼";
            folderNode.querySelector(".tree-node-icon").textContent = isOpen ? "📁" : "📂";
            if (isOpen) {
              expandedFolderPaths.delete(itemRelPath);
            } else {
              expandedFolderPaths.add(itemRelPath);
            }
          });

          parentDomEl.appendChild(folderNode);
          parentDomEl.appendChild(subContainer);
          await scanDirectory(entry, itemRelPath, subContainer);
        } else {
          localFileHandles.set(itemRelPath, entry);

          const fileNode = document.createElement("div");
          fileNode.className = `tree-node file-node ${activeFilePath === itemRelPath ? "active-file" : ""}`;
          fileNode.setAttribute("data-path", itemRelPath);
          fileNode.innerHTML = `
            <span class="tree-node-icon">${getFileIcon(name)}</span>
            <span class="tree-item-name">${escapeHtml(name)}</span>`;

          fileNode.addEventListener("click", (e) => {
            e.stopPropagation();
            openLocalFile(entry, itemRelPath);
          });

          parentDomEl.appendChild(fileNode);
        }
      }
    }

    await scanDirectory(dirHandle, "", rootWrapper);
    ideFileTree.appendChild(rootWrapper);

    // If preserveActiveFile is true and activeFilePath is already set, KEEP IT!
    if (preserveActiveFile && activeFilePath && localFileHandles.has(activeFilePath)) {
      const activeEl = document.querySelector(`.tree-node[data-path="${CSS.escape(activeFilePath)}"]`);
      if (activeEl) {
        document.querySelectorAll(".tree-node").forEach((n) => n.classList.remove("active-file"));
        activeEl.classList.add("active-file");
      }
      return;
    }

    // Only on initial folder opening (when no activeFilePath):
    if (!activeFilePath && localFileHandles.size > 0) {
      let initialFile = null;
      let initialPath = "";
      for (const [path, handle] of localFileHandles.entries()) {
        if (/architecture\.md$/i.test(path) || /app\.(ts|js|py)$/i.test(path) || /main\.(ts|js|py)$/i.test(path)) {
          initialFile = handle;
          initialPath = path;
          break;
        }
      }
      if (!initialFile) {
        const [firstPath, firstHandle] = localFileHandles.entries().next().value;
        initialFile = firstHandle;
        initialPath = firstPath;
      }
      if (initialFile) {
        openLocalFile(initialFile, initialPath);
      }
    }
  };

  const updateBreadcrumbs = (filePath) => {
    const container = document.getElementById("editor-breadcrumbs-container");
    if (!container) return;
    const parts = (filePath || "").split("/").filter(Boolean);
    if (parts.length === 0) {
      container.innerHTML = `<span class="bc-item active">No file selected</span>`;
      return;
    }
    const html = parts.map((part, idx) => {
      const isLast = idx === parts.length - 1;
      return isLast
        ? `<span class="bc-item active" id="editor-current-filename">${escapeHtml(part)}</span>`
        : `<span class="bc-item">${escapeHtml(part)}</span><span class="bc-sep">/</span>`;
    }).join("");
    container.innerHTML = `${html}<span class="editor-dirty-indicator ${isFileDirty ? "is-dirty" : ""}" id="editor-dirty-dot" title="Unsaved changes">●</span>`;
  };

  const openLocalFile = async (fileHandle, filePath, initialText = null) => {
    if (!filePath) return;
    activeFilePath = filePath;
    activeFileHandle = fileHandle || localFileHandles.get(filePath) || null;

    if (!openTabs.includes(filePath)) {
      openTabs.push(filePath);
    }

    editorWelcomeScreen?.classList.add("is-hidden");
    editorActionBar?.classList.remove("is-hidden");
    editorCodeContainer?.classList.remove("is-hidden");

    updateBreadcrumbs(filePath);
    if (statusActiveLang) statusActiveLang.textContent = detectLanguage(filePath);
    renderTabsBar();
    updateActiveContextPill(filePath);

    // Highlight active file in explorer tree
    document.querySelectorAll(".tree-node").forEach((n) => {
      if (n.getAttribute("data-path") === filePath) {
        n.classList.add("active-file");
      } else {
        n.classList.remove("active-file");
      }
    });

    try {
      if (typeof initialText === "string") {
        activeFileContent = initialText;
        activeFileOriginalContent = initialText;
        setDirty(false);
        tabCache.set(filePath, { content: initialText, originalContent: initialText, isDirty: false, handle: activeFileHandle });
        renderEditorCode(initialText);
      } else if (tabCache.has(filePath) && tabCache.get(filePath).content !== undefined) {
        const cached = tabCache.get(filePath);
        activeFileContent = cached.content;
        activeFileOriginalContent = cached.originalContent;
        setDirty(cached.isDirty);
        renderEditorCode(cached.content);
      } else if (typeof activeFileHandle?.getFile === "function") {
        const file = await activeFileHandle.getFile();
        const text = await file.text();
        activeFileContent = text;
        activeFileOriginalContent = text;
        setDirty(false);
        tabCache.set(filePath, { content: text, originalContent: text, isDirty: false, handle: activeFileHandle });
        renderEditorCode(text);
      } else {
        await fetchAndDisplayServerFile(filePath);
      }
    } catch (err) {
      renderEditorCode(`// Error reading file: ${err.message}`);
    }
  };

  // ── 6. Interactive Editor & Line Numbers ──────────────────────────────────
  const renderEditorCode = (content) => {
    if (!editorCodeTextarea || !editorLineNumbers) return;
    editorCodeTextarea.value = content || "";
    editorCodeTextarea.placeholder = "";
    updateLineNumbers(content || "");
  };

  const updateLineNumbers = (content) => {
    if (!editorLineNumbers) return;
    if (!activeFilePath && !content) {
      editorLineNumbers.textContent = "";
      return;
    }
    const lines = (content || "").split(/\r?\n/).length;
    let html = "";
    for (let i = 1; i <= Math.max(1, lines); i++) {
      html += `${i}\n`;
    }
    editorLineNumbers.textContent = html;
  };

  const setDirty = (dirty) => {
    isFileDirty = dirty;
    const dot = document.getElementById("editor-dirty-dot");
    if (dot) dot.classList.toggle("is-dirty", dirty);
  };

  editorCodeTextarea?.addEventListener("input", (e) => {
    activeFileContent = e.target.value;
    updateLineNumbers(activeFileContent);
    const dirty = activeFileContent !== activeFileOriginalContent;
    setDirty(dirty);
    if (activeFilePath && tabCache.has(activeFilePath)) {
      const cached = tabCache.get(activeFilePath);
      cached.content = activeFileContent;
      cached.isDirty = dirty;
      renderTabsBar();
    }
  });

  editorCodeTextarea?.addEventListener("scroll", () => {
    if (editorLineNumbers && editorCodeTextarea) {
      editorLineNumbers.scrollTop = editorCodeTextarea.scrollTop;
    }
  });

  const saveActiveFile = async () => {
    if (!activeFilePath) {
      showToast("No file open to save", "error");
      return;
    }
    const handle = localFileHandles.get(activeFilePath) || activeFileHandle;
    try {
      if (handle && typeof handle.createWritable === "function") {
        const writable = await handle.createWritable();
        await writable.write(activeFileContent);
        await writable.close();
      } else {
        const res = await fetch("/api/workspace-files/write", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...identityHeaders() },
          body: JSON.stringify({ path: activeFilePath, content: activeFileContent }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to save file");
      }

      activeFileOriginalContent = activeFileContent;
      setDirty(false);
      if (tabCache.has(activeFilePath)) {
        const cached = tabCache.get(activeFilePath);
        cached.originalContent = activeFileContent;
        cached.isDirty = false;
      }
      renderTabsBar();
      showToast(`Saved ${activeFilePath}`, "success");
    } catch (err) {
      showToast(`Save failed: ${err.message}`, "error");
    }
  };

  btnEditorSave?.addEventListener("click", saveActiveFile);

  // Keyboard shortcut Ctrl+S / Cmd+S
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActiveFile();
    }
  });

  // ── 7. New File & New Folder Operations (Inline & Modal) ────────────────
  const inlineCreator = document.getElementById("explorer-inline-creator");
  const creatorIcon = document.getElementById("creator-icon");
  const creatorInput = document.getElementById("creator-input");
  const creatorBtnOk = document.getElementById("creator-btn-ok");
  const creatorBtnCancel = document.getElementById("creator-btn-cancel");
  let creatorMode = "file";

  async function getOrCreateNestedFileHandle(rootDirHandle, filePath) {
    const parts = filePath.split("/").filter(Boolean);
    const fileName = parts.pop();
    let currentDir = rootDirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
    return currentDir.getFileHandle(fileName, { create: true });
  }

  async function getOrCreateNestedDirHandle(rootDirHandle, dirPath) {
    const parts = dirPath.split("/").filter(Boolean);
    let currentDir = rootDirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
    return currentDir;
  }

  const openInlineCreator = (mode) => {
    creatorMode = mode;
    if (!inlineCreator || !creatorInput || !creatorIcon) return;
    creatorIcon.textContent = mode === "file" ? "📄" : "📁";
    creatorInput.placeholder = mode === "file" ? "filename.py, test.ts, etc." : "folder name (e.g. components)";
    creatorInput.value = "";
    inlineCreator.classList.remove("is-hidden");
    creatorInput.focus();
  };

  const closeInlineCreator = () => {
    if (!inlineCreator || !creatorInput) return;
    inlineCreator.classList.add("is-hidden");
    creatorInput.value = "";
  };

  const confirmInlineCreator = async () => {
    const rawName = creatorInput?.value.trim();
    if (!rawName) {
      closeInlineCreator();
      return;
    }
    const cleanName = rawName.replace(/^[./\\]+/, "").replace(/\\/g, "/");

    if (creatorMode === "file") {
      try {
        if (workspaceDirectoryHandle) {
          const newHandle = await getOrCreateNestedFileHandle(workspaceDirectoryHandle, cleanName);
          showToast(`Created file: ${cleanName}`, "success");
          await renderLocalDirectoryTree(workspaceDirectoryHandle, false);
          openLocalFile(newHandle, cleanName, "");
        } else {
          const res = await fetch("/api/workspace-files/write", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...identityHeaders() },
            body: JSON.stringify({ path: cleanName, content: "" }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "Failed to create file");
          showToast(`Created file: ${cleanName}`, "success");
          await loadWorkspaceFileTree(true);
          openLocalFile(null, cleanName, "");
        }
      } catch (err) {
        showToast(`Error creating file: ${err.message}`, "error");
      }
    } else {
      try {
        if (workspaceDirectoryHandle) {
          await getOrCreateNestedDirHandle(workspaceDirectoryHandle, cleanName);
          expandedFolderPaths.add(cleanName);
          showToast(`Created directory: ${cleanName}`, "success");
          await renderLocalDirectoryTree(workspaceDirectoryHandle, true);
        } else {
          const res = await fetch("/api/workspace-files/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...identityHeaders() },
            body: JSON.stringify({ path: cleanName }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "Failed to create folder");
          expandedFolderPaths.add(cleanName);
          showToast(`Created directory: ${cleanName}`, "success");
          await loadWorkspaceFileTree(true);
        }
      } catch (err) {
        showToast(`Error creating directory: ${err.message}`, "error");
      }
    }
    closeInlineCreator();
  };

  btnNewFile?.addEventListener("click", () => openInlineCreator("file"));
  btnNewFolder?.addEventListener("click", () => openInlineCreator("folder"));

  creatorBtnOk?.addEventListener("click", confirmInlineCreator);
  creatorBtnCancel?.addEventListener("click", closeInlineCreator);

  creatorInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmInlineCreator();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeInlineCreator();
    }
  });

  btnEditorDeleteFile?.addEventListener("click", async () => {
    if (!activeFilePath) {
      showToast("No active file to delete", "info");
      return;
    }
    const confirmed = confirm(`Are you sure you want to delete '${activeFilePath}'?`);
    if (!confirmed) return;

    try {
      if (workspaceDirectoryHandle) {
        const pathParts = activeFilePath.split("/");
        const fileName = pathParts.pop();
        let parentDirHandle = workspaceDirectoryHandle;

        for (const part of pathParts) {
          parentDirHandle = await parentDirHandle.getDirectoryHandle(part);
        }

        await parentDirHandle.removeEntry(fileName);
        showToast(`Deleted ${activeFilePath}`, "info");
        closeTab(activeFilePath);
        await renderLocalDirectoryTree(workspaceDirectoryHandle, true);
      } else {
        const res = await fetch("/api/workspace-files/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...identityHeaders() },
          body: JSON.stringify({ path: activeFilePath }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to delete file");
        showToast(`Deleted ${activeFilePath}`, "info");
        closeTab(activeFilePath);
        await loadWorkspaceFileTree(true);
      }
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, "error");
    }
  });

  const renderTabsBar = () => {
    if (!editorTabsBar) return;
    if (openTabs.length === 0) {
      editorTabsBar.innerHTML = `<div class="no-tabs-placeholder">No open tabs</div>`;
      return;
    }

    editorTabsBar.innerHTML = openTabs.map((path) => {
      const filename = path.split("/").pop() || path;
      const isActive = path === activeFilePath;
      const cached = tabCache.get(path);
      const isDirty = cached?.isDirty || false;
      return `
        <div class="editor-tab ${isActive ? "active" : ""}" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}" tabindex="0" role="tab" aria-selected="${isActive}">
          <span class="tab-icon">${getFileIcon(filename)}</span>
          <span class="tab-label">${escapeHtml(filename)}</span>
          ${isDirty ? `<span class="tab-dirty-indicator" title="Unsaved changes">●</span>` : ""}
          <button class="tab-close-btn" data-close-path="${escapeHtml(path)}" title="Close Tab" aria-label="Close ${escapeHtml(filename)}">✕</button>
        </div>`;
    }).join("");

    editorTabsBar.querySelectorAll(".editor-tab").forEach((tabEl) => {
      const path = tabEl.getAttribute("data-path");
      tabEl.addEventListener("click", (e) => {
        if (e.target.closest(".tab-close-btn")) return;
        const handle = tabCache.get(path)?.handle || localFileHandles.get(path);
        openLocalFile(handle, path);
      });
    });

    editorTabsBar.querySelectorAll(".tab-close-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const closePath = btn.getAttribute("data-close-path");
        closeTab(closePath);
      });
    });
  };

  const closeTab = (path) => {
    const idx = openTabs.indexOf(path);
    if (idx === -1) return;
    openTabs.splice(idx, 1);
    tabCache.delete(path);

    if (activeFilePath === path) {
      if (openTabs.length > 0) {
        const nextPath = openTabs[Math.min(idx, openTabs.length - 1)];
        const handle = tabCache.get(nextPath)?.handle || localFileHandles.get(nextPath);
        openLocalFile(handle, nextPath);
      } else {
        activeFilePath = "";
        activeFileHandle = null;
        activeFileContent = "";
        activeFileOriginalContent = "";
        setDirty(false);
        renderEditorCode("");
        updateBreadcrumbs("");
        updateActiveContextPill("");
        editorWelcomeScreen?.classList.remove("is-hidden");
        editorActionBar?.classList.add("is-hidden");
        editorCodeContainer?.classList.add("is-hidden");
        document.querySelectorAll(".tree-node").forEach((n) => n.classList.remove("active-file"));
      }
    }
    renderTabsBar();
  };

  btnEditorCopy?.addEventListener("click", () => {
    const code = editorCodeTextarea?.value || "";
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        btnEditorCopy.textContent = "✓ Copied!";
        setTimeout(() => (btnEditorCopy.textContent = "📋 Copy"), 2000);
      });
    }
  });

  btnEditorExplain?.addEventListener("click", () => {
    const query = `Explain what is in ${activeFilePath}`;
    if (ideUserInput) ideUserInput.value = query;
    handleIdeSend(query);
  });

  btnEditorRunTest?.addEventListener("click", () => {
    const query = `Run tests`;
    handleIdeSend(query);
  });

  btnRefreshTree?.addEventListener("click", () => {
    if (workspaceDirectoryHandle) renderLocalDirectoryTree(workspaceDirectoryHandle);
    else loadWorkspaceFileTree(true);
  });

  btnCollapseTree?.addEventListener("click", () => {
    document.querySelectorAll(".tree-subfolder").forEach((sub) => (sub.style.display = "none"));
    document.querySelectorAll(".chevron-icon").forEach((c) => (c.textContent = "▶"));
    document.querySelectorAll(".folder-node .tree-node-icon").forEach((i) => (i.textContent = "📁"));
  });

  // Dynamic Workspace Tree Loader (reads full project folder from backend)
  const loadWorkspaceFileTree = async (preserveActiveFile = true) => {
    if (!ideFileTree) return;
    try {
      const res = await fetch("/api/workspace-files/tree", { headers: identityHeaders() });
      const data = await res.json();
      if (!data || !data.success || !Array.isArray(data.entries)) {
        renderEmptyExplorerState();
        return;
      }

      activeWorkspaceName = data.workspaceName || "ai-chatbot";
      updateWorkspaceHeader(activeWorkspaceName, "Local Project");

      ideFileTree.innerHTML = "";
      const rootWrapper = document.createElement("div");

      // Group into tree hierarchy
      const treeMap = new Map();
      treeMap.set("", { name: "", relativePath: "", type: "directory", children: [] });

      for (const entry of data.entries) {
        const parts = entry.relativePath.split("/");
        const parentPath = parts.slice(0, -1).join("/");
        if (!treeMap.has(entry.relativePath)) {
          treeMap.set(entry.relativePath, { ...entry, children: [] });
        }
        if (treeMap.has(parentPath)) {
          treeMap.get(parentPath).children.push(treeMap.get(entry.relativePath));
        }
      }

      function buildDom(node, parentDomEl) {
        for (const item of node.children) {
          if (item.type === "directory") {
            const isExpanded = expandedFolderPaths.has(item.relativePath) ||
              (!item.relativePath.includes("/") && !item.relativePath.startsWith("."));
            if (isExpanded) expandedFolderPaths.add(item.relativePath);

            const folderNode = document.createElement("div");
            folderNode.className = "tree-node folder-node";
            folderNode.setAttribute("data-path", item.relativePath);
            folderNode.innerHTML = `
              <span class="chevron-icon">${isExpanded ? "▼" : "▶"}</span>
              <span class="tree-node-icon">${isExpanded ? "📂" : "📁"}</span>
              <span class="tree-item-name">${escapeHtml(item.name)}</span>`;

            const subContainer = document.createElement("div");
            subContainer.className = "tree-subfolder";
            subContainer.style.display = isExpanded ? "block" : "none";

            folderNode.addEventListener("click", (e) => {
              e.stopPropagation();
              const isOpen = subContainer.style.display !== "none";
              subContainer.style.display = isOpen ? "none" : "block";
              folderNode.querySelector(".chevron-icon").textContent = isOpen ? "▶" : "▼";
              folderNode.querySelector(".tree-node-icon").textContent = isOpen ? "📁" : "📂";
              if (isOpen) {
                expandedFolderPaths.delete(item.relativePath);
              } else {
                expandedFolderPaths.add(item.relativePath);
              }
            });

            parentDomEl.appendChild(folderNode);
            parentDomEl.appendChild(subContainer);
            buildDom(item, subContainer);
          } else {
            const fileNode = document.createElement("div");
            fileNode.className = `tree-node file-node ${activeFilePath === item.relativePath ? "active-file" : ""}`;
            fileNode.setAttribute("data-path", item.relativePath);
            fileNode.innerHTML = `
              <span class="tree-node-icon">${getFileIcon(item.name)}</span>
              <span class="tree-item-name">${escapeHtml(item.name)}</span>`;

            fileNode.addEventListener("click", (e) => {
              e.stopPropagation();
              openLocalFile(null, item.relativePath);
            });

            parentDomEl.appendChild(fileNode);
          }
        }
      }

      buildDom(treeMap.get(""), rootWrapper);
      ideFileTree.appendChild(rootWrapper);

      if (preserveActiveFile && activeFilePath) {
        const activeEl = document.querySelector(`.tree-node[data-path="${CSS.escape(activeFilePath)}"]`);
        if (activeEl) {
          document.querySelectorAll(".tree-node").forEach((n) => n.classList.remove("active-file"));
          activeEl.classList.add("active-file");
        }
      }
    } catch {
      renderEmptyExplorerState();
    }
  };

  // ── 8. AI Thinking Bubble Indicator ───────────────────────────────────────
  const showThinkingIndicator = (containerEl) => {
    if (!containerEl) return () => { };
    const row = document.createElement("div");
    row.className = "chat-row bot-row thinking-row";
    row.innerHTML = `
      <div class="avatar bot-avatar thinking-avatar">🤖</div>
      <div class="chat-bubble thinking-bubble">
        <span class="thinking-text">Reasoning &amp; inspecting tools</span>
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
      </div>`;
    containerEl.appendChild(row);
    containerEl.scrollTop = containerEl.scrollHeight;
    return () => row.remove();
  };

  const autoResizeTextarea = (textarea) => {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };

  ideUserInput?.addEventListener("input", () => autoResizeTextarea(ideUserInput));
  chatUserInput?.addEventListener("input", () => autoResizeTextarea(chatUserInput));

  // ── 9. Autonomous Agent Copilot (IDE Mode) ────────────────────────────────
  const buildToolActivityHtml = (toolActivity) => {
    if (!Array.isArray(toolActivity) || toolActivity.length === 0) return "";
    const items = toolActivity.map((t) => `
      <div class="ta-item">
        <span class="ta-dot"></span>
        <code class="ta-name">${escapeHtml(t.toolName || "tool")}</code>
        <span class="ta-duration">${t.durationMs ?? 1}ms</span>
        ${t.success ? `<span class="ta-status-ok">✓ OK</span>` : `<span class="ta-status-err">✕ Failed</span>`}
      </div>`).join("");
    return `
      <details class="tool-activity-card" open>
        <summary class="ta-header">
          <span>⚡ Autonomous Tool Execution (${toolActivity.length})</span>
        </summary>
        <div class="ta-list">${items}</div>
      </details>`;
  };

  const appendIdeMessage = (role, text, meta = {}) => {
    if (!ideAgentMessages) return;
    const row = document.createElement("div");
    row.className = `chat-row ${role === "user" ? "user-row" : "bot-row"}`;

    const content = role === "user"
      ? `<p>${escapeHtml(text)}</p>`
      : `
        ${buildToolActivityHtml(meta.toolActivity)}
        <div class="bot-text">${formatMarkdown(text)}</div>`;

    row.innerHTML = `
      ${role === "assistant" ? `<div class="avatar bot-avatar">🤖</div>` : ""}
      <div class="chat-bubble">${content}</div>
      ${role === "user" ? `<div class="avatar user-avatar">👤</div>` : ""}`;

    ideAgentMessages.appendChild(row);
    ideAgentMessages.scrollTop = ideAgentMessages.scrollHeight;
  };

  const handleIdeSend = async (overridePrompt) => {
    const query = typeof overridePrompt === "string" ? overridePrompt : ideUserInput?.value.trim();
    if (!query || isIdeSubmitting) return;

    if (ideUserInput) {
      ideUserInput.value = "";
      ideUserInput.style.height = "auto";
    }

    appendIdeMessage("user", query);
    isIdeSubmitting = true;
    if (btnIdeSend) btnIdeSend.disabled = true;

    // Show AI Thinking Indicator
    const removeThinking = showThinkingIndicator(ideAgentMessages);

    // Collect full active file and workspace context
    const activeFilePayload = activeFilePath
      ? {
        path: activeFilePath,
        name: activeFilePath.split("/").pop() || activeFilePath,
        content: activeFileContent || undefined,
      }
      : undefined;

    const workspaceFilesPayload = localFileHandles.size > 0
      ? Array.from(localFileHandles.keys())
      : undefined;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...identityHeaders() },
        body: JSON.stringify({
          sessionId: ideSessionId,
          message: query,
          workspaceId: activeWorkspaceId,
          ...(activeFilePayload && { activeFile: activeFilePayload }),
          ...(workspaceFilesPayload && { workspaceFiles: workspaceFilesPayload }),
        }),
      });

      const data = await res.json();
      removeThinking();

      if (!res.ok) throw new Error(data.error?.message || `Request failed (${res.status})`);

      appendIdeMessage("assistant", data.message || "Operation completed.", {
        toolActivity: data.toolActivity || [],
        model: data.model,
      });

      // Highlight active tools
      if (Array.isArray(data.toolActivity)) {
        for (const t of data.toolActivity) {
          const pill = document.querySelector(`[data-tool="${t.toolName}"]`);
          if (pill) {
            const dot = pill.querySelector(".tool-pill-dot");
            if (dot) {
              dot.style.background = "#06b6d4";
              setTimeout(() => (dot.style.background = "#10b981"), 3000);
            }
          }
        }
      }

      // Live Editor Refresh & Workspace Sync upon File Write / Edit
      if (data.modifiedFile && typeof data.modifiedFile.content === "string") {
        const modPath = data.modifiedFile.path;
        const newContent = data.modifiedFile.content;

        activeFilePath = modPath;
        activeFileContent = newContent;
        activeFileOriginalContent = newContent;
        setDirty(false);

        if (!openTabs.includes(modPath)) {
          openTabs.push(modPath);
        }

        tabCache.set(modPath, {
          content: newContent,
          originalContent: newContent,
          isDirty: false,
          handle: localFileHandles.get(modPath) || activeFileHandle,
        });

        renderEditorCode(activeFileContent);
        updateBreadcrumbs(activeFilePath);
        renderTabsBar();
        updateActiveContextPill(activeFilePath);

        // Write back directly to local file handle if using File System Access API
        const diskHandle = localFileHandles.get(modPath) || activeFileHandle;
        if (diskHandle && typeof diskHandle.createWritable === "function") {
          try {
            const writable = await diskHandle.createWritable();
            await writable.write(activeFileContent);
            await writable.close();
          } catch {
            // Read-only handle or permission fallback
          }
        }

        // Refresh file tree if opened locally while preserving expanded folders and active file
        if (workspaceDirectoryHandle) {
          await renderLocalDirectoryTree(workspaceDirectoryHandle, true);
        }
      } else if (Array.isArray(data.toolActivity) && data.toolActivity.some((t) => t.toolName === "write_file" || t.toolName === "edit_file" || t.toolName === "delete_file")) {
        if (workspaceDirectoryHandle) {
          await renderLocalDirectoryTree(workspaceDirectoryHandle, true);
        }
        if (activeFilePath && localFileHandles.has(activeFilePath)) {
          const handle = localFileHandles.get(activeFilePath);
          if (handle) openLocalFile(handle, activeFilePath);
        }
      }
    } catch (err) {
      removeThinking();
      appendIdeMessage("assistant", `❌ **Error**: ${err.message}`);
      showToast(err.message, "error");
    } finally {
      isIdeSubmitting = false;
      if (btnIdeSend) btnIdeSend.disabled = false;
    }
  };

  btnIdeSend?.addEventListener("click", () => handleIdeSend());
  ideUserInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleIdeSend();
    }
  });

  btnIdeNewChat?.addEventListener("click", () => {
    ideSessionId = "ide-" + Date.now().toString(36);
    if (ideAgentMessages) ideAgentMessages.innerHTML = "";
    showToast("Started fresh IDE Agent session", "info");
  });

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".agent-chip");
    if (chip) {
      const q = chip.getAttribute("data-query");
      if (q) handleIdeSend(q);
    }
  });

  // ── 10. Chat & GraphRAG Mode (Normal Conversation) ────────────────────────
  const formatMarkdown = (text) => {
    if (!text) return "";
    let clean = text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<\/?(?:function|parameter|tools|tool_call)\b[^>]*>/gi, "")
      .trim();

    let html = escapeHtml(clean);
    html = html.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)\r?\n```/g, (_m, lang, code) => {
      return `<div class="code-wrapper"><div class="code-header"><span>${lang || "CODE"}</span><button class="btn-copy-code" onclick="navigator.clipboard.writeText(this.closest('.code-wrapper').querySelector('code').innerText)">Copy</button></div><pre><code>${code}</code></pre></div>`;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, `<code class="inline-code">$1</code>`);
    html = html.replace(/\n/g, "<br>");
    return html;
  };

  const buildSourcesHtml = (sources) => {
    if (!Array.isArray(sources) || sources.length === 0) return "";
    const chips = sources.slice(0, 4).map((s) => `<span class="source-chip">📄 ${escapeHtml(String(s.source || "").split(/[/\\\\]/).pop())}</span>`).join("");
    return `<div class="sources-row"><span class="sources-label">Sources</span>${chips}</div>`;
  };

  const appendChatMessage = (role, text, meta = {}) => {
    if (!chatModeMessages) return;
    const row = document.createElement("div");
    row.className = `chat-row ${role === "user" ? "user-row" : "bot-row"}`;

    const content = role === "user"
      ? `<p>${escapeHtml(text)}</p>`
      : `
        <div class="bot-text">${formatMarkdown(text)}</div>
        ${buildSourcesHtml(meta.sources)}`;

    row.innerHTML = `
      ${role === "assistant" ? `<div class="avatar bot-avatar">🤖</div>` : ""}
      <div class="chat-bubble">${content}</div>
      ${role === "user" ? `<div class="avatar user-avatar">👤</div>` : ""}`;

    chatModeMessages.appendChild(row);
    chatModeMessages.scrollTop = chatModeMessages.scrollHeight;
  };

  const handleChatSend = async (overrideText) => {
    const query = typeof overrideText === "string" ? overrideText : chatUserInput?.value.trim();
    if (!query || isChatSubmitting) return;

    if (chatUserInput) {
      chatUserInput.value = "";
      chatUserInput.style.height = "auto";
    }

    appendChatMessage("user", query);
    isChatSubmitting = true;
    if (btnChatSend) btnChatSend.disabled = true;

    // Show AI Thinking Indicator
    const removeThinking = showThinkingIndicator(chatModeMessages);

    try {
      const docIds = [...activeDocumentIds];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...identityHeaders() },
        body: JSON.stringify({
          sessionId: chatSessionId,
          message: query,
          ...(docIds.length > 0 && { documentIds: docIds }),
        }),
      });

      const data = await res.json();
      removeThinking();

      if (!res.ok) throw new Error(data.error?.message || `Request failed (${res.status})`);

      appendChatMessage("assistant", data.message || "Completed.", {
        sources: data.sources || [],
      });
    } catch (err) {
      removeThinking();
      appendChatMessage("assistant", `❌ **Error**: ${err.message}`);
      showToast(err.message, "error");
    } finally {
      isChatSubmitting = false;
      if (btnChatSend) btnChatSend.disabled = false;
    }
  };

  btnChatSend?.addEventListener("click", () => handleChatSend());
  chatUserInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });

  document.addEventListener("click", (e) => {
    const promptCard = e.target.closest("[data-prompt]");
    if (promptCard) {
      const p = promptCard.getAttribute("data-prompt");
      if (p) handleChatSend(p);
    }
  });

  // ── 11. Document Ingestion (Chat Mode) ────────────────────────────────────
  const uploadDocFile = async (file) => {
    if (!file) return;
    const filename = file.name;
    const mimeType = file.type || "application/octet-stream";

    appendChatMessage("assistant", `⏳ **Indexing Document**: \`${escapeHtml(filename)}\` (${(file.size / 1024).toFixed(1)} KB)…`);

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/documents/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: { "Content-Type": mimeType, ...identityHeaders() },
        body: buffer,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Upload failed");

      appendChatMessage("assistant", `✅ **Document Successfully Indexed!**\n- **File**: \`${data.document?.filename}\`\n- **Storage**: PostgreSQL / pgvector\n- **Chunks**: \`${data.document?.chunks}\``);
      loadDocuments();
      showToast(`${filename} indexed successfully`, "success");
    } catch (err) {
      appendChatMessage("assistant", `❌ **Upload Error**: ${err.message}`);
      showToast(err.message, "error");
    } finally {
      if (chatFileInput) chatFileInput.value = "";
    }
  };

  const triggerChatUpload = () => chatFileInput?.click();
  btnChatUploadDoc?.addEventListener("click", triggerChatUpload);
  btnChatAttach?.addEventListener("click", triggerChatUpload);
  chatFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) uploadDocFile(file);
  });

  const loadDocuments = async () => {
    if (!chatUploadedDocsList) return;
    try {
      const res = await fetch("/api/documents", { headers: identityHeaders() });
      const data = await res.json();
      const docs = data.documents || [];
      activeDocumentIds.clear();

      if (docs.length === 0) {
        chatUploadedDocsList.innerHTML = `<div class="docs-empty-state"><span>No documents indexed yet.</span></div>`;
        return;
      }

      docs.forEach((d) => activeDocumentIds.add(d.id));
      chatUploadedDocsList.innerHTML = docs.map((d) => `
        <div class="doc-item">
          <span class="doc-name" title="${escapeHtml(d.filename)}">📄 ${escapeHtml(d.filename)}</span>
          <button class="btn-delete-doc" data-id="${escapeHtml(d.id)}" title="Delete">✕</button>
        </div>`).join("");

      chatUploadedDocsList.querySelectorAll(".btn-delete-doc").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.currentTarget.getAttribute("data-id");
          if (!id) return;
          try {
            await fetch(`/api/documents/${id}`, { method: "DELETE", headers: identityHeaders() });
            loadDocuments();
            showToast("Document removed from vector store", "info");
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });
    } catch { }
  };

  // ── 12. Server Health Check ───────────────────────────────────────────────
  const checkHealth = async () => {
    try {
      const res = await fetch("/health");
      const data = await res.json();
      if (res.ok && healthDot) healthDot.className = "pulse-indicator";
    } catch {
      if (healthDot) healthDot.className = "pulse-indicator offline";
    }
  };

  // ── Boot ──────────────────────────────────────────────────────────────────
  updateWorkspaceHeader("No Workspace Opened", "Standby");
  updateActiveContextPill("");
  renderEmptyExplorerState();
  loadDocuments();
  checkHealth();
  setInterval(checkHealth, 10000);
});
