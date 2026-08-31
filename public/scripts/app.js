/**
 * GraphRAG.ai — Frontend Agentic Application & Interactive Studio
 */

(() => {
  // DOM Elements
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

  // State
  let isSubmitting = false;

  // ─── Show Toast Notification ──────────────────────────────
  const showToast = (message, type = "info") => {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  };

  // ─── Generate Random Session ID ──────────────────────────
  const generateRandomSession = () => {
    const randomId = "session-" + Math.random().toString(36).substring(2, 9);
    inputSessionId.value = randomId;
    showToast(`Switched to session: ${randomId}`);
  };

  // ─── Strip Raw LLM XML/Internal Tags ─────────────────────
  const stripInternalTags = (text) =>
    text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<function=[\w]+>[\s\S]*?<\/function>/gi, "")
      .replace(/<parameter=[\w]+>[\s\S]*?<\/parameter>/gi, "")
      .replace(/<\/?(function|parameter|tools|tool_call)\b[^>]*>/gi, "")
      .replace(/\[?TOOL_CALL[\s\S]*?END_TOOL_CALL\]?/gi, "")
      .trim();

  // ─── Parse Markdown to HTML ───────────────────────────────
  const formatMarkdown = (text) => {
    if (!text) return "";

    // Always strip internal XML tags first before any encoding
    const clean = stripInternalTags(text);
    if (!clean) return "";

    // HTML-encode the cleaned text
    let formatted = clean
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks with copy button (must run before other replacements)
    formatted = formatted.replace(
      /```([a-zA-Z0-9_\-]*)\n([\s\S]*?)```/g,
      (_match, lang, code) => {
        const language = lang || "code";
        return `<pre><div class="code-header"><span class="code-lang">${language}</span><button class="btn-copy" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); this.innerText='Copied!'; setTimeout(()=>this.innerText='Copy', 1500)">Copy</button></div><code>${code.trim()}</code></pre>`;
      },
    );

    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold and Italic
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Headings
    formatted = formatted.replace(/^#### (.+)$/gm, "<h5>$1</h5>");
    formatted = formatted.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    formatted = formatted.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    formatted = formatted.replace(/^# (.+)$/gm, "<h2>$1</h2>");

    // Bullet lists
    formatted = formatted.replace(/^[\s]*[-*•]\s+(.+)$/gm, "<li>$1</li>");
    // Wrap consecutive list items
    formatted = formatted.replace(/((?:<li>.*<\/li>\s*)+)/gs, "<ul>$1</ul>");

    // Numbered lists
    formatted = formatted.replace(/^[\s]*\d+\.\s+(.+)$/gm, "<li>$1</li>");

    // Horizontal rule
    formatted = formatted.replace(/^---+$/gm, "<hr/>");

    // Tool execution markers — render as styled badge boxes
    formatted = formatted.replace(
      /(?:Successfully executed operations using|Executed tools?):\s*([a-zA-Z0-9_, -]+)/gi,
      (_match, tools) => {
        const toolBadges = tools
          .split(",")
          .map((t) => `<span class="tool-badge-pill">⚙️ ${t.trim()}</span>`)
          .join(" ");
        return `<div class="tool-run-box"><span class="tool-run-label">Autonomous Operations:</span> ${toolBadges}</div>`;
      },
    );

    // Newlines to paragraphs
    const paragraphs = formatted
      .split("\n\n")
      .filter((s) => s.trim())
      .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
      .join("");

    return paragraphs;
  };

  // ─── Append Message to Chat Feed ─────────────────────────
  const appendMessage = (sender, content, isBot = false, metadata = {}) => {
    const row = document.createElement("div");
    row.className = `message-row ${isBot ? "bot-row" : "user-row"}`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    row.innerHTML = `
      <div class="msg-avatar">${isBot ? "🤖" : "👤"}</div>
      <div class="msg-bubble">
        <div class="msg-header">
          <span class="msg-sender">${sender}</span>
          <span class="msg-time">${timeStr}</span>
        </div>
        <div class="msg-body">
          ${isBot ? formatMarkdown(content) : `<p>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`}
        </div>
        ${metadata.sources && metadata.sources.length > 0
        ? `<div class="sources-pill-group">
              <span class="sources-label">Sources:</span>
              ${metadata.sources.map((s) => `<span class="source-tag">📄 ${s.source}${s.page ? ` (p. ${s.page})` : ""}</span>`).join(" ")}
            </div>`
        : ""
      }
      </div>
    `;

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  // ─── Show Typing Indicator ────────────────────────────────
  const showTypingIndicator = () => {
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

  // ─── Remove Typing Indicator ──────────────────────────────
  const removeTypingIndicator = (id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  };

  // ─── Send Message to Backend API ─────────────────────────
  const sendMessage = async (messageText) => {
    if (!messageText.trim() || isSubmitting) return;

    const tenantId = selectTenant.value.trim() || "tenant-1";
    const userId = "user-" + tenantId;
    const userRole = selectRole.value || "user";
    const sessionId = inputSessionId.value.trim() || "session-1";

    appendMessage("You (" + userRole + ")", messageText, false);
    chatInput.value = "";
    isSubmitting = true;
    btnSendChat.disabled = true;

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
          message: messageText,
        }),
      });

      const data = await response.json();
      removeTypingIndicator(typingId);

      if (response.ok && data.message) {
        appendMessage("GraphRAG Agent", data.message, true, {
          sources: data.sources || [],
          responseId: data.responseId,
        });
      } else {
        const errorMsg = data.error?.message || "An unexpected error occurred.";
        appendMessage(
          "System Notice",
          `⚠️ **Notice (${data.error?.code || response.status})**: ${errorMsg}`,
          true,
        );
        showToast(errorMsg, "error");
      }
    } catch {
      removeTypingIndicator(typingId);
      appendMessage(
        "Network Error",
        "⚠️ Failed to communicate with API server. Please check your backend connection.",
        true,
      );
      showToast("Network request failed", "error");
    } finally {
      isSubmitting = false;
      btnSendChat.disabled = false;
      chatInput.focus();
    }
  };

  // ─── Health Poller ────────────────────────────────────────
  const checkHealth = async () => {
    try {
      const res = await fetch("/health");
      if (res.ok) {
        const health = await res.json();
        systemStatusText.innerText = "API Live (200 OK)";
        systemStatusIndicator.style.background = "rgba(16, 185, 129, 0.1)";
        systemStatusIndicator.style.color = "#34d399";
        systemStatusIndicator.querySelector(".status-dot").style.background = "#10b981";

        if (healthStatusVal) healthStatusVal.innerText = "ONLINE";
        if (healthUptimeVal)
          healthUptimeVal.innerText = `Environment: ${health.environment || "production"}`;
        if (healthModelVal) healthModelVal.innerText = "Qwen 3.8 / GPT-OSS";
      } else {
        systemStatusText.innerText = "Degraded Status";
        systemStatusIndicator.style.background = "rgba(245, 158, 11, 0.1)";
        systemStatusIndicator.style.color = "#fbbf24";
      }
    } catch {
      systemStatusText.innerText = "Server Offline";
      systemStatusIndicator.style.background = "rgba(244, 63, 94, 0.1)";
      systemStatusIndicator.style.color = "#f43f5e";
    }
  };

  // ─── ScrollSpy & Navigation Active State ─────────────────
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

  // ─── Event Listeners ──────────────────────────────────────
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(chatInput.value);
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput.value);
    }
  });

  btnClearChat.addEventListener("click", () => {
    chatMessages.innerHTML = "";
    appendMessage("GraphRAG Agent", "Chat cleared. Ready for your next command!", true);
  });

  btnNewSession.addEventListener("click", generateRandomSession);
  btnRandomSession.addEventListener("click", generateRandomSession);

  // Tool Capability Items — focus input and scroll to chat
  toolCapItems.forEach((item) => {
    item.addEventListener("click", () => {
      const toolName = item.getAttribute("data-tool");
      chatInput.focus();
      showToast(`Tool active: ${toolName}. Type your command in the input box.`);
    });
  });

  // ─── Initialize ───────────────────────────────────────────
  checkHealth();
  setupScrollSpy();
  setInterval(checkHealth, 15000);
})();
