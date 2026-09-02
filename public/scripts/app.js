/**
 * GraphRAG.ai — Production Frontend Application
 *
 * Contract with backend (/chat POST):
 *   Request:  { message: string, sessionId: string }
 *   Headers:  x-tenant-id, x-user-id, x-user-role
 *
 *   Response (success 200):
 *     { message: string, model: string, responseId: string,
 *       sources: Array<{source,page?,score}>, toolActivity: Array<{toolName,success,durationMs,error?}> }
 *
 *   Response (error 4xx/5xx):
 *     { error: { message: string, code: string } }
 *
 * Health endpoint (/health GET):
 *   { status: string, environment: string, uptime: string, uptimeSeconds: number }
 */

(() => {
  // ── DOM References (matching index.html IDs) ─────────────────────────────
  const chatMessages = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const btnSendChat = document.getElementById("btn-send-chat");
  const btnClearChat = document.getElementById("btn-clear-chat");
  const btnNewSession = document.getElementById("btn-new-session");
  const btnRandomSession = document.getElementById("btn-random-session");
  const selectTenant = document.getElementById("select-tenant");
  const selectRole = document.getElementById("select-role");
  const inputSessionId = document.getElementById("input-session-id");
  const systemStatusIndicator = document.getElementById("system-status-indicator");
  const systemStatusText = document.getElementById("system-status-text");
  const toastContainer = document.getElementById("toast-container");
  const toolCapItems = document.querySelectorAll(".tool-cap-item");
  const navLinks = document.querySelectorAll(".nav-link");
  const healthStatusVal = document.getElementById("health-status-val");
  const healthUptimeVal = document.getElementById("health-uptime-val");
  const healthModelVal = document.getElementById("health-model-val");

  // ── State ─────────────────────────────────────────────────────────────────
  let isSubmitting = false;

  // ── Toast Notifications ──────────────────────────────────────────────────
  const showToast = (message, type = "info") => {
    if (!toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  };

  // ── Session Utilities ─────────────────────────────────────────────────────
  const generateRandomSession = () => {
    const randomId = "session-" + Math.random().toString(36).substring(2, 9);
    if (inputSessionId) inputSessionId.value = randomId;
    showToast(`Switched to session: ${randomId}`);
  };

  // ── HTML Escaping ─────────────────────────────────────────────────────────
  const escapeHtml = (text) =>
    String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  // ── Strip Internal LLM XML Tags ───────────────────────────────────────────
  const stripInternalTags = (text) =>
    text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<function=[\w]+>[\s\S]*?<\/function>/gi, "")
      .replace(/<parameter=[\w]+>[\s\S]*?<\/parameter>/gi, "")
      .replace(/<\/?(function|parameter|tools|tool_call)\b[^>]*>/gi, "")
      .replace(/\[?TOOL_CALL[\s\S]*?END_TOOL_CALL\]?/gi, "")
      .trim();

  // ── Markdown → HTML Renderer ──────────────────────────────────────────────
  const formatMarkdown = (text) => {
    if (!text) return "";
    const clean = stripInternalTags(text);
    if (!clean) return "";

    // Escape HTML first
    let html = clean
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks with syntax highlighting and copy button
    html = html.replace(
      /```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g,
      (_match, lang, code) => {
        const language = lang || "code";
        const escapedCode = code.trim();
        return `<pre><div class="code-header"><span class="code-lang">${escapeHtml(language)}</span><button class="btn-copy" onclick="this.nextElementSibling || navigator.clipboard.writeText(this.closest('pre').querySelector('code').innerText).then(() => { this.innerText='✓ Copied!'; setTimeout(() => this.innerText='Copy', 1500) })">Copy</button></div><code>${escapedCode}</code></pre>`;
      }
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold and Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Headings
    html = html.replace(/^#### (.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

    // Bullet lists
    html = html.replace(/^[\s]*[-*•]\s+(.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\s*)+)/gs, "<ul>$1</ul>");

    // Numbered lists
    html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, "<li>$1</li>");

    // Horizontal rule
    html = html.replace(/^---+$/gm, "<hr/>");

    // Paragraphs (split on blank lines)
    const paragraphs = html
      .split("\n\n")
      .filter((s) => s.trim())
      .map((p) => {
        const trimmed = p.trim();
        // Don't wrap block elements
        if (/^<(?:h[1-6]|ul|ol|li|pre|hr|blockquote)/.test(trimmed)) {
          return trimmed;
        }
        return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
      })
      .join("");

    return paragraphs;
  };

  // ── Render Tool Activity Panel ────────────────────────────────────────────
  const renderToolActivity = (toolActivity) => {
    if (!toolActivity || toolActivity.length === 0) return "";

    const items = toolActivity
      .map((t) => {
        const icon = t.success ? "✅" : "❌";
        const durationLabel =
          t.durationMs > 0 ? ` <span class="tool-duration">(${t.durationMs}ms)</span>` : "";
        const errorLabel = t.error
          ? ` <span class="tool-error-label">— ${escapeHtml(t.error)}</span>`
          : "";
        return `<div class="tool-activity-item ${t.success ? "success" : "failed"}">
          ${icon} <code>${escapeHtml(t.toolName)}</code>${durationLabel}${errorLabel}
        </div>`;
      })
      .join("");

    return `<div class="tool-activity-panel">
      <div class="tool-activity-header">🔧 Tools Executed</div>
      ${items}
    </div>`;
  };

  // ── Render Sources/Citations ──────────────────────────────────────────────
  const renderSources = (sources) => {
    if (!sources || sources.length === 0) return "";
    const tags = sources
      .map((s) => `<span class="source-tag">📄 ${escapeHtml(s.source)}${s.page ? ` (p. ${s.page})` : ""}</span>`)
      .join(" ");
    return `<div class="sources-pill-group"><span class="sources-label">Sources:</span> ${tags}</div>`;
  };

  // ── Append Message to Feed ────────────────────────────────────────────────
  const appendMessage = (sender, content, isBot = false, metadata = {}) => {
    if (!chatMessages) return;

    const row = document.createElement("div");
    row.className = `message-row ${isBot ? "bot-row" : "user-row"}`;

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const toolActivityHtml = isBot ? renderToolActivity(metadata.toolActivity) : "";
    const sourcesHtml = isBot ? renderSources(metadata.sources) : "";

    row.innerHTML = `
      <div class="msg-avatar">${isBot ? "🤖" : "👤"}</div>
      <div class="msg-bubble">
        <div class="msg-header">
          <span class="msg-sender">${escapeHtml(sender)}</span>
          <span class="msg-time">${timeStr}</span>
        </div>
        ${toolActivityHtml}
        <div class="msg-body">
          ${isBot
        ? formatMarkdown(content)
        : `<p>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`
      }
        </div>
        ${sourcesHtml}
      </div>
    `;

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  // ── Typing Indicator ──────────────────────────────────────────────────────
  const showTypingIndicator = () => {
    if (!chatMessages) return null;
    const id = "typing-indicator-" + Date.now();
    const row = document.createElement("div");
    row.id = id;
    row.className = "message-row bot-row";
    row.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <div class="msg-body">
          <span class="pulse-dot"></span> <em>Agent is analyzing workspace &amp; executing tools...</em>
        </div>
      </div>
    `;
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
  };

  const removeTypingIndicator = (id) => {
    if (id) document.getElementById(id)?.remove();
  };

  // ── Send Message to Backend ───────────────────────────────────────────────
  const sendMessage = async (messageText) => {
    const query = (messageText || (chatInput && chatInput.value) || "").trim();
    if (!query || isSubmitting) return;

    const tenantId = (selectTenant && selectTenant.value) || "tenant-1";
    const userRole = (selectRole && selectRole.value) || "user";
    const sessionId = (inputSessionId && inputSessionId.value.trim()) || "session-1";
    const userId = "user-" + tenantId;

    appendMessage("You (" + userRole + ")", query, false);
    if (chatInput) chatInput.value = "";

    isSubmitting = true;
    if (btnSendChat) btnSendChat.disabled = true;

    const typingId = showTypingIndicator();

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "x-user-id": userId,
          "x-user-role": userRole,
        },
        body: JSON.stringify({
          sessionId,
          message: query,
        }),
      });

      const data = await response.json();
      removeTypingIndicator(typingId);

      if (response.ok && data.message) {
        appendMessage("GraphRAG Agent", data.message, true, {
          sources: data.sources || [],
          toolActivity: data.toolActivity || [],
          responseId: data.responseId,
          model: data.model,
        });

        // Flash the tool cap items that were used
        if (data.toolActivity && data.toolActivity.length > 0) {
          data.toolActivity.forEach((t) => {
            const el = document.querySelector(`[data-tool="${t.toolName}"]`);
            if (el) {
              el.classList.add("tool-active-flash");
              setTimeout(() => el.classList.remove("tool-active-flash"), 1500);
            }
          });
        }
      } else {
        const errorMsg =
          data.error?.message || data.message || "An unexpected error occurred.";
        appendMessage(
          "System Notice",
          `⚠️ **Error (${data.error?.code || response.status})**: ${errorMsg}`,
          true,
        );
        showToast(errorMsg, "error");
      }
    } catch (err) {
      removeTypingIndicator(typingId);
      appendMessage(
        "Network Error",
        "⚠️ Failed to communicate with the API server. Please check your backend connection.",
        true,
      );
      showToast("Network request failed", "error");
    } finally {
      isSubmitting = false;
      if (btnSendChat) btnSendChat.disabled = false;
      if (chatInput) chatInput.focus();
    }
  };

  // ── Health Poller ─────────────────────────────────────────────────────────
  const checkHealth = async () => {
    try {
      const res = await fetch("/health");
      if (res.ok) {
        const health = await res.json();

        if (systemStatusText) systemStatusText.innerText = "API Live (200 OK)";
        if (systemStatusIndicator) {
          systemStatusIndicator.style.background = "rgba(16, 185, 129, 0.1)";
          systemStatusIndicator.style.color = "#34d399";
          const dot = systemStatusIndicator.querySelector(".status-dot");
          if (dot) dot.style.background = "#10b981";
        }

        if (healthStatusVal) healthStatusVal.innerText = "ONLINE";
        if (healthUptimeVal)
          healthUptimeVal.innerText = `Uptime: ${health.uptime || health.environment || "active"}`;
        if (healthModelVal) healthModelVal.innerText = "Qwen 3.8 / GPT-OSS";
      } else {
        if (systemStatusText) systemStatusText.innerText = "Degraded Status";
        if (systemStatusIndicator) {
          systemStatusIndicator.style.background = "rgba(245, 158, 11, 0.1)";
          systemStatusIndicator.style.color = "#fbbf24";
        }
        if (healthStatusVal) healthStatusVal.innerText = "DEGRADED";
      }
    } catch {
      if (systemStatusText) systemStatusText.innerText = "Server Offline";
      if (systemStatusIndicator) {
        systemStatusIndicator.style.background = "rgba(244, 63, 94, 0.1)";
        systemStatusIndicator.style.color = "#f43f5e";
      }
      if (healthStatusVal) healthStatusVal.innerText = "OFFLINE";
    }
  };

  // ── ScrollSpy ─────────────────────────────────────────────────────────────
  const setupScrollSpy = () => {
    const sections = ["studio", "tools", "architecture", "metrics"]
      .map((id) => document.getElementById(id))
      .filter((el) => el !== null);

    window.addEventListener("scroll", () => {
      const scrollPos = window.scrollY + 200;
      let currentSectionId = "";

      for (const section of sections) {
        if (
          section.offsetTop <= scrollPos &&
          section.offsetTop + section.offsetHeight > scrollPos
        ) {
          currentSectionId = section.id;
          break;
        }
      }

      if (currentSectionId) {
        navLinks.forEach((link) => {
          if (link.getAttribute("data-section") === currentSectionId) {
            link.classList.add("active");
          } else {
            link.classList.remove("active");
          }
        });
      }
    });
  };

  // ── Event Listeners ───────────────────────────────────────────────────────
  if (chatForm) {
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage(chatInput ? chatInput.value : "");
    });
  }

  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(chatInput.value);
      }
    });

    // Auto-resize textarea
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
    });
  }

  if (btnClearChat) {
    btnClearChat.addEventListener("click", () => {
      if (chatMessages) {
        chatMessages.innerHTML = "";
        appendMessage("GraphRAG Agent", "Chat cleared. Ready for your next command!", true);
      }
    });
  }

  if (btnNewSession) btnNewSession.addEventListener("click", generateRandomSession);
  if (btnRandomSession) btnRandomSession.addEventListener("click", generateRandomSession);

  // Tool capability items — focus input and show hint
  toolCapItems.forEach((item) => {
    item.addEventListener("click", () => {
      const toolName = item.getAttribute("data-tool");
      if (chatInput) chatInput.focus();
      showToast(`Tool active: ${toolName}. Type your command in the input box.`);
    });
  });

  // ── Initialize ────────────────────────────────────────────────────────────
  checkHealth();
  setupScrollSpy();
  setInterval(checkHealth, 15000);
})();
