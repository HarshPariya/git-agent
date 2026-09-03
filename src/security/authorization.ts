import type {
  AuthorizeRequest,
  Permission,
  Role,
  TenantContext,
} from "../types/security.js";

export type { AuthorizeRequest, Permission, Role, TenantContext };
export type AuthorizationRequest = AuthorizeRequest;

const rolePermissions: Readonly<Record<string, readonly Permission[]>> = {
  user: ["chat:read", "chat:write", "workspace:read", "workspace:write", "connector:read", "connector:write"],
  developer: ["chat:read", "chat:write", "documents:read", "documents:write", "workspace:read", "workspace:write", "connector:read", "connector:write"],
  admin: ["chat:read", "chat:write", "documents:read", "documents:write", "workspace:read", "workspace:write", "connector:read", "connector:write"],
  superadmin: ["chat:read", "chat:write", "documents:read", "documents:write", "workspace:read", "workspace:write", "connector:read", "connector:write"],
  viewer: ["chat:read", "workspace:read", "documents:read"],
};

export const authorize = ({
  role,
  permission,
}: AuthorizeRequest): boolean =>
  rolePermissions[role]?.includes(permission) ?? false;
