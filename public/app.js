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
  // Attempt to render Google button immediately; if GSI not loaded yet, set up pending init
  initGoogleSignIn();
}

// Wait (with a deadline) for the Google Identity Services script to load.
// The script is injected with async defer, so it may still be downloading
// when showAuth() runs — without this, initGoogleSignIn() would give up
// because `google` is undefined yet and the button would never render.
function waitForGoogleScript(timeoutMs) {
  return new Promise((resolve) => {
    if (typeof google !== "undefined" && google.accounts?.id) {
      resolve(true);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (typeof google !== "undefined" && google.accounts?.id) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function _startGoogleFlow(clientId) {
  if (typeof google === "undefined" || !google.accounts || !google.accounts.id) {
    window._pendingGoogleInit = () => _doInitGoogleSignIn(clientId);
    waitForGoogleScript(10000).then((ok) => {
      if (ok && !googleSignInReady) _doInitGoogleSignIn(clientId);
    });
    return;
  }
  _doInitGoogleSignIn(clientId);
}

async function initGoogleSignIn() {
  const cached = localStorage.getItem("gda_google_client_id");
  if (cached) {
    _startGoogleFlow(cached);
  }

  try {
    const { clientId } = await api.getGoogleClientId();
    if (!clientId) return;
    localStorage.setItem("gda_google_client_id", clientId);
    if (!cached || cached !== clientId) {
      _startGoogleFlow(clientId);
    }
  } catch {
    // Google Sign-In not configured or unavailable — silently skip
  }
}

function _doInitGoogleSignIn(clientId) {
  try {
    if (googleSignInReady) {
      // Already initialized — re-render button if container is now visible
      const container = document.getElementById("google-signin-btn");
      if (container && container.offsetWidth > 0) {
        container.innerHTML = "";
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: Math.min(container.offsetWidth || 320, 400),
          text: "continue_with",
          locale: "en",
        });
      }
      return;
    }

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
    window._pendingGoogleInit = null;

    const container = document.getElementById("google-signin-btn");
    if (container) {
      // Wait for container to be in DOM and have width
      const renderBtn = () => {
        container.innerHTML = "";
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: Math.min(container.offsetWidth || 320, 400),
          text: "continue_with",
          locale: "en",
        });
      };
      if (container.offsetWidth > 0) {
        renderBtn();
      } else {
        // Container not visible yet — wait for layout paint
        requestAnimationFrame(() => {
          requestAnimationFrame(renderBtn);
        });
        setTimeout(renderBtn, 150);
        setTimeout(renderBtn, 500);
      }
    }
  } catch {
    // Silently skip
  }
}


