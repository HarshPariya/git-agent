export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
}

export type Role = "user" | "developer" | "admin" | "superadmin" | "viewer";

export type Permission =
  | "chat:read"
  | "chat:write"
  | "documents:read"
  | "documents:write"
  | "workspace:read"
  | "workspace:write"
  | "connector:read"
  | "connector:write";

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
