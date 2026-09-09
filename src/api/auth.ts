import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { query } from "../db/postgres.js";
import { createSessionToken, findOrCreateGoogleUser, findUserByIdFromDb, userStore } from "../security/auth.js";
import { verifyGoogleToken } from "../security/google-auth.js";

type UserRole = "admin" | "developer" | "viewer";

const isValidEmail = (email: unknown): email is string =>
  typeof email === "string" && email.includes("@");

const isValidPassword = (password: unknown): password is string =>
  typeof password === "string" && password.length >= 6;

const isValidRole = (role: unknown): role is UserRole =>
  role === "admin" || role === "developer" || role === "viewer";

const pickUser = (u: { id: string; email: string; name: string; tenantId: string; role: string; createdAt: string }) =>
  ({ id: u.id, email: u.email, name: u.name, tenantId: u.tenantId, role: u.role, createdAt: u.createdAt });

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
  return context;
};

export function registerHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const { email, password, name, tenantId, role } = (request.body ?? {}) as Record<string, unknown>;

    if (!isValidEmail(email)) throw new AppError("A valid email address is required", "VALIDATION_ERROR", 400);
    if (!isValidPassword(password)) throw new AppError("Password must be at least 6 characters", "VALIDATION_ERROR", 400);

    const user = userStore.register({
      email,
      password,
      name: typeof name === "string" ? name : "",
      ...(typeof tenantId === "string" && { tenantId }),
      role: isValidRole(role) ? role : "developer",
    });

    response.status(201).json({ token: createSessionToken(user), user: pickUser(user) });
  } catch (error) {
    next(error);
  }
}

export function loginHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const { email, password } = (request.body ?? {}) as Record<string, unknown>;

    if (!isValidEmail(email)) throw new AppError("Email is required", "VALIDATION_ERROR", 400);
    if (!password || typeof password !== "string") throw new AppError("Password is required", "VALIDATION_ERROR", 400);

    const user = userStore.findByEmail(email);
    if (!user || !userStore.verifyPassword(user, password)) {
      throw new AppError("Invalid email or password", "AUTHENTICATION_ERROR", 401);
    }

    response.status(200).json({ token: createSessionToken(user), user: pickUser(user) });
  } catch (error) {
    next(error);
  }
}

export function meHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const user = userStore.findById(context.userId);

    if (user) {
      response.status(200).json({ user: pickUser(user) });
      return;
    }

    // For Google-authenticated users not in the in-memory store, look up in the DB
    // Use a synchronous fallback here; the async DB call happens in the Google-specific path
    response.status(200).json({
      user: {
        id: context.userId,
        tenantId: context.tenantId,
        role: "developer",
        email: `${context.userId}@local.dev`,
        name: context.userId,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function googleLoginHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { credential } = (request.body ?? {}) as Record<string, unknown>;

    if (!credential || typeof credential !== "string") {
      throw new AppError("Missing Google credential", "VALIDATION_ERROR", 400);
    }

    // Verify the Google ID token — if this fails, it's a real auth error
    let googlePayload;
    try {
      googlePayload = await verifyGoogleToken(credential);
    } catch (tokenError) {
      console.error("[AUTH] Google token verification failed:", tokenError instanceof Error ? tokenError.message : tokenError);
      throw new AppError("Invalid Google credential", "AUTHENTICATION_ERROR", 401);
    }

    // Find or create the user and get a session token
    const { user, token } = await findOrCreateGoogleUser(googlePayload);

    response.status(200).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role, picture: user.picture },
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    console.error("[AUTH] Google login failed:", error instanceof Error ? error.message : error);
    next(new AppError("Google sign-in failed. Please try again.", "AUTHENTICATION_ERROR", 500));
  }
}

export async function meHandlerDb(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);

    // Try in-memory store first
    const memUser = userStore.findById(context.userId);
    if (memUser) {
      response.status(200).json({ user: pickUser(memUser) });
      return;
    }

    // Fall back to database lookup for Google-authenticated users
    try {
      const dbUser = await findUserByIdFromDb(context.userId);
      if (dbUser) {
        // Try to get avatar_url from identities table
        let avatarUrl: string | undefined;
        try {
          const identityResult = await query<{ avatar_url: string | null }>(
            `SELECT avatar_url FROM identities WHERE user_id = $1 AND provider = 'google' LIMIT 1`,
            [context.userId],
          );
          avatarUrl = identityResult.rows[0]?.avatar_url ?? undefined;
        } catch { /* ignore — table may not exist */ }

        response.status(200).json({ user: { ...dbUser, picture: avatarUrl } });
        return;
      }
    } catch {
      // Database unavailable — fall through to dev-mode fallback
    }

    // Dev-mode fallback
    response.status(200).json({
      user: {
        id: context.userId,
        tenantId: context.tenantId,
        role: "developer",
        email: `${context.userId}@local.dev`,
        name: context.userId,
      },
    });
  } catch (error) {
    next(error);
  }
}
