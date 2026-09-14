export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
}

export type Role = "user" | "developer" | "admin" | "superadmin" | "viewer";

export type Permission =
  | "repository:read"
  | "repository:write"
  | "repository:ci"
  | "repository:pr"
  | "repository:debug"
  | "repository:audit"
  | "graphrag:read"
  | "graphrag:write";

export interface AuthorizeRequest {
  readonly context: TenantContext;
  readonly role: string;
  readonly permission: Permission;
}

export interface RateLimitState {
  readonly count: number;
  readonly resetAt: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}
