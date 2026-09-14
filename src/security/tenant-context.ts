import type { TenantContext } from "../types/security.js";

export type { TenantContext };

export const createTenantContext = (tenantId: string, userId: string): TenantContext => {
  const normalizedTenantId = tenantId.trim();
  const normalizedUserId = userId.trim();

  if (!normalizedTenantId || !normalizedUserId) {
    throw new Error("Invalid tenant context");
  }

  return Object.freeze({
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
  });
};
