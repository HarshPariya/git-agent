/**
 * Git Debugging Agent — Settings View Module
 * Agent autonomy configuration and system health/environment details
 */

function saveAgentConfig() {
  const autonomy = document.getElementById("autonomy-level")?.value;
  localStorage.setItem("gda_autonomy", autonomy);
  showToast("Agent autonomy settings saved", "success");
}

async function loadApiStatus() {
  const detailsEl = document.getElementById("api-status-details");
  if (!detailsEl) return;

  try {
    const info = await api.getInfo();
    detailsEl.innerHTML = `
      <div><strong>Service:</strong> ${escapeHtml(info.service || "Git Debugging Agent")}</div>
      <div style="margin-top:4px"><strong>Version:</strong> ${escapeHtml(info.version || "2.0.0")}</div>
      <div style="margin-top:4px"><strong>Environment:</strong> ${escapeHtml(info.environment || "development")}</div>
      <div style="margin-top:4px"><strong>Status:</strong> <span style="color:var(--c-success)">Online & Healthy</span></div>
    `;
  } catch {
    detailsEl.innerHTML = `<div class="text-danger">Failed to fetch API status.</div>`;
  }
}

// Window exports
window.saveAgentConfig = saveAgentConfig;
window.loadApiStatus = loadApiStatus;
