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

// ============================================================
// INITIALIZATION & AUTH
// ============================================================

let googleSignInReady = false;

document.addEventListener("DOMContentLoaded", async () => {
  initNavigation();
  initTabs();
  initForms();
  initUserMenu();
  initMobileMenu();
  initScrollToTop();
  if (typeof initDragAndDrop === "function") initDragAndDrop();
  if (typeof setupFolderDropZone === "function") setupFolderDropZone();

  // Check authentication — verify stored token with the server
  if (api.token) {
    try {
      const { user } = await api.getMe();
      showApp(user);
    } catch {
      // Token invalid/expired — clear it and show login
      api.clearToken();
      showAuth();
    }
  } else {
    // No token → show login page
    showAuth();
  }
});

function showAuth() {
  document.getElementById("auth-page").style.display = "flex";
  document.getElementById("app").style.display = "none";
  // Render Google button now that auth page is visible (needs real dimensions)
  initGoogleSignIn();
}

async function initGoogleSignIn() {
  try {
    if (googleSignInReady) {
      // Already initialized — re-render button if container is now visible
      const container = document.getElementById("google-signin-btn");
      if (container && container.offsetWidth > 0) {
        container.innerHTML = "";
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "continue_with",
        });
      }
      return;
    }

    const { clientId } = await api.getGoogleClientId();
    if (!clientId || typeof google === "undefined") return;

    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        const authError = document.getElementById("auth-error");
        const loginBtn = document.getElementById("login-btn");
        try {
          if (authError) authError.style.display = "none";
          if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = "Signing In..."; }
          const { user } = await api.googleLogin(response.credential);
          showToast("Signed in with Google!", "success");
          showApp(user, true);
        } catch (err) {
          if (authError) {
            authError.textContent = err.message || "Google sign-in failed";
            authError.style.display = "block";
          }
        } finally {
          if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = "Sign In"; }
        }
      },
      // Catch Google Sign-In flow errors (e.g., popup blocked, invalid_client)
      error_callback: (err) => {
        const authError = document.getElementById("auth-error");
        if (authError) {
          const messages = {
            popup_closed: "Sign-in popup was closed. Please try again.",
            popup_failed_to_open: "Could not open sign-in popup. Check your popup blocker settings.",
            cancelled: "Sign-in was cancelled.",
          };
          const msg = messages[err.type] || "Google Sign-In failed: " + (err.message || err.type || "Unknown error. Ensure GOOGLE_CLIENT_ID is configured correctly in Google Cloud Console.");
          authError.textContent = msg;
          authError.style.display = "block";
        }
      },
    });

    googleSignInReady = true;

    const container = document.getElementById("google-signin-btn");
    if (container) {
      google.accounts.id.renderButton(container, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
      });
    }
  } catch {
    // Google Sign-In not configured or unavailable — silently skip
  }
}

function showApp(user, freshLogin = false) {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("app").style.display = "block";

  const emailEl = document.getElementById("settings-email");
  if (emailEl) emailEl.textContent = user?.email || user?.name || "Developer (Dev Mode)";

  // Show profile picture if available
  const avatarUrl = user?.picture || null;
  const headerAvatar = document.getElementById("header-avatar");
  const headerAvatarIcon = document.getElementById("header-avatar-icon");
  const settingsAvatar = document.getElementById("settings-avatar");

  if (avatarUrl) {
    if (headerAvatar) {
      headerAvatar.src = avatarUrl;
      headerAvatar.style.display = "block";
    }
    if (headerAvatarIcon) headerAvatarIcon.style.display = "none";
    if (settingsAvatar) {
      settingsAvatar.src = avatarUrl;
      settingsAvatar.style.display = "block";
    }
  } else {
    if (headerAvatar) headerAvatar.style.display = "none";
    if (headerAvatarIcon) headerAvatarIcon.style.display = "block";
    if (settingsAvatar) settingsAvatar.style.display = "none";
  }

  loadAll();

  if (freshLogin) {
    // Fresh login — go to dashboard and clear any saved page
    localStorage.removeItem("gda_current_page");
    navigate("dashboard");
  } else {
    // Page refresh — restore the page the user was on
    const savedPage = localStorage.getItem("gda_current_page");
    if (savedPage && document.getElementById(`page-${savedPage}`)) {
      navigate(savedPage);
    }
  }
}

