import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";
import { devicePairingManager, type PairedDevice } from "../security/device-pairing.js";
import { logger } from "../logging/logger.js";
import type { ToolExecutionResult } from "../types/tools.js";

export interface PendingToolJob {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly timeoutMs: number;
  readonly createdAt: number;
}

interface JobWaiter {
  resolve: (result: ToolExecutionResult<unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class ConnectorHub {
  private readonly pendingJobsByWorkspace = new Map<string, PendingToolJob[]>();
  private readonly jobWaiters = new Map<string, JobWaiter>();

  /**
   * Check if a workspace has an active connected local device
   */
  isWorkspaceOnline(workspaceId: string): boolean {
    const device = devicePairingManager.getDeviceByWorkspace(workspaceId);
    if (!device || device.status !== "online") return false;

    // Check if heartbeat is within last 45 seconds
    const lastSeen = new Date(device.lastSeenAt).getTime();
    const isStale = Date.now() - lastSeen > 45_000;
    if (isStale) {
      device.status = "offline";
      return false;
    }
    return true;
  }

  getConnectedDevice(workspaceId: string): PairedDevice | undefined {
    return devicePairingManager.getDeviceByWorkspace(workspaceId);
  }

  /**
   * Dispatch a tool execution request to the local connector and await result
   */
  async executeOnLocalConnector<TOutput = unknown>(
    workspaceId: string,
    toolName: string,
    input: unknown,
    timeoutMs: number = 30_000,
  ): Promise<ToolExecutionResult<TOutput>> {
    const isOnline = this.isWorkspaceOnline(workspaceId);
    if (!isOnline) {
      return {
        toolName,
        callId: crypto.randomUUID(),
        success: false,
        output: undefined,
        error: `Local workspace connector is offline. Please run the connector on your PC to enable workspace tools.`,
        durationMs: 0,
      };
    }

    const jobId = "job-" + crypto.randomUUID().substring(0, 12);
    const job: PendingToolJob = {
      jobId,
      workspaceId,
      toolName,
      input,
      timeoutMs,
      createdAt: Date.now(),
    };

    // Queue job for local polling
    const queue = this.pendingJobsByWorkspace.get(workspaceId) || [];
    queue.push(job);
    this.pendingJobsByWorkspace.set(workspaceId, queue);

    logger.info("Dispatched tool job to local connector", {
      operation: "connector.dispatch",
      metadata: { jobId, workspaceId, toolName },
    });

    // Await result from local connector with timeout
    return new Promise<ToolExecutionResult<TOutput>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobWaiters.delete(jobId);
        resolve({
          toolName,
          callId: jobId,
          success: false,
          output: undefined,
          error: `Tool execution on local connector timed out after ${timeoutMs}ms.`,
          durationMs: timeoutMs,
        });
      }, timeoutMs);

      this.jobWaiters.set(jobId, {
        resolve: (res) => resolve(res as ToolExecutionResult<TOutput>),
        reject,
        timer,
      });
    });
  }

  /**
   * Polling endpoint called by local connector CLI
   */
  pollJobs(deviceToken: string): PendingToolJob[] {
    const device = devicePairingManager.getDeviceByToken(deviceToken);
    if (!device || device.status !== "online") {
      throw new AppError("Device token not found or revoked", "AUTHENTICATION_ERROR", 401);
    }

    devicePairingManager.updateHeartbeat(deviceToken);

    const queue = this.pendingJobsByWorkspace.get(device.workspaceId) || [];
    this.pendingJobsByWorkspace.set(device.workspaceId, []);
    return queue;
  }

  /**
   * Called by local connector CLI when tool finishes
   */
  submitJobResult(deviceToken: string, jobId: string, result: ToolExecutionResult<unknown>): boolean {
    const device = devicePairingManager.getDeviceByToken(deviceToken);
    if (!device) {
      throw new AppError("Invalid device token", "AUTHENTICATION_ERROR", 401);
    }

    devicePairingManager.updateHeartbeat(deviceToken);

    const waiter = this.jobWaiters.get(jobId);
    if (!waiter) return false;

    clearTimeout(waiter.timer);
    this.jobWaiters.delete(jobId);
    waiter.resolve(result);
    return true;
  }
}

export const connectorHub = new ConnectorHub();
