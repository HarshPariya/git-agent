import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../errors/app-error.js";
import { repositoryStore } from "../../repositories/repository-store.js";
import { verifySessionToken } from "../../security/auth.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

import { ADMIN_EMAILS } from "../../security/auth.js";

const isRequestAdmin = (request: Request): boolean => {
  const authHeader = request.header("authorization")?.trim();
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (token) {
    try {
      const session = verifySessionToken(token);
      if (session.role === "admin" && ADMIN_EMAILS.has(session.email?.toLowerCase() ?? "")) return true;
    } catch {
      // Invalid token
    }
  }
  return false;
};

export const listRepositoriesHandler = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const context = getTenantContext(request);
    const isAdmin = isRequestAdmin(request);
    const repositories = await repositoryStore.listRepositories(
      isAdmin ? undefined : context.tenantId,
      isAdmin ? undefined : context.userId,
    );
    response.status(200).json({ repositories });
  } catch (error) {
    next(error);
  }
};