function showApp(user, freshLogin = false) {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("app").style.display = "block";

  const emailEl = document.getElementById("settings-email");
  if (emailEl) emailEl.textContent = user?.email || user?.name || "Developer (Dev Mode)";

  // Settings page: show admin-specific info
  const accountTitle = document.getElementById("settings-account-title");
  const roleBadge = document.getElementById("settings-role-badge");
  const isAdmin = user?.role === "admin";
  if (accountTitle) accountTitle.textContent = isAdmin ? "Admin Account" : "User Account";
  if (roleBadge) {
    if (isAdmin) {
      roleBadge.style.display = "inline-flex";
      roleBadge.className = "settings-role-badge admin";
      roleBadge.textContent = "★ Administrator";
    } else {
      roleBadge.style.display = "inline-flex";
      roleBadge.className = "settings-role-badge developer";
      roleBadge.textContent = user?.role || "Developer";
    }
  }

  // Show profile picture if available
  const avatarUrl = user?.picture || null;
  const headerAvatar = document.getElementById("header-avatar");
  const headerAvatarIcon = document.getElementById("header-avatar-icon");
  const settingsAvatar = document.getElementById("settings-avatar");

  if (avatarUrl) {
    if (headerAvatar) {
      headerAvatar.src = avatarUrl;
      headerAvatar.style.display = "block";
      headerAvatar.onerror = () => {
        headerAvatar.style.display = "none";
        if (headerAvatarIcon) headerAvatarIcon.style.display = "block";
      };
    }
    if (headerAvatarIcon) headerAvatarIcon.style.display = "none";
    if (settingsAvatar) {
      settingsAvatar.src = avatarUrl;
      settingsAvatar.style.display = "block";
      settingsAvatar.onerror = () => {
        settingsAvatar.style.display = "none";
      };
    }
  } else {
    if (headerAvatar) headerAvatar.style.display = "none";
    if (headerAvatarIcon) headerAvatarIcon.style.display = "block";
    if (settingsAvatar) settingsAvatar.style.display = "none";
  }

  // Show Admin nav item only for admin users, User Panel nav for non-admin users
  const adminNav = document.getElementById("nav-admin");
  const adminPage = document.getElementById("page-admin");
  const userPanelNav = document.getElementById("nav-user-panel");
  const userPanelPage = document.getElementById("page-user-panel");
  if (adminNav) adminNav.style.display = isAdmin ? "" : "none";
  if (adminPage) adminPage.style.display = isAdmin ? "" : "none";
  if (userPanelNav) userPanelNav.style.display = isAdmin ? "none" : "";
  if (userPanelPage) userPanelPage.style.display = isAdmin ? "none" : "";

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
// USER / DEVELOPER PANEL
// ============================================================

const ACTIVITY_LABELS_APP = {
  "auth:login": "🔑 Login",
  "auth:register": "📝 Register",
  "auth:google-login": "🔵 Google Login",
  "git:commit": "💾 Git Commit",
  "git:push": "⬆ Git Push",
  "git:pull": "⬇ Git Pull",
  "git:fetch": "🔄 Git Fetch",
  "git:checkout": "🔀 Git Checkout",
  "git:sync": "🔄 Git Sync",
  "git:ship": "🚀 Git Ship",
  "git:analyze-changes": "🔍 Analyze Changes",
  "git:commit-plan-execute": "📋 Commit Plan",
  "git:commit-all": "💾 Commit All",
  "git:generate-message": "💬 Generate Message",
  "git:resolve-conflicts": "🔧 Resolve Conflicts",
  "debug:run": "🐛 Debug Run",
  "debug:start": "🐛 Debug Start",
  "debug:complete": "✅ Debug Complete",
  "debug:abort": "🚫 Debug Abort",
  "debug:approve-fix": "👍 Approve Fix",
  "debug:revert-fix": "↩ Revert Fix",
  "debug:classify": "🏷 Classify",
  "debug:plan": "📋 Plan",
  "debug:execute-step": "▶ Execute Step",
  "repo:connect": "🔗 Repo Connect",
  "repo:disconnect": "🔗 Repo Disconnect",
  "repo:sync": "🔄 Repo Sync",
  "graphrag:index": "📚 GraphRAG Index",
  "graphrag:search": "🔍 GraphRAG Search",
  "github:connect": "🐙 GitHub Connect",
  "ci:trigger": "🔨 CI Trigger",
  "pr:create": "🔃 PR Create",
};

function formatTimestampApp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

async function loadUserPanel() {
  const listEl = document.getElementById("user-activity-list");
  const greetingEl = document.getElementById("user-panel-greeting");
  const subtitleEl = document.getElementById("user-panel-subtitle");

  // Try to get user info from the current state
  const user = window.state?.user;
  if (greetingEl) greetingEl.textContent = `Welcome back, ${user?.name || user?.email?.split("@")[0] || "Developer"}`;
  if (subtitleEl) subtitleEl.textContent = `Here's an overview of your activity on the platform`;

  if (!listEl) return;

  try {
    const result = await window.api.userMyActivity({ limit: 50 });
    const entries = result.entries ?? [];

    if (entries.length === 0) {
      listEl.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-icon">📊</div><div class="admin-empty-text">No activity recorded yet. Start using the platform to see your activity here.</div></div>';
      return;
    }

    listEl.innerHTML = entries.map((entry) => {
      const label = ACTIVITY_LABELS_APP[entry.action] || entry.action;
      const details = entry.details ? Object.entries(entry.details).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
      return `<div class="user-activity-item">
        <div class="user-activity-icon">${label.split(" ")[0]}</div>
        <div class="user-activity-info">
          <div class="user-activity-action">${label.split(" ").slice(1).join(" ") || label}</div>
          <div class="user-activity-meta">${details ? escapeHtmlApp(details) : "No details"}</div>
        </div>
        <div class="user-activity-time">${formatTimestampApp(entry.timestamp)}</div>
      </div>`;
    }).join("");
  } catch (err) {
    listEl.innerHTML = `<div class="admin-empty-state"><div class="admin-empty-icon">⚠️</div><div class="admin-empty-text">Failed to load activity: ${escapeHtmlApp(err.message || "unknown error")}</div></div>`;
  }
}

function escapeHtmlApp(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
    if (typeof initSettingsView === "function") initSettingsView();
  },
  admin: () => typeof loadAdminPanel === "function" && loadAdminPanel(),
  "user-panel": () => typeof loadUserPanel === "function" && loadUserPanel(),
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
  const backdrop = document.getElementById("mobile-nav-backdrop");
  if (!toggle || !nav) return;

  function closeMenu() {
    nav.classList.remove("mobile-open");
    toggle.textContent = "☰";
    toggle.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.classList.remove("active");
  }

  function openMenu() {
    nav.classList.add("mobile-open");
    toggle.textContent = "✕";
    toggle.setAttribute("aria-expanded", "true");
    if (backdrop) backdrop.classList.add("active");
  }

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (nav.classList.contains("mobile-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  if (backdrop) {
    backdrop.addEventListener("click", closeMenu);
  }

  // Close mobile menu when any nav item is clicked
  nav.querySelectorAll(".header-nav-item").forEach((item) => {
    item.addEventListener("click", closeMenu);
  });

  // Close mobile menu on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("mobile-open")) {
      closeMenu();
    }
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (nav.classList.contains("mobile-open") && !nav.contains(e.target) && !toggle.contains(e.target)) {
      closeMenu();
    }
  });

  // Clean up on desktop resize
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900 && nav.classList.contains("mobile-open")) {
      closeMenu();
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
    refreshGitDesktop: () => typeof refreshGitDesktop === "function" ? refreshGitDesktop() : (typeof loadGitDesktop === "function" && loadGitDesktop(true)),
    commitFromGitDesktop: () => typeof commitFromGitDesktop === "function" && commitFromGitDesktop(),
    triggerAIAnalyzeChanges: () => typeof triggerAIAnalyzeChanges === "function" && triggerAIAnalyzeChanges(),
    triggerAICommitAll: () => typeof triggerAICommitAll === "function" && triggerAICommitAll(),
    openPushPreviewModal: () => typeof openPushPreviewModal === "function" && openPushPreviewModal(),
    openBranchSwitcherModal: () => typeof openBranchSwitcherModal === "function" && openBranchSwitcherModal(),
    triggerGitFetch: () => typeof triggerGitFetch === "function" && triggerGitFetch(),
    triggerGitPull: () => typeof triggerGitPull === "function" && triggerGitPull(),
    triggerGitSync: () => typeof triggerGitSync === "function" && triggerGitSync(),
    triggerAIShip: () => typeof triggerAIShip === "function" && triggerAIShip(),
    triggerGitStash: () => typeof triggerGitStash === "function" && triggerGitStash(),
    triggerGitStashPop: () => typeof triggerGitStashPop === "function" && triggerGitStashPop(),
    discardGitChanges: () => typeof discardGitChanges === "function" && discardGitChanges(value || target?.dataset?.path),
    discardAllGitChanges: () => typeof discardAllGitChanges === "function" && discardAllGitChanges(),
    linkLocalFolderToGitDesktop: () => typeof linkLocalFolderToGitDesktop === "function" && linkLocalFolderToGitDesktop(),
    openGitDesktopFileEditor: () => typeof openGitDesktopFileEditor === "function" && openGitDesktopFileEditor(value || target?.dataset?.path),
    saveGitDesktopFile: () => typeof saveGitDesktopFile === "function" && saveGitDesktopFile(),
    openSpecificFileInOs: () => typeof openSpecificFileInOs === "function" && openSpecificFileInOs(value, target?.dataset?.mode || "reveal"),
    viewGitDesktopDiff: () => typeof viewGitDesktopDiff === "function" && viewGitDesktopDiff(value),
    deleteLocalBranch: () => typeof deleteLocalBranch === "function" && deleteLocalBranch(value),
    checkoutSelectedBranch: () => typeof checkoutSelectedBranch === "function" && checkoutSelectedBranch(value),
    setDebugExample: () => typeof setDebugExample === "function" && setDebugExample(value),
    connectCurrentBrowsedFolder: () => typeof connectCurrentBrowsedFolder === "function" && connectCurrentBrowsedFolder(),
    connectWorkspaceFolder: () => typeof connectWorkspaceFolder === "function" && connectWorkspaceFolder(),
    toggleFileStaging: () => typeof toggleFileStaging === "function" && toggleFileStaging(target.dataset.path, target),
    toggleAllStaging: () => typeof toggleAllStaging === "function" && toggleAllStaging(target),
    browseToEnteredPath: () => typeof browseToEnteredPath === "function" && browseToEnteredPath(),
    connectEnteredPath: () => typeof connectEnteredPath === "function" && connectEnteredPath(),
    connectGitHub: () => typeof connectGitHub === "function" && connectGitHub(),
    connectGitHubFromModal: () => typeof connectGitHubFromModal === "function" && connectGitHubFromModal(),
    disconnectGitHub: () => typeof disconnectGitHub === "function" && disconnectGitHub(),
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
    saveBackendConfig: () => typeof saveBackendConfig === "function" && saveBackendConfig(),
    testBackendConnection: () => typeof testBackendConnection === "function" && testBackendConnection(),
    commitAndPushFix: () => typeof commitAndPushFix === "function" && commitAndPushFix(),
    quickDebugRepo: () => typeof quickDebugRepo === "function" && quickDebugRepo(value),
    editGroupCommitMessage: () => typeof editGroupCommitMessage === "function" && editGroupCommitMessage(value),
    previewGroupDiff: () => typeof previewGroupDiff === "function" && previewGroupDiff(value),
    executeCommitPlanAll: () => typeof executeCommitPlanAll === "function" && executeCommitPlanAll(),
    adminRefreshUsers: () => typeof loadAdminPanel === "function" && loadAdminPanel(),
    adminRefreshActivity: () => typeof loadAdminPanel === "function" && loadAdminPanel(),
    adminViewUser: () => typeof adminViewUser === "function" && adminViewUser(value),
    adminCloseDetail: () => { const d = document.getElementById("admin-user-detail-overlay"); if (d) d.style.display = "none"; },
    adminViewActivity: () => typeof adminViewActivity === "function" && adminViewActivity(value),
    adminCloseActivityDetail: () => { const d = document.getElementById("admin-activity-detail-overlay"); if (d) d.style.display = "none"; },
    userRefreshActivity: () => typeof loadUserPanel === "function" && loadUserPanel(),
  };

  // Delegate to view-specific handlers first, fall back to centralized handlers or window methods
  if (typeof HANDLERS[action] === "function") {
    HANDLERS[action]();
  } else if (typeof window[action] === "function") {
    window[action](value, target);
  }
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
  const iconSpan = document.createElement("span");
  iconSpan.style.fontSize = "15px";
  iconSpan.style.flexShrink = "0";
  iconSpan.textContent = icons[type] ?? icons.info;

  const msgSpan = document.createElement("span");
  msgSpan.className = "toast-message";
  msgSpan.textContent = String(message ?? "");

  const closeBtn = document.createElement("span");
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.innerHTML = "&times;";

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  // Errors stay visible for 12 seconds so users have enough time to read & inspect; others for 4.5s
  const duration = type === "error" ? 12000 : 4500;
  let remainingMs = duration;
  let timerStart = Date.now();
  let timerId = null;

  const dismiss = () => {
    if (timerId) clearTimeout(timerId);
    toast.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 220);
  };

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  const startTimer = (ms) => {
    timerStart = Date.now();
    timerId = setTimeout(dismiss, ms);
  };

  toast.addEventListener("mouseenter", () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
      remainingMs -= Date.now() - timerStart;
    }
  });

  toast.addEventListener("mouseleave", () => {
    startTimer(Math.max(remainingMs, 1000));
  });

  startTimer(duration);
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