async function loadAll() {
  await Promise.allSettled([
    typeof checkHealth === "function" && checkHealth(),
    typeof loadRepositories === "function" && loadRepositories(),
    typeof loadGitHubStatus === "function" && loadGitHubStatus(),
    typeof loadDashboardStats === "function" && loadDashboardStats(),
    typeof loadHistory === "function" && loadHistory(),
  ].filter(Boolean));
}

function logout() {
  api.clearToken();
  localStorage.removeItem("gda_current_page");
  if (typeof google !== "undefined" && google.accounts?.id) {
    google.accounts.id.disableAutoSelect();
  }
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

// Page-specific fresh loaders — keyed by page ID
const PAGE_LOADERS = {
  dashboard: () => typeof loadDashboardStats === "function" && loadDashboardStats(),
  repositories: () => typeof loadRepositories === "function" && loadRepositories(),
  "git-desktop": () => typeof loadGitDesktop === "function" && loadGitDesktop(),
  debug: () => typeof populateRepoDropdowns === "function" && populateRepoDropdowns(),
  issues: () => {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
    if (typeof loadIssues === "function") loadIssues();
  },
  prs: () => {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
    if (typeof loadPRs === "function") loadPRs();
  },
  conflicts: () => {
    if (typeof populateRepoDropdowns === "function") populateRepoDropdowns();
    if (typeof loadConflictsPage === "function") loadConflictsPage();
  },
  history: () => typeof loadHistory === "function" && loadHistory(),
  settings: () => {
    if (typeof loadGitHubStatus === "function") loadGitHubStatus();
    if (typeof loadApiStatus === "function") loadApiStatus();
  },
};

function navigate(pageId) {
  window.setState("currentPage", pageId);
  localStorage.setItem("gda_current_page", pageId);

  // Update nav highlighting
  document.querySelectorAll(".header-nav-item").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-page") === pageId);
  });

  // Switch pages
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `page-${pageId}`);
  });

  // Page-specific fresh loads
  PAGE_LOADERS[pageId]?.();
}

// ============================================================
// TABS
// ============================================================

function initTabs() {
  document.querySelectorAll(".tab-item").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.getAttribute("data-tab")));
  });
}

function switchTab(tabName) {
  window.setState("activeTab", tabName);
  document.querySelectorAll(".tab-item").forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.getAttribute("data-tab") === tabName);
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
    loginError.style.display = "none";
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing In...";

    try {
      const email = document.getElementById("login-email")?.value.trim();
      const password = document.getElementById("login-password")?.value;
      const { user } = await api.login(email, password);
      showToast("Welcome back!", "success");
      showApp(user, true);
    } catch (err) {
      loginError.textContent = err.message || "Failed to sign in";
      loginError.style.display = "block";
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
    }
  });

  // Register Form
  const regForm = document.getElementById("register-form");
  const regError = document.getElementById("register-error");
  const regBtn = document.getElementById("register-btn");

  regForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    regError.style.display = "none";
    regBtn.disabled = true;
    regBtn.textContent = "Creating Account...";

    try {
      const email = document.getElementById("reg-email")?.value.trim();
      const password = document.getElementById("reg-password")?.value;
      const { user } = await api.register(email, password);
      showToast("Account created successfully!", "success");
      showApp(user, true);
    } catch (err) {
      regError.textContent = err.message || "Failed to register";
      regError.style.display = "block";
    } finally {
      regBtn.disabled = false;
      regBtn.textContent = "Create Account";
    }
  });

  // Toggle Forms
  document.getElementById("show-register-btn")?.addEventListener("click", () => {
    loginForm.style.display = "none";
    regForm.style.display = "flex";
  });

  document.getElementById("show-login-btn")?.addEventListener("click", () => {
    regForm.style.display = "none";
    loginForm.style.display = "flex";
  });

  // Debug Form
  document.getElementById("debug-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    startDebugFromForm?.();
  });

  // Folder path input Enter key
  document.getElementById("folder-path-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      browseToEnteredPath?.();
    }
  });
}

function initUserMenu() {
  document.getElementById("user-menu-btn")?.addEventListener("click", () => navigate("settings"));
}

// ============================================================
// MOBILE MENU TOGGLE
// ============================================================

