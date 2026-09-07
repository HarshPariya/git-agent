import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import type { AuditEntry } from "../types/git.js";
import crypto from "node:crypto";

const auditLog: AuditEntry[] = [];

export function recordAuditEntry(
  entry: Omit<AuditEntry, "id" | "timestamp">,
): void {
  const auditEntry: AuditEntry = {
    ...entry,
    id: `audit-${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
  };
  auditLog.push(auditEntry);
}

export async function getAuditLogHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const { searchParams } = new URL(request.url ?? "", "http://localhost");
    const repoId = searchParams.get("repositoryId");
    const category = searchParams.get("category");
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    let entries = auditLog.filter((e) => e.tenantId === context.tenantId);

    if (repoId) {
      entries = entries.filter((e) => e.repositoryId === repoId);
    }

    if (category) {
      entries = entries.filter((e) => e.category === category);
    }

    entries = entries
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    response.status(200).json(entries);
  } catch (error) {
    next(error);
  }
}

export async function getAuditEntryHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const { id } = request.params;
    const entry = auditLog.find((e) => e.id === id);

    if (!entry) {
      throw new AppError("Audit entry not found", "NOT_FOUND", 404);
    }

    if (entry.tenantId !== context.tenantId) {
      throw new AppError(
        "Unauthorized access to audit log",
        "AUTHORIZATION_ERROR",
        403,
      );
    }

    response.status(200).json(entry);
  } catch (error) {
    next(error);
  }
}
