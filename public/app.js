document.addEventListener("DOMContentLoaded", () => {
  const chatContainer = document.getElementById("chat-messages-container");
  const userInput = document.getElementById("user-input");
  const btnSend = document.getElementById("btn-send");
  const btnNewChat = document.getElementById("btn-new-chat");
  const btnClearHistory = document.getElementById("btn-clear-history");
  const healthText = document.getElementById("sidebar-health-text");
  const retrievalStatus = document.getElementById("retrieval-module-status");
  const agentStatus = document.getElementById("agent-module-status");
  const activeRouteLabel = document.getElementById("active-route-label");

  let chatHistory = [];
  const activeDocumentIds = new Set();
  const tenantId = "tenant-1";
  const userId = `user-${tenantId}`;
  const userRole = "admin";
  let sessionId = "session-prod-1";
  let isSubmitting = false;

  const identityHeaders = () => ({
    "x-tenant-id": tenantId,
    "x-user-id": userId,
    "x-user-role": userRole,
  });

  // Health Polling
  async function checkHealth() {
    try {
      const res = await fetch("/health");
      const data = await res.json();
      if (!res.ok) throw new Error(`Health check failed (${res.status})`);
      for (const [element, status] of [
        [retrievalStatus, data.modules?.retrieval],
        [agentStatus, data.modules?.agent],
      ]) {
        if (!element) continue;
        element.textContent = status || "Ready";
        element.classList.remove("offline");
      }
      if (healthText) {
        healthText.textContent = `Online • ${data.status.toUpperCase()} (${data.database.poolIdleConnections ?? 0} idle pool)`;
      }
    } catch {
      for (const status of [retrievalStatus, agentStatus]) {
        if (!status) continue;
        status.textContent = "Offline";
        status.classList.add("offline");
      }
      if (healthText) healthText.textContent = "Offline • Reconnecting...";
    }
  }

  // Format Markdown with Copy Code Buttons
  function formatMarkdown(text) {
    if (!text) return "";
    const cleanText = text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<function=[\w]+>[\s\S]*?<\/function>/gi, "")
      .replace(/<parameter=[\w]+>[\s\S]*?<\/parameter>/gi, "")
      .replace(/<\/?(?:function|parameter|tools|tool_call)\b[^>]*>/gi, "")
      .trim();
    let html = escapeHtml(cleanText);
    const codeBlocks = [];

    // Format ```code blocks with Copy button and Language Badges
    html = html.replace(
      /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)\r?\n```/g,
      (_match, rawLang, code) => {
        const lang = (rawLang || "code").toLowerCase();
        const displayLang =
          lang === "ts" || lang === "typescript" ? "TypeScript" :
          lang === "js" || lang === "javascript" ? "JavaScript" :
          lang === "py" || lang === "python" ? "Python" :
          lang === "sql" ? "SQL" :
          lang === "json" ? "JSON" :
          lang === "bash" || lang === "sh" || lang === "shell" ? "Bash" :
          lang === "html" ? "HTML" :
          lang === "css" ? "CSS" :
          lang === "md" || lang === "markdown" ? "Markdown" :
          (rawLang ? rawLang.toUpperCase() : "CODE");

        const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
        codeBlocks.push(`
        <div class="code-wrapper">
          <div class="code-header">
            <span class="code-lang-badge"><span class="lang-icon">💻</span> ${displayLang}</span>
            <button class="btn-copy" onclick="copyCode(this)">📋 Copy</button>
          </div>
          <pre><code>${code}</code></pre>
        </div>
      `);
        return token;
      },
    );

    // Format `code` inline
    html = html.replace(
      /`([^`]+)`/g,
      '<code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em;">$1</code>',
    );
    // Format **bold**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Format ### Headings
    html = html.replace(
      /^### (.*$)/gim,
      '<h3 style="margin: 10px 0 6px 0; font-family: var(--font-display); font-size: 1.1em; color: var(--accent-cyan);">$1</h3>',
    );
    // Format #### Headings
    html = html.replace(
      /^#### (.*$)/gim,
      '<h4 style="margin: 8px 0 4px 0; font-family: var(--font-display); font-size: 0.95em; color: var(--text-main);">$1</h4>',
    );

    // Render standard Markdown tables instead of exposing pipe syntax.
    const tableBlocks = [];
    html = html.replace(
      /(^\|.+\|\r?\n^\|(?:\s*:?-+:?\s*\|)+\r?\n(?:^\|.+\|(?:\r?\n|$))+)/gm,
      (tableText) => {
        const rows = tableText.trim().split(/\r?\n/);
        const parseCells = (row) => row.slice(1, -1).split("|").map((cell) => cell.trim());
        const headers = parseCells(rows[0]);
        const bodyRows = rows.slice(2).map(parseCells);
        const table = `<div class="markdown-table-wrapper"><table class="markdown-table"><thead><tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${bodyRows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
        const token = `@@TABLE_BLOCK_${tableBlocks.length}@@`;
        tableBlocks.push(table);
        return token;
      },
    );
    // Format newlines
    html = html.replace(/\n/g, "<br>");

    for (const [index, block] of codeBlocks.entries()) {
      html = html.replace(`@@CODE_BLOCK_${index}@@`, block);
    }
    for (const [index, table] of tableBlocks.entries()) {
      html = html.replace(`@@TABLE_BLOCK_${index}@@`, table);
    }

    return html;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.copyCode = function (btn) {
    const code = btn.closest(".code-wrapper").querySelector("code").innerText;
    navigator.clipboard.writeText(code);
    btn.textContent = "✓ Copied!";
    setTimeout(() => (btn.textContent = "📋 Copy"), 2000);
  };

  function appendRow(role, content) {
    if (!chatContainer) return;

    // Remove welcome card on first message
    const welcomeCard = chatContainer.querySelector(".welcome-card");
    if (welcomeCard) welcomeCard.remove();

    const row = document.createElement("div");
    row.className = `chat-row ${role === "user" ? "user-row" : "bot-row"}`;

    const formatted = role === "user" ? escapeHtml(content) : formatMarkdown(content);

    row.innerHTML = `
      ${role === "assistant" ? '<div class="avatar">🤖</div>' : ""}
      <div class="chat-bubble">${formatted}</div>
      ${role === "user" ? '<div class="avatar">👤</div>' : ""}
    `;

    chatContainer.appendChild(row);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  async function handleSend(text) {
    const query = text || userInput?.value.trim();
    if (!query || isSubmitting) return;

    if (userInput) {
      userInput.value = "";
      userInput.style.height = "auto";
    }

    appendRow("user", query);
    chatHistory.push({ role: "user", content: query });
    isSubmitting = true;
    if (btnSend) btnSend.disabled = true;

    // Bot Typing Indicator
    const typingId = `typing-${Date.now()}`;
    const typingRow = document.createElement("div");
    typingRow.id = typingId;
    typingRow.className = "chat-row bot-row";
    typingRow.innerHTML = `
      <div class="avatar">🤖</div>
      <div class="chat-bubble" style="color: var(--text-muted);">
        <span>Searching vector embeddings & AST knowledge graph...</span> ⏳
      </div>
    `;
    chatContainer.appendChild(typingRow);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
      const docIdsArray = Array.from(activeDocumentIds);
      console.log("[UI] selectedDocumentIds=", docIdsArray);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...identityHeaders(),
        },
        body: JSON.stringify({
          sessionId,
          message: query,
          ...(docIdsArray.length > 0 && { documentIds: docIdsArray }),
        }),
      });

      const data = await res.json();
      document.getElementById(typingId)?.remove();

      if (!res.ok) {
        throw new Error(data.error?.message || `Request failed (${res.status})`);
      }

      const botText = data.message || "Hello! How can I assist you with your codebase today?";
      if (activeRouteLabel && data.pipeline?.retrievalMode) {
        activeRouteLabel.textContent = `Member 1: ${data.pipeline.retrievalMode} → Member 2: agent`;
        activeRouteLabel.title = data.pipeline.routeReason || "Automatically routed";
      }
      const uniqueSources = new Map();
      if (Array.isArray(data.sources)) {
        for (const source of data.sources) {
          const rawPath = String(source.source || "").replace(/\\/g, "/");
          const repositoryPath = rawPath.match(/(?:^|\/)(src|public|tests|docs)\/.*$/i)?.[0]?.replace(/^\//, "") || rawPath;
          const label = `${repositoryPath}${source.page ? ` (p. ${source.page})` : ""}`;
          if (label && !uniqueSources.has(label)) uniqueSources.set(label, label);
        }
      }
      const visibleSources = [...uniqueSources.values()].slice(0, 5);
      const hiddenSourceCount = uniqueSources.size - visibleSources.length;
      const sourceText = visibleSources.length > 0
        ? `\n\n**Sources:** ${visibleSources.join(", ")}${hiddenSourceCount > 0 ? `, +${hiddenSourceCount} more` : ""}`
        : "";
      appendRow("assistant", `${botText}${sourceText}`);
      chatHistory.push({ role: "assistant", content: botText });
    } catch (err) {
      document.getElementById(typingId)?.remove();
      appendRow("assistant", `❌ **Error**: ${err.message}`);
    } finally {
      isSubmitting = false;
      if (btnSend) btnSend.disabled = false;
      userInput?.focus();
    }
  }

  // Event Listeners
  if (btnSend && userInput) {
    btnSend.addEventListener("click", () => handleSend());
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    userInput.addEventListener("input", () => {
      userInput.style.height = "auto";
      userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
    });
  }

  // Handle Prompt Cards & Shortcut Buttons
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".prompt-card");
    if (card) {
      const prompt = card.getAttribute("data-prompt");
      if (prompt) handleSend(prompt);
    }

    const shortcut = e.target.closest(".shortcut-btn");
    if (shortcut) {
      const query = shortcut.getAttribute("data-query");
      if (query) handleSend(query);
    }
  });

  // Clear Chat History
  if (btnClearHistory || btnNewChat) {
    const clearFn = () => {
      chatHistory = [];
      chatContainer.innerHTML = `
        <div class="welcome-card glass-panel">
          <div class="welcome-icon">⚡</div>
          <h2>GraphRAG AI Code Assistant</h2>
          <p>Ask questions about your codebase, debug functions, or analyze impact paths in real-time.</p>
          <div class="prompt-grid">
            <button class="prompt-card" data-prompt="How does graph traversal work?">
              <span class="title">🔍 Graph Traversal</span>
              <span class="desc">How does BFS graph search find caller entities?</span>
            </button>
            <button class="prompt-card" data-prompt="/impact traverseGraph">
              <span class="title">⚡ Impact Analysis</span>
              <span class="desc">What breaks if I modify traverseGraph()?</span>
            </button>
            <button class="prompt-card" data-prompt="Where is normalizeId used?">
              <span class="title">🔎 Function Lookup</span>
              <span class="desc">Find exact occurrences and references to normalizeId.</span>
            </button>
            <button class="prompt-card" data-prompt="/metrics">
              <span class="title">📊 SLA & Metrics</span>
              <span class="desc">Show P50/P95 latency, pool stats, and cache hit rates.</span>
            </button>
          </div>
        </div>
      `;
    };

    if (btnClearHistory) btnClearHistory.addEventListener("click", clearFn);
    if (btnNewChat) {
      btnNewChat.addEventListener("click", () => {
        sessionId = `session-${Math.random().toString(36).substring(2, 9)}`;
        clearFn();
      });
    }
  }

  // Document Upload Elements
  const btnUploadDoc = document.getElementById("btn-upload-doc");
  const btnAttach = document.getElementById("btn-attach");
  const fileInput = document.getElementById("file-input");
  const uploadedDocsList = document.getElementById("uploaded-docs-list");

  // Reusable File Upload Handler
  async function uploadFile(file) {
    if (!file) return;

    const filename = file.name;
    const mimeType = file.type || "text/plain";

    // Show uploading indicator in chat
    appendRow("assistant", `⏳ **Uploading & Indexing Document**: \`${filename}\` (${(file.size / 1024).toFixed(1)} KB)...`);

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/documents/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          ...identityHeaders(),
        },
        body: buffer,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || "Upload failed");
      }

      const storageLabel = data.document.storage === "postgres"
        ? "PostgreSQL/pgvector"
        : "temporary in-memory fallback";
      appendRow("assistant", `✅ **Document Successfully Indexed!**\n- **Filename**: \`${data.document.filename}\`\n- **Status**: \`${data.document.status.toUpperCase()}\`\n- **Quality**: \`${data.document.quality.toUpperCase()}\` (Score: ${data.document.score})\n- **Vector Chunks**: \`${data.document.chunks}\` chunks indexed in ${storageLabel}.\n\nYou can now ask questions about the contents of \`${filename}\`!`);

      loadDocuments();
    } catch (err) {
      appendRow("assistant", `❌ **Document Upload Error**: ${err.message}`);
    } finally {
      if (fileInput) fileInput.value = "";
    }
  }

  // Document Upload Handlers
  const triggerUpload = () => fileInput?.click();
  if (btnUploadDoc) btnUploadDoc.addEventListener("click", triggerUpload);
  if (btnAttach) btnAttach.addEventListener("click", triggerUpload);

  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    });
  }

  // Drag & Drop File Upload Overlay Setup
  const dragDropOverlay = document.getElementById("drag-drop-overlay");
  let dragCounter = 0;

  if (dragDropOverlay) {
    window.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer && e.dataTransfer.types.includes("Files")) {
        dragDropOverlay.classList.remove("hidden");
      }
    });

    window.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    window.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dragDropOverlay.classList.add("hidden");
      }
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dragCounter = 0;
      dragDropOverlay.classList.add("hidden");

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const droppedFile = files[0];
        uploadFile(droppedFile);
      }
    });
  }

  async function loadDocuments() {
    if (!uploadedDocsList) return;
    try {
      const res = await fetch("/api/documents", {
        headers: identityHeaders(),
      });
      const data = await res.json();
      const docs = data.documents || [];

      activeDocumentIds.clear();

      if (docs.length === 0) {
        uploadedDocsList.innerHTML = `<span style="font-size: 0.75rem; color: var(--text-muted);">No documents uploaded yet.</span>`;
        return;
      }

      docs.forEach((d) => activeDocumentIds.add(d.id));

      uploadedDocsList.innerHTML = docs
        .map(
          (d) => `
          <div class="doc-item active-doc" data-id="${d.id}">
            <span class="doc-name" title="${escapeHtml(d.filename)}">📄 ${escapeHtml(d.filename)}</span>
            <button class="btn-delete-doc" data-id="${d.id}" title="Delete document">🗑️</button>
          </div>
        `,
        )
        .join("");

      // Add delete click handlers
      uploadedDocsList.querySelectorAll(".btn-delete-doc").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.currentTarget.getAttribute("data-id");
          if (!id) return;

          try {
            const deleteResponse = await fetch(`/api/documents/${id}`, {
              method: "DELETE",
              headers: identityHeaders(),
            });
            if (!deleteResponse.ok) {
              const errorBody = await deleteResponse.json().catch(() => ({}));
              throw new Error(errorBody.error?.message || "Document deletion failed");
            }
            loadDocuments();
          } catch (err) {
            console.error("Delete doc error:", err);
          }
        });
      });
    } catch (err) {
      console.warn("Load documents error:", err);
    }
  }

  loadDocuments();
  checkHealth();
  setInterval(checkHealth, 5000);
});
