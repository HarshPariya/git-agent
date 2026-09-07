/**
 * Git Debugging Agent — Application Controller & Orchestrator
 * Modularized Architecture:
 * - State: /state.js
 * - Components: /components/diff-viewer.js, /components/commit-plan.js
 * - Views: /views/dashboard.js, /views/repositories.js, /views/debugging.js,
 *          /views/git-desktop.js, /views/pull-requests.js, /views/issues.js,
 *          /views/conflicts.js, /views/history.js, /views/settings.js
 */

// Application Reactive State reference
window.state = window.state || {
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
const state = window.state;

// ============================================================
// INITIALIZATION & AUTH
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  initNavigation();
  initTabs();
  initForms();
  initUserMenu();
  if (typeof initDragAndDrop === "function") initDragAndDrop();
  if (typeof setupFolderDropZone === "function") setupFolderDropZone();

  // Check authentication — try JWT token first, then dev-mode headers
  if (api.token) {
    try {
      const meData = await api.getMe();
      showApp(meData.user);
    } catch {
      api.clearToken();
      await tryDevModeAutoLogin();
    }
  } else {
    await tryDevModeAutoLogin();
  }
});

async function tryDevModeAutoLogin() {
  try {
    const meData = await api.getMe();
    showApp(meData.user || { email: "dev@debug.local", name: "Developer" });
  } catch {
    showAuth();
  }
}

function showAuth() {
  const authEl = document.getElementById("auth-page");
  const appEl = document.getElementById("app");
  if (authEl) authEl.style.display = "flex";
  if (appEl) appEl.style.display = "none";
}

function showApp(user) {
  const authEl = document.getElementById("auth-page");
  const appEl = document.getElementById("app");
  if (authEl) authEl.style.display = "none";
  if (appEl) appEl.style.display = "block";

  const emailEl = document.getElementById("settings-email");
  if (emailEl) emailEl.textContent = (user && (user.email || user.name)) || "Developer (Dev Mode)";

  loadAll();
}

async function loadAll() {
  await Promise.allSettled([
    typeof checkHealth === "function" ? checkHealth() : Promise.resolve(),
    typeof loadRepositories === "function" ? loadRepositories() : Promise.resolve(),
    typeof loadGitHubStatus === "function" ? loadGitHubStatus() : Promise.resolve(),
    typeof loadDashboardStats === "function" ? loadDashboardStats() : Promise.resolve(),
    typeof loadHistory === "function" ? loadHistory() : Promise.resolve(),
  ]);
}

function logout() {
  api.clearToken();
  showAuth();
  showToast("Signed out successfully", "info");
}

// ============================================================
// NAVIGATION & ROUTING
// ============================================================

function initNavigation() {
  document.querySelectorAll(".header-nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const page = item.getAttribute("data-page");
      if (page) navigate(page);
    });
  });
}

function navigate(pageId) {
  window.state.currentPage = pageId;

  // Update nav highlighting
  document.querySelectorAll(".header-nav-item").forEach((item) => {
    if (item.getAttribute("data-page") === pageId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Switch pages
  document.querySelectorAll(".page").forEach((page) => {
    if (page.id === `page-${pageId}`) {
      page.classList.add("active");
    } else {
      page.classList.remove("active");
    }
  });

  // Page-specific fresh loads
  if (pageId === "dashboard") {
    if (typeof loadDashboardStats === "function") loadDashboardStats();
  } else if (pageId === "repositories") {
    if (typeof loadRepositories === "function") loadRepositories();
  } else if (pageId === "git-desktop") {
    if (typeof loadGitDesktop === "function") loadGitDesktop();
  } else if (pageId === "debug") {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
  } else if (pageId === "issues") {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
    if (typeof loadIssues === "function") loadIssues();
  } else if (pageId === "prs") {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
    if (typeof loadPRs === "function") loadPRs();
  } else if (pageId === "conflicts") {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
    if (typeof loadConflictsPage === "function") loadConflictsPage();
  } else if (pageId === "history") {
    if (typeof loadHistory === "function") loadHistory();
  } else if (pageId === "settings") {
    if (typeof loadGitHubStatus === "function") loadGitHubStatus();
    if (typeof loadApiStatus === "function") loadApiStatus();
  }
}

// ============================================================
// TABS
// ============================================================

function initTabs() {
  document.querySelectorAll(".tab-item").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-tab");
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  window.state.activeTab = tabName;
  document.querySelectorAll(".tab-item").forEach((tab) => {
    if (tab.getAttribute("data-tab") === tabName) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    if (panel.getAttribute("data-tab") === tabName) {
      panel.classList.add("active");
    } else {
      panel.classList.remove("active");
    }
  });
}

// ============================================================
// FORMS & AUTH EVENTS
// ============================================================

function initForms() {
  // Login Form
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("auth-error");
  const loginBtn = document.getElementById("login-btn");

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (loginError) loginError.style.display = "none";
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = "Signing In..."; }

    const email = document.getElementById("login-email")?.value.trim();
    const password = document.getElementById("login-password")?.value;

    try {
      const data = await api.login(email, password);
      showToast("Welcome back!", "success");
      showApp(data.user);
    } catch (err) {
      if (loginError) {
        loginError.textContent = err.message || "Failed to sign in";
        loginError.style.display = "block";
      }
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = "Sign In";
      }
    }
  });

  // Register Form
  const regForm = document.getElementById("register-form");
  const regError = document.getElementById("register-error");
  const regBtn = document.getElementById("register-btn");

  regForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (regError) regError.style.display = "none";
    if (regBtn) { regBtn.disabled = true; regBtn.textContent = "Creating Account..."; }

    const email = document.getElementById("reg-email")?.value.trim();
    const password = document.getElementById("reg-password")?.value;

    try {
      const data = await api.register(email, password);
      showToast("Account created successfully!", "success");
      showApp(data.user);
    } catch (err) {
      if (regError) {
        regError.textContent = err.message || "Failed to register";
        regError.style.display = "block";
      }
    } finally {
      if (regBtn) {
        regBtn.disabled = false;
        regBtn.textContent = "Create Account";
      }
    }
  });

  // Toggle Forms
  document.getElementById("show-register-btn")?.addEventListener("click", () => {
    if (loginForm) loginForm.style.display = "none";
    if (regForm) regForm.style.display = "flex";
  });

  document.getElementById("show-login-btn")?.addEventListener("click", () => {
    if (regForm) regForm.style.display = "none";
    if (loginForm) loginForm.style.display = "flex";
  });

  // Debug Form
  const debugForm = document.getElementById("debug-form");
  debugForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (typeof startDebugFromForm === "function") {
      startDebugFromForm();
    }
  });

  // Folder path input Enter key
  const folderPathInput = document.getElementById("folder-path-input");
  folderPathInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (typeof browseToEnteredPath === "function") {
        browseToEnteredPath();
      }
    }
  });
}

function initUserMenu() {
  document.getElementById("user-menu-btn")?.addEventListener("click", () => {
    navigate("settings");
  });
}

// ============================================================
// MODALS & TOASTS
// ============================================================

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.style.display = "none";
  }
});

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = type === "success" ? "✓" : type === "error" ? "⚠️" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatRelativeTime(date) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// Global window registrations
window.navigate = navigate;
window.switchTab = switchTab;
window.showToast = showToast;
window.openModal = openModal;
window.closeModal = closeModal;
window.escapeHtml = escapeHtml;
window.formatRelativeTime = formatRelativeTime;
window.sleep = sleep;
window.logout = logout;
window.loadAll = loadAll;
