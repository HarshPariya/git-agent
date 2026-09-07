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
  default: "repository:read",
};

export function getPermissionFromPath(
  path: string,
  method: string,
): Permission {
  const key = `${method.toUpperCase()}:${
    path.split("/").filter(Boolean).pop() || "unknown"
  }`;
  const permission = pathMethodToPermission[key];
  if (permission !== undefined) return permission;
  return "repository:read";
}
