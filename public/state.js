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
