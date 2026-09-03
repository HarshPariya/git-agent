import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";

export interface PairingCodeRecord {
  readonly code: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly expiresAt: number;
}

export interface PairedDevice {
  readonly deviceToken: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly deviceName: string;
  readonly osPlatform: string;
  readonly localPath: string;
  readonly pairedAt: string;
  lastSeenAt: string;
  status: "online" | "offline" | "revoked";
}

export class DevicePairingManager {
  private readonly activeCodes = new Map<string, PairingCodeRecord>();
  private readonly devicesByToken = new Map<string, PairedDevice>();
  private readonly devicesByWorkspace = new Map<string, PairedDevice>();

  generatePairingCode(tenantId: string, userId: string, workspaceId: string): { code: string; expiresAt: string } {
    // Generate a secure 6-digit numeric pairing code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    const record: PairingCodeRecord = {
      code,
      tenantId,
      userId,
      workspaceId,
      expiresAt,
    };

    this.activeCodes.set(code, record);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  redeemPairingCode(code: string, deviceName: string, osPlatform: string, localPath: string): PairedDevice {
    const record = this.activeCodes.get(code.trim());
    if (!record) {
      throw new AppError("Invalid pairing code", "AUTHENTICATION_ERROR", 401);
    }

    if (record.expiresAt < Date.now()) {
      this.activeCodes.delete(code.trim());
      throw new AppError("Pairing code has expired. Please generate a new code.", "AUTHENTICATION_ERROR", 401);
    }

    // Generate secure device token
    const deviceToken = "devtok-" + crypto.randomBytes(24).toString("hex");

    const device: PairedDevice = {
      deviceToken,
      tenantId: record.tenantId,
      userId: record.userId,
      workspaceId: record.workspaceId,
      deviceName: deviceName || "Local Workstation",
      osPlatform: osPlatform || process.platform,
      localPath: localPath || "",
      pairedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      status: "online",
    };

    this.devicesByToken.set(deviceToken, device);
    this.devicesByWorkspace.set(record.workspaceId, device);
    this.activeCodes.delete(code.trim());

    return device;
  }

  getDeviceByToken(deviceToken: string): PairedDevice | undefined {
    return this.devicesByToken.get(deviceToken.trim());
  }

  getDeviceByWorkspace(workspaceId: string): PairedDevice | undefined {
    return this.devicesByWorkspace.get(workspaceId.trim());
  }

  updateHeartbeat(deviceToken: string): void {
    const device = this.devicesByToken.get(deviceToken.trim());
    if (device) {
      device.lastSeenAt = new Date().toISOString();
      device.status = "online";
    }
  }

  revokeDevice(workspaceId: string): boolean {
    const device = this.devicesByWorkspace.get(workspaceId);
    if (!device) return false;
    device.status = "revoked";
    this.devicesByToken.delete(device.deviceToken);
    this.devicesByWorkspace.delete(workspaceId);
    return true;
  }
}

export const devicePairingManager = new DevicePairingManager();
