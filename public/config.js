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
window.__API_BASE__ = window.__API_BASE__ || "https://git-agent-backend-jsog.onrender.com";
