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
  const userRole = "user";
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
    let html = escapeHtml(text);

    // Format ```code blocks with Copy button
    html = html.replace(
      /```(?:typescript|js|json)?\n([\s\S]*?)\n```/g,
      (match, code) => `
        <div class="code-wrapper">
          <div class="code-header">
            <span>TypeScript Code Snippet</span>
            <button class="btn-copy" onclick="copyCode(this)">📋 Copy</button>
          </div>
          <pre><code>${code}</code></pre>
        </div>
      `,
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
    // Format newlines
    html = html.replace(/\n/g, "<br>");

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
      const sourceText = Array.isArray(data.sources) && data.sources.length > 0
        ? `\n\n**Sources:** ${data.sources
          .map((source) => `${source.source}${source.page ? ` (p. ${source.page})` : ""}`)
          .join(", ")}`
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

  // Document Upload Handlers
  const triggerUpload = () => fileInput?.click();
  if (btnUploadDoc) btnUploadDoc.addEventListener("click", triggerUpload);
  if (btnAttach) btnAttach.addEventListener("click", triggerUpload);

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
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
        fileInput.value = "";
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
