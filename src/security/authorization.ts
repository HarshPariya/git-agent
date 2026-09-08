import type {
  AuthorizeRequest,
  Permission,
  Role,
  TenantContext,
} from "../types/security.js";

export type { AuthorizeRequest, Permission, Role, TenantContext };
export type AuthorizationRequest = AuthorizeRequest;

const rolePermissions: Readonly<Record<string, readonly Permission[]>> = {
  viewer: ["repository:read", "graphrag:read"],
  user: [
    "repository:read", "repository:write", "repository:debug",
    "graphrag:read", "graphrag:write",
  ],
  developer: [
    "repository:read", "repository:write", "repository:ci", "repository:pr",
    "repository:debug", "repository:audit", "graphrag:read", "graphrag:write",
  ],
  admin: [
    "repository:read", "repository:write", "repository:ci", "repository:pr",
    "repository:debug", "repository:audit", "graphrag:read", "graphrag:write",
  ],
  superadmin: [
    "repository:read", "repository:write", "repository:ci", "repository:pr",
    "repository:debug", "repository:audit", "graphrag:read", "graphrag:write",
  ],
};

export const authorize = ({
  role,
  permission,
}: AuthorizeRequest): boolean =>
  rolePermissions[role]?.includes(permission) ?? false;
