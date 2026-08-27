import type { TenantContext } from "./tenant-context.js";

export type Permission =
  | "chat:read"
  | "chat:write"
  | "documents:read"
  | "documents:write";

const rolePermissions: Readonly<Record<string, readonly Permission[]>> = {
  user: ["chat:read", "chat:write"],
  admin: ["chat:read", "chat:write", "documents:read", "documents:write"],
};

export interface AuthorizationRequest {
  readonly context: TenantContext;
  readonly role: string;
  readonly permission: Permission;
}

export const authorize = ({
  role,
  permission,
}: AuthorizationRequest): boolean =>
  rolePermissions[role]?.includes(permission) ?? false;
