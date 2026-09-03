import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { devicePairingManager } from "../security/device-pairing.js";
import { connectorHub } from "../services/connector-hub.js";
import { workspaceStore } from "../services/workspace-service.js";

export async function generatePairCodeHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) {
      throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
    }

    const { workspaceId } = request.body || {};
    const wsId = typeof workspaceId === "string" && workspaceId.trim()
      ? workspaceId.trim()
      : "ws-default-cloud";

    const pair = devicePairingManager.generatePairingCode(context.tenantId, context.userId, wsId);

    response.status(200).json({
      code: pair.code,
      expiresAt: pair.expiresAt,
      workspaceId: wsId,
      instructions: `Run on your workstation:\n  npx @codegpt/connector connect --code ${pair.code}`,
    });
  } catch (error) {
    next(error);
  }
}

export async function pairDeviceHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code, deviceName, osPlatform, localPath } = request.body || {};

    if (!code || typeof code !== "string") {
      throw new AppError("Pairing code is required", "VALIDATION_ERROR", 400);
    }

    const device = devicePairingManager.redeemPairingCode(
      code,
      typeof deviceName === "string" ? deviceName : "Workstation",
      typeof osPlatform === "string" ? osPlatform : process.platform,
      typeof localPath === "string" ? localPath : process.cwd(),
    );

    // Update workspace status to paired
    const ws = workspaceStore.getWorkspace(device.workspaceId, device.tenantId);
    if (ws) {
      workspaceStore.updateWorkspace(device.workspaceId, device.tenantId, {
        status: "paired",
        deviceToken: device.deviceToken,
        localPath: device.localPath,
        mode: "local-connector",
      });
    }

    response.status(200).json({
      deviceToken: device.deviceToken,
      workspaceId: device.workspaceId,
      tenantId: device.tenantId,
      deviceName: device.deviceName,
      status: "connected",
    });
  } catch (error) {
    next(error);
  }
}

export async function pollJobsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = request.header("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim() || request.header("x-device-token") || "";

    if (!token) {
      throw new AppError("Device token is required", "AUTHENTICATION_ERROR", 401);
    }

    const jobs = connectorHub.pollJobs(token);
    response.status(200).json({ jobs });
  } catch (error) {
    next(error);
  }
}

export async function submitResultHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = request.header("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim() || request.header("x-device-token") || "";

    if (!token) {
      throw new AppError("Device token is required", "AUTHENTICATION_ERROR", 401);
    }

    const { jobId, result } = request.body || {};
    if (!jobId || typeof jobId !== "string" || !result) {
      throw new AppError("jobId and result are required", "VALIDATION_ERROR", 400);
    }

    const handled = connectorHub.submitJobResult(token, jobId, result);
    response.status(200).json({ received: handled });
  } catch (error) {
    next(error);
  }
}

export async function heartbeatHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = request.header("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim() || request.header("x-device-token") || "";

    if (!token) {
      throw new AppError("Device token is required", "AUTHENTICATION_ERROR", 401);
    }

    devicePairingManager.updateHeartbeat(token);
    response.status(200).json({ status: "online", timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}

export async function connectorStatusHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const workspaceId = request.params.workspaceId as string;
    const isOnline = connectorHub.isWorkspaceOnline(workspaceId);
    const device = connectorHub.getConnectedDevice(workspaceId);

    response.status(200).json({
      workspaceId,
      isOnline,
      device: device
        ? {
          deviceName: device.deviceName,
          osPlatform: device.osPlatform,
          pairedAt: device.pairedAt,
          lastSeenAt: device.lastSeenAt,
          localPath: device.localPath,
        }
        : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function disconnectHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { workspaceId } = request.body || {};
    if (!workspaceId || typeof workspaceId !== "string") {
      throw new AppError("workspaceId is required", "VALIDATION_ERROR", 400);
    }

    const revoked = devicePairingManager.revokeDevice(workspaceId);
    response.status(200).json({ status: "disconnected", revoked });
  } catch (error) {
    next(error);
  }
}
