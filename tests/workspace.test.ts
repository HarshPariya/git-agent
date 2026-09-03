import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore } from "../src/services/workspace-service.js";

test("WorkspaceStore creates, lists, and isolates multi-tenant workspaces", () => {
  const store = new WorkspaceStore();

  const wsA = store.createWorkspace({
    tenantId: "tenant-user-a",
    userId: "usr-a",
    name: "Project Alpha",
    mode: "local-connector",
    localPath: "/home/alice/alpha",
  });

  const wsB = store.createWorkspace({
    tenantId: "tenant-user-b",
    userId: "usr-b",
    name: "Project Beta",
    mode: "cloud",
  });

  assert.equal(wsA.name, "Project Alpha");
  assert.equal(wsA.mode, "local-connector");
  assert.equal(wsA.status, "offline");

  // Multi-tenant isolation
  const listA = store.listWorkspaces("tenant-user-a", "usr-a");
  assert.equal(listA.length, 1);
  assert.equal(listA[0]?.id, wsA.id);

  const listB = store.listWorkspaces("tenant-user-b", "usr-b");
  assert.equal(listB.length, 1);
  assert.equal(listB[0]?.id, wsB.id);

  // Cross-tenant access is blocked
  assert.equal(store.getWorkspace(wsA.id, "tenant-user-b"), undefined);
  assert.equal(store.getWorkspace(wsB.id, "tenant-user-a"), undefined);
});

test("WorkspaceStore updates and deletes workspaces cleanly", () => {
  const store = new WorkspaceStore();
  const ws = store.createWorkspace({
    tenantId: "tenant-c",
    userId: "usr-c",
    name: "Initial Name",
  });

  const updated = store.updateWorkspace(ws.id, "tenant-c", {
    name: "Updated Name",
    status: "paired",
  });

  assert.equal(updated.name, "Updated Name");
  assert.equal(updated.status, "paired");

  const deleted = store.deleteWorkspace(ws.id, "tenant-c");
  assert.equal(deleted, true);
  assert.equal(store.getWorkspace(ws.id, "tenant-c"), undefined);
});
