import type { TenantContext } from "./security.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      tenantContext?: TenantContext;
      workspaceRoot?: string;
      workspaceId?: string;
    }
  }
}

export { };
