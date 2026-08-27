import type { TenantContext } from "../security/tenant-context.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      tenantContext?: TenantContext;
    }
  }
}

export {};
