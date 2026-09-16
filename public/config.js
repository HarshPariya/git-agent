/**
 * Git Debugging Agent - Client Configuration
 * 
 * Set window.__API_BASE__ to your Render backend URL if deploying frontend on Vercel
 * and you want direct browser-to-backend communication.
 * Example:
 *   window.__API_BASE__ = "https://git-agent-backend.onrender.com";
 * 
 * If left as "" (empty string):
 *   - Local development uses http://localhost:3000
 *   - Vercel deployments can use Vercel Rewrites in vercel.json
 */
// Intelligent API resolution:
// If running on localhost / 127.0.0.1, use local backend (empty string -> relative path)
// If running on Vercel or production domain, use the configured Render backend URL
(() => {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      !window.location.hostname);

  const customBase = typeof window !== "undefined" ? localStorage.getItem("gda_api_base") : null;

  if (customBase) {
    window.__API_BASE__ = customBase.replace(/\/$/, "");
  } else if (isLocalhost) {
    window.__API_BASE__ = "";
  } else {
    window.__API_BASE__ = window.__API_BASE__ || "https://git-agent-backend-jsog.onrender.com";
  }
})();
