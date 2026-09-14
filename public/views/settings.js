/**
 * Git Debugging Agent — Settings View Module
 * Agent autonomy configuration
 */

function saveAgentConfig() {
  const autonomy = document.getElementById("autonomy-level")?.value;
  localStorage.setItem("gda_autonomy", autonomy);
  showToast("Agent autonomy settings saved", "success");
}

// Window exports
window.saveAgentConfig = saveAgentConfig;
