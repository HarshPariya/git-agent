import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { workspaceStore } from "../services/workspace-service.js";

export async function listWorkspacesHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) {
      throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
    }

    const workspaces = workspaceStore.listWorkspaces(context.tenantId, context.userId);
    response.status(200).json({ workspaces });
  } catch (error) {
    next(error);
  }
}

export async function createWorkspaceHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) {
      throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
    }

    const { name, mode, localPath, permissions } = request.body || {};

    const workspace = workspaceStore.createWorkspace({
      tenantId: context.tenantId,
      userId: context.userId,
      name: typeof name === "string" ? name : "My Project Workspace",
      mode: mode === "local-connector" ? "local-connector" : "cloud",
      localPath: typeof localPath === "string" ? localPath : undefined,
      permissions: Array.isArray(permissions) ? permissions : undefined,
    });

    response.status(201).json({ workspace });
  } catch (error) {
    next(error);
  }
}

export async function getWorkspaceHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) {
      throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
    }

    const id = request.params.id as string;
    const workspace = workspaceStore.getWorkspace(id, context.tenantId);
    if (!workspace) {
      throw new AppError("Workspace not found", "NOT_FOUND", 404);
    }

    response.status(200).json({ workspace });
  } catch (error) {
    next(error);
  }
}

export async function deleteWorkspaceHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) {
      throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
    }

    const id = request.params.id as string;
    const deleted = workspaceStore.deleteWorkspace(id, context.tenantId);
    if (!deleted) {
      throw new AppError("Workspace not found", "NOT_FOUND", 404);
    }

    response.status(200).json({ message: "Workspace deleted successfully", id });
  } catch (error) {
    next(error);
  }
}
