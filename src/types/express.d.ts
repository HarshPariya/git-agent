import type { TenantContext } from "./security.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      tenantContext?: TenantContext;
      /** Sanitized absolute path to the user's local workspace (from x-workspace-root header). Falls back to process.cwd(). */
      workspaceRoot?: string;
      /** Active project workspace ID (from x-workspace-id header or body) */
      workspaceId?: string;
    }
  }
}

export { };