function initMobileMenu() {
  const toggle = document.getElementById("mobile-nav-toggle");
  const nav = document.querySelector(".header-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    nav.classList.toggle("mobile-open");
    toggle.textContent = nav.classList.contains("mobile-open") ? "✕" : "☰";
  });

  // Close mobile menu when a nav item is clicked
  nav.querySelectorAll(".header-nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      nav.classList.remove("mobile-open");
      toggle.textContent = "☰";
    });
  });

  // Close mobile menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target) && !toggle.contains(e.target)) {
      nav.classList.remove("mobile-open");
      toggle.textContent = "☰";
    }
  });
}

// ============================================================
// SCROLL TO TOP
// ============================================================

function initScrollToTop() {
  const btn = document.getElementById("scroll-top-btn");
  if (!btn) return;

  const mainLayout = document.querySelector(".main-layout");
  const scrollTarget = mainLayout || window;

  const toggleVisibility = () => {
    const scrollTop = mainLayout ? mainLayout.scrollTop : window.scrollY;
    btn.classList.toggle("visible", scrollTop > 300);
  };

  scrollTarget.addEventListener("scroll", toggleVisibility, { passive: true });
  toggleVisibility();

  btn.addEventListener("click", () => {
    if (mainLayout) {
      mainLayout.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

// ============================================================
// MODALS & TOASTS
// ============================================================

function openModal(id) {
  document.getElementById(id).style.display = "flex";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

// Close modals when clicking overlay background
window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    e.target.style.display = "none";
  }
});

// ── Centralized data-action event delegation ─────────────────────────────────
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const { action, value } = target.dataset;

  const HANDLERS = {
    navigate: () => navigate(value),
    closeModal: () => closeModal(value),
    logout: () => logout(),
    openFolderBrowser: () => typeof openFolderBrowser === "function" && openFolderBrowser(),
    showGitHubModalFlow: () => typeof showGitHubModalFlow === "function" && showGitHubModalFlow(),
    showGitHubConnectModal: () => typeof showGitHubConnectModal === "function" && showGitHubConnectModal(),
    filterChangedFiles: () => typeof filterChangedFiles === "function" && filterChangedFiles(value),
    switchGitDesktopTab: () => typeof switchGitDesktopTab === "function" && switchGitDesktopTab(value),
    switchGitDesktopLeftTab: () => typeof switchGitDesktopLeftTab === "function" && switchGitDesktopLeftTab(value),
    openCurrentFileInOs: () => typeof openCurrentFileInOs === "function" && openCurrentFileInOs(value),
    loadIssues: () => typeof loadIssues === "function" && loadIssues(),
    filterGitHubRepos: () => typeof filterGitHubRepos === "function" && filterGitHubRepos(),
    generateAutoCommitMessage: () => typeof generateAutoCommitMessage === "function" && generateAutoCommitMessage(value === "true"),
    commitFromGitDesktop: () => typeof commitFromGitDesktop === "function" && commitFromGitDesktop(),
    triggerAIAnalyzeChanges: () => typeof triggerAIAnalyzeChanges === "function" && triggerAIAnalyzeChanges(),
    triggerAICommitAll: () => typeof triggerAICommitAll === "function" && triggerAICommitAll(),
    openPushPreviewModal: () => typeof openPushPreviewModal === "function" && openPushPreviewModal(),
    openBranchSwitcherModal: () => typeof openBranchSwitcherModal === "function" && openBranchSwitcherModal(),
    triggerGitFetch: () => typeof triggerGitFetch === "function" && triggerGitFetch(),
    triggerGitPull: () => typeof triggerGitPull === "function" && triggerGitPull(),
    triggerGitSync: () => typeof triggerGitSync === "function" && triggerGitSync(),
    triggerAIShip: () => typeof triggerAIShip === "function" && triggerAIShip(),
    setDebugExample: () => typeof setDebugExample === "function" && setDebugExample(value),
    connectCurrentBrowsedFolder: () => typeof connectCurrentBrowsedFolder === "function" && connectCurrentBrowsedFolder(),
    browseToEnteredPath: () => typeof browseToEnteredPath === "function" && browseToEnteredPath(),
    connectEnteredPath: () => typeof connectEnteredPath === "function" && connectEnteredPath(),
    connectGitHub: () => typeof connectGitHub === "function" && connectGitHub(),
    connectGitHubFromModal: () => typeof connectGitHubFromModal === "function" && connectGitHubFromModal(),
    disconnectGitHub: () => typeof disconnectGitHub === "function" && disconnectGitHub(),
    loadApiStatus: () => typeof loadApiStatus === "function" && loadApiStatus(),
    startDebugFromForm: () => typeof startDebugFromForm === "function" && startDebugFromForm(),
    exitDebugSession: () => typeof exitDebugSession === "function" && exitDebugSession(),
    abortCurrentSession: () => typeof abortCurrentSession === "function" && abortCurrentSession(),
    applyFix: () => typeof applyFix === "function" && applyFix(),
    revertFix: () => typeof revertFix === "function" && revertFix(),
    requestDetails: () => typeof requestDetails === "function" && requestDetails(),
    rejectFix: () => typeof rejectFix === "function" && rejectFix(),
    triggerNativeFolderPicker: () => typeof triggerNativeFolderPicker === "function" && triggerNativeFolderPicker(),
    onPushTargetBranchChanged: () => typeof onPushTargetBranchChanged === "function" && onPushTargetBranchChanged(),
    executePushFromModal: () => typeof executePushFromModal === "function" && executePushFromModal(),
    createAndCheckoutBranch: () => typeof createAndCheckoutBranch === "function" && createAndCheckoutBranch(),
    filterBranchList: () => typeof filterBranchList === "function" && filterBranchList(),
    indexRepo: () => typeof indexRepo === "function" && indexRepo(value),
    checkHealth: () => typeof checkHealth === "function" && checkHealth(),
    openActiveRepoPicker: () => typeof openActiveRepoPicker === "function" && openActiveRepoPicker(),
    openCreatePRModal: () => typeof openCreatePRModal === "function" && openCreatePRModal(value),
    resolveConflicts: () => typeof resolveConflicts === "function" && resolveConflicts(value),
    triggerResolveAllConflicts: () => typeof triggerResolveAllConflicts === "function" && triggerResolveAllConflicts(),
    loadConflictsPage: () => typeof loadConflictsPage === "function" && loadConflictsPage(),
    loadPRs: () => typeof loadPRs === "function" && loadPRs(),
    submitCreatePR: () => typeof submitCreatePR === "function" && submitCreatePR(),
    saveAgentConfig: () => typeof saveAgentConfig === "function" && saveAgentConfig(),
    commitAndPushFix: () => typeof commitAndPushFix === "function" && commitAndPushFix(),
    quickDebugRepo: () => typeof quickDebugRepo === "function" && quickDebugRepo(value),
    editGroupCommitMessage: () => typeof editGroupCommitMessage === "function" && editGroupCommitMessage(value),
    previewGroupDiff: () => typeof previewGroupDiff === "function" && previewGroupDiff(value),
    executeCommitPlanAll: () => typeof executeCommitPlanAll === "function" && executeCommitPlanAll(),
  };

  // Delegate to view-specific handlers first, fall back to centralized handlers
  HANDLERS[action]?.();
});

