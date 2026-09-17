/**
 * Authenticated Git HTTP CORS Proxy
 * Enables the in-browser isomorphic-git engine to communicate with GitHub/remote Git servers.
 * GitHub does not send browser CORS headers, so this proxy securely relays Git Smart HTTP protocol packets.
 */

import type { NextFunction, Request, Response } from "express";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import { logger } from "../logging/logger.js";
import { AppError } from "../errors/app-error.js";
import { getGitHubToken } from "../github/auth.js";

const ALLOWED_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

export function gitCorsProxyHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    // Extract target URL from path: /api/git/proxy/<target-url>
    // e.g. /api/git/proxy/github.com/owner/repo.git/info/refs?service=git-upload-pack
    const fullPath = request.originalUrl || request.url;
    const rawTarget = fullPath.replace(/^\/api\/git\/proxy\/?/, "").replace(/^\/+/, "");
    if (!rawTarget) {
      response.status(400).json({ error: "Missing target Git repository URL in proxy path" });
      return;
    }

    const targetUrlString =
      rawTarget.startsWith("http://") || rawTarget.startsWith("https://") ? rawTarget : `https://${rawTarget}`;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrlString);
    } catch {
      response.status(400).json({ error: "Invalid target URL format" });
      return;
    }

    // Host allowlist validation for security
    const hostname = parsedUrl.hostname.toLowerCase();
    const isAllowedHost = ALLOWED_HOSTS.has(hostname) || hostname.endsWith(".github.com");
    if (!isAllowedHost) {
      throw new AppError(`Host ${hostname} is not permitted through Git proxy`, "AUTHORIZATION_ERROR", 403);
    }

    // Security check: Only Git smart protocol endpoints are permitted
    const pathname = parsedUrl.pathname;
    const isGitEndpoint =
      pathname.endsWith("/info/refs") ||
      pathname.endsWith("/git-upload-pack") ||
      pathname.endsWith("/git-receive-pack") ||
      pathname.includes("/objects/");

    if (!isGitEndpoint) {
      throw new AppError(
        "Only Git Smart HTTP protocol endpoints are permitted through this proxy",
        "AUTHORIZATION_ERROR",
        403,
      );
    }

    // Forward headers relevant to Git Smart HTTP protocol
    const forwardHeaders: Record<string, string | string[]> = {};
    const headerKeys = ["accept", "content-type", "user-agent", "git-protocol", "accept-encoding"];

    for (const key of headerKeys) {
      const val = request.headers[key];
      if (val) forwardHeaders[key] = val;
    }

    // Authentication: If incoming request has Authorization, pass it through.
    // Otherwise, check if user has a stored GitHub token for github.com
    const authHeader = request.headers["authorization"];
    if (authHeader) {
      forwardHeaders["authorization"] = authHeader;
    } else if (hostname.includes("github.com") && request.tenantContext?.userId) {
      const storedToken = getGitHubToken(request.tenantContext.userId);
      if (storedToken) {
        forwardHeaders["authorization"] = `Basic ${Buffer.from(`x-access-token:${storedToken}`).toString("base64")}`;
      }
    }

    forwardHeaders["host"] = parsedUrl.host;

    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: request.method,
      headers: forwardHeaders,
    };

    const client = parsedUrl.protocol === "https:" ? https : http;

    const proxyReq = client.request(requestOptions, (proxyRes) => {
      // Set CORS headers for browser
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin || "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Git-Protocol, Accept");
      response.setHeader("Access-Control-Allow-Credentials", "true");

      // Pass forward headers from upstream
      const passthroughHeaders = ["content-type", "content-length", "git-protocol", "cache-control", "expires"];
      for (const h of passthroughHeaders) {
        const val = proxyRes.headers[h];
        if (val) response.setHeader(h, val);
      }

      response.status(proxyRes.statusCode || 200);
      proxyRes.pipe(response);
    });

    proxyReq.on("error", (err) => {
      logger.error("Git proxy request failed", {
        operation: "git-cors-proxy",
        metadata: { target: targetUrlString, error: err.message },
      });
      if (!response.headersSent) {
        response.status(502).json({ error: `Git remote communication failed: ${err.message}` });
      }
    });

    // Pipe client request body if POST
    if (request.method === "POST") {
      request.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  } catch (error) {
    next(error);
  }
}
