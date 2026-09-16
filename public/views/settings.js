/**
 * Git Debugging Agent — Settings View Module
 * Agent autonomy configuration & Backend Connection Runtime management
 */

function initSettingsView() {
  // Autonomy level
  const autonomySelect = document.getElementById("autonomy-level");
  if (autonomySelect) {
    const saved = localStorage.getItem("gda_autonomy");
    if (saved) autonomySelect.value = saved;
  }

  // Backend API Base URL
  const backendInput = document.getElementById("backend-url-input");
  if (backendInput) {
    const custom = localStorage.getItem("gda_api_base");
    backendInput.value = custom || window.__API_BASE__ || "";
  }

  // User Account Info
  const user = window.state?.user;
  if (user) {
    const emailEl = document.getElementById("settings-email");
    if (emailEl) emailEl.textContent = user.email || user.name || "User";

    const avatarEl = document.getElementById("settings-avatar");
    if (avatarEl && user.avatar) {
      avatarEl.src = user.avatar;
      avatarEl.style.display = "block";
    }

    const roleBadge = document.getElementById("settings-role-badge");
    if (roleBadge) {
      roleBadge.className = `badge badge-${user.role === "admin" ? "accent" : "secondary"}`;
      roleBadge.textContent = user.role?.toUpperCase() || "DEVELOPER";
      roleBadge.style.display = "inline-block";
    }
  }
}

function saveAgentConfig() {
  const autonomy = document.getElementById("autonomy-level")?.value;
  if (autonomy) {
    localStorage.setItem("gda_autonomy", autonomy);
    showToast("Agent autonomy settings saved", "success");
  }
}

function saveBackendConfig() {
  const backendInput = document.getElementById("backend-url-input");
  const url = backendInput?.value.trim() || "";
  if (url) {
    localStorage.setItem("gda_api_base", url);
    window.__API_BASE__ = url;
    showToast("Backend API URL saved! Reloading application...", "success");
    setTimeout(() => window.location.reload(), 1200);
  } else {
    localStorage.removeItem("gda_api_base");
    showToast("Backend URL reset to default. Reloading...", "info");
    setTimeout(() => window.location.reload(), 1200);
  }
}

async function testBackendConnection() {
  const resultEl = document.getElementById("backend-test-result");
  const badgeEl = document.getElementById("backend-status-badge");
  const backendInput = document.getElementById("backend-url-input");
  const testBase = backendInput?.value.trim() || window.__API_BASE__ || "";

  if (resultEl) {
    resultEl.innerHTML = '<span class="spinner" style="display:inline-block;width:12px;height:12px;vertical-align:middle;margin-right:4px"></span> Testing...';
    resultEl.style.color = "var(--c-text-muted)";
  }

  const startTime = Date.now();
  try {
    const url = `${testBase.replace(/\/+$/, "")}/health`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const latency = Date.now() - startTime;
    if (res.ok) {
      const data = await res.json();
      if (resultEl) {
        resultEl.textContent = `✓ OK (${latency}ms) — Status: ${data.status || "healthy"}`;
        resultEl.style.color = "var(--c-accent)";
      }
      if (badgeEl) {
        badgeEl.className = "badge badge-success";
        badgeEl.textContent = "Online";
      }
      showToast(`Backend connection healthy (${latency}ms)!`, "success");
    } else {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    if (resultEl) {
      resultEl.textContent = `✗ Failed: ${err.message}`;
      resultEl.style.color = "var(--c-danger)";
    }
    if (badgeEl) {
      badgeEl.className = "badge badge-danger";
      badgeEl.textContent = "Unreachable";
    }
    showToast(`Backend test failed: ${err.message}`, "error");
  }
}

// Window exports
window.initSettingsView = initSettingsView;
window.saveAgentConfig = saveAgentConfig;
window.saveBackendConfig = saveBackendConfig;
window.testBackendConnection = testBackendConnection;
