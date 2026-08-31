import type {
  AuthorizeRequest,
  Permission,
  Role,
  TenantContext,
} from "../types/security.js";

export type { AuthorizeRequest, Permission, Role, TenantContext };
export type AuthorizationRequest = AuthorizeRequest;

const rolePermissions: Readonly<Record<string, readonly Permission[]>> = {
  user: ["chat:read", "chat:write"],
  admin: ["chat:read", "chat:write", "documents:read", "documents:write"],
};

export const authorize = ({
  role,
  permission,
}: AuthorizeRequest): boolean =>
  rolePermissions[role]?.includes(permission) ?? false;
