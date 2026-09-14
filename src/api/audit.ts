import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import type { AuditEntry } from "../types/git.js";
import crypto from "node:crypto";

const auditLog: AuditEntry[] = [];

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const parseQueryParams = (url: string) => {
  const { searchParams } = new URL(url, "http://localhost");
  return {
    repoId: searchParams.get("repositoryId"),
    category: searchParams.get("category"),
    limit: parseInt(searchParams.get("limit") ?? "50", 10),
  };
};

export function recordAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp">): void {
  auditLog.push({
    ...entry,
    id: `audit-${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
  });
}

export function getAuditLogHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const { repoId, category, limit } = parseQueryParams(request.url ?? "");

    const entries = auditLog
      .filter((e) => e.tenantId === context.tenantId)
      .filter((e) => !repoId || e.repositoryId === repoId)
      .filter((e) => !category || e.category === category)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    response.status(200).json(entries);
  } catch (error) {
    next(error);
  }
}

export function getAuditEntryHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const { id } = request.params;

    const entry = auditLog.find((e) => e.id === id);
    if (!entry) throw new AppError("Audit entry not found", "NOT_FOUND", 404);
    if (entry.tenantId !== context.tenantId) throw new AppError("Unauthorized access to audit log", "AUTHORIZATION_ERROR", 403);

    response.status(200).json(entry);
  } catch (error) {
    next(error);
  }
}
