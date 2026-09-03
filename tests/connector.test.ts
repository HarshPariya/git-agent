import test from "node:test";
import assert from "node:assert/strict";
import { DevicePairingManager } from "../src/security/device-pairing.js";
import { ConnectorHub } from "../src/services/connector-hub.js";

test("DevicePairingManager generates and redeems 6-digit pairing codes", () => {
  const pairingMgr = new DevicePairingManager();
  const pair = pairingMgr.generatePairingCode("tenant-dev", "usr-1", "ws-target");

  assert.equal(pair.code.length, 6);
  assert.ok(/^\d{6}$/.test(pair.code));

  const device = pairingMgr.redeemPairingCode(pair.code, "MacBook Pro", "darwin", "/Users/dev/project");
  assert.equal(device.deviceName, "MacBook Pro");
  assert.equal(device.workspaceId, "ws-target");
  assert.ok(device.deviceToken.startsWith("devtok-"));

  // Code cannot be reused
  assert.throws(() => {
    pairingMgr.redeemPairingCode(pair.code, "Another Device", "linux", "/tmp");
  }, /Invalid pairing code/);
});

test("ConnectorHub returns offline error when workspace has no active connector", async () => {
  const hub = new ConnectorHub();
  const result = await hub.executeOnLocalConnector("ws-unpaired", "read_file", { path: "test.ts" });

  assert.equal(result.success, false);
  assert.ok(result.error?.includes("offline"));
});