// ── Centralized data-action change delegation (select elements) ──────────────
document.addEventListener("change", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const { action } = target.dataset;

  const CHANGE_HANDLERS = {
    loadIssues: () => typeof loadIssues === "function" && loadIssues(),
    loadPRs: () => typeof loadPRs === "function" && loadPRs(),
    loadConflictsPage: () => typeof loadConflictsPage === "function" && loadConflictsPage(),
    onPushTargetBranchChanged: () => typeof onPushTargetBranchChanged === "function" && onPushTargetBranchChanged(),
  };

  CHANGE_HANDLERS[action]?.();
});

// ── Centralized data-action input delegation (search inputs) ─────────────────
document.addEventListener("input", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const { action } = target.dataset;

  const INPUT_HANDLERS = {
    filterBranchList: () => typeof filterBranchList === "function" && filterBranchList(),
    filterGitHubRepos: () => typeof filterGitHubRepos === "function" && filterGitHubRepos(),
  };

  INPUT_HANDLERS[action]?.();
});

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = { success: "✓", error: "⚠️", info: "ℹ️" };
  toast.textContent = `${icons[type] ?? icons.info} ${message}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ============================================================
// UTILITIES
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  if (str == null) return "";
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

// ============================================================
// GLOBAL WINDOW EXPORTS
// ============================================================

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
