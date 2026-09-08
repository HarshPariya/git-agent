import type { Permission } from "../types/security.js";

const pathMethodToPermission: Record<string, Permission> = {
  "GET:repository": "repository:read",
  "POST:repository": "repository:write",
  "GET:repository/status": "repository:read",
  "POST:repository/status": "repository:read",
  "GET:graphrag": "graphrag:read",
  "POST:graphrag": "graphrag:write",
  "GET:ci": "repository:ci",
  "POST:ci": "repository:ci",
  "GET:pr": "repository:pr",
  "POST:pr": "repository:pr",
  "GET:conflicts": "repository:read",
  "POST:conflicts": "repository:read",
  "GET:changes": "repository:read",
  "POST:changes": "repository:read",
  "GET:debug": "repository:debug",
  "POST:debug": "repository:debug",
  "GET:history": "repository:read",
  "POST:history": "repository:read",
  "GET:settings": "repository:read",
  "POST:settings": "repository:read",
  "GET:audit": "repository:audit",
  "POST:audit": "repository:audit",
};

const DEFAULT_PERMISSION: Permission = "repository:read";

export const getPermissionFromPath = (path: string, method: string): Permission => {
  const segments = path.split("/").filter(Boolean);
  const resource = segments.at(-1) ?? "unknown";
  return pathMethodToPermission[`${method.toUpperCase()}:${resource}`] ?? DEFAULT_PERMISSION;
};
