/**
 * Git Debugging Agent — Central Reactive Application State
 * Modular state management shared across all views and components
 */

window.state = {
  currentPage: "dashboard",
  repositories: [],
  activeRepository: null,
  currentSession: null,
  gitHubConnected: false,
  gitHubUsername: null,
  cachedGitHubRepos: [],
  agentRunning: false,
  activeTab: "evidence",
  currentBrowsedPath: null,
  browsedFolderGit: null,
  gitDesktop: {
    changedFiles: [],
    currentFilter: "all",
    selectedFile: null,
    commitPlan: null,
    gitStatus: null,
    outgoingCommits: [],
  },
  currentFixPlan: null,
  currentCritic: null,
};

// Global state subscription helper
window.stateListeners = [];
window.subscribeState = function (listener) {
  if (typeof listener === "function") {
    window.stateListeners.push(listener);
  }
};
window.notifyStateChange = function (changeKey, data) {
  for (const fn of window.stateListeners) {
    try { fn(changeKey, data, window.state); } catch (e) { console.warn("State listener error:", e); }
  }
};

// setState function that triggers pub/sub notifications
window.setState = function (key, value) {
  window.state[key] = value;
  window.notifyStateChange(key, value);
};

// Automatic LocalStorage State Persistence
try {
  const savedRepo = localStorage.getItem("gda_active_repo");
  if (savedRepo) window.state.activeRepository = JSON.parse(savedRepo);
  const savedSession = localStorage.getItem("gda_current_session");
  if (savedSession) window.state.currentSession = JSON.parse(savedSession);
} catch {
  // ignore storage error
}

window.subscribeState((key, val) => {
  try {
    if (key === "activeRepository") {
      if (val) localStorage.setItem("gda_active_repo", JSON.stringify(val));
      else localStorage.removeItem("gda_active_repo");
    }
    if (key === "currentSession") {
      if (val) localStorage.setItem("gda_current_session", JSON.stringify(val));
      else localStorage.removeItem("gda_current_session");
    }
  } catch {
    // storage limit or private browsing
  }
});

