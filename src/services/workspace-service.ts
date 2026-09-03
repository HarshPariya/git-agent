import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";

export type WorkspaceMode = "cloud" | "local-connector";
export type WorkspaceStatus = "active" | "paired" | "offline" | "revoked";

export interface Workspace {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly mode: WorkspaceMode;
  readonly localPath?: string | undefined;
  readonly deviceToken?: string | undefined;
  readonly status: WorkspaceStatus;
  readonly permissions: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class WorkspaceStore {
  private readonly workspaces = new Map<string, Workspace>();

  constructor() {
    this.seedDefaultWorkspaces();
  }

  private seedDefaultWorkspaces(): void {
    const defaultWs: Workspace = {
      id: "ws-default-cloud",
      tenantId: "tenant-enterprise",
      userId: "user-admin-1",
      name: "Default Cloud Workspace",
      mode: "cloud",
      localPath: process.cwd(),
      status: "active",
      permissions: ["read", "write", "delete", "git", "command", "knowledge"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.workspaces.set(defaultWs.id, defaultWs);
  }

  createWorkspace(params: {
    tenantId: string;
    userId: string;
    name: string;
    mode?: WorkspaceMode | undefined;
    localPath?: string | undefined;
    permissions?: string[] | undefined;
  }): Workspace {
    const name = params.name.trim();
    if (!name) {
      throw new AppError("Workspace name is required", "VALIDATION_ERROR", 400);
    }

    const id = "ws-" + crypto.randomUUID().substring(0, 8);
    const mode = params.mode || "cloud";
    const status: WorkspaceStatus = mode === "local-connector" ? "offline" : "active";

    const workspace: Workspace = {
      id,
      tenantId: params.tenantId,
      userId: params.userId,
      name,
      mode,
      localPath: params.localPath?.trim(),
      status,
      permissions: params.permissions || ["read", "write", "delete", "git", "command", "knowledge"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.workspaces.set(id, workspace);
    return workspace;
  }

  listWorkspaces(tenantId: string, userId?: string): readonly Workspace[] {
    const list: Workspace[] = [];
    for (const ws of this.workspaces.values()) {
      if (ws.tenantId === tenantId) {
        if (!userId || ws.userId === userId || ws.userId === "user-admin-1") {
          list.push(ws);
        }
      }
    }
    return list;
  }

  getWorkspace(id: string, tenantId?: string): Workspace | undefined {
    const ws = this.workspaces.get(id);
    if (!ws) return undefined;
    if (tenantId && ws.tenantId !== tenantId) return undefined;
    return ws;
  }

  updateWorkspace(id: string, tenantId: string, updates: Partial<Pick<Workspace, "name" | "status" | "localPath" | "deviceToken" | "mode">>): Workspace {
    const existing = this.getWorkspace(id, tenantId);
    if (!existing) {
      throw new AppError("Workspace not found", "NOT_FOUND", 404);
    }

    const updated: Workspace = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.workspaces.set(id, updated);
    return updated;
  }

  deleteWorkspace(id: string, tenantId: string): boolean {
    const existing = this.getWorkspace(id, tenantId);
    if (!existing) return false;
    return this.workspaces.delete(id);
  }
}

export const workspaceStore = new WorkspaceStore();
