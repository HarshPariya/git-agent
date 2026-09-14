import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { getCollection } from "../db/mongodb.js";
import {
  createSessionToken,
  findOrCreateGoogleUser,
  findUserByIdFromDb,
  findUserByEmailFromDb,
  findGoogleUserByIdInMemory,
  userStore,
  ADMIN_EMAILS,
  verifySessionToken,
} from "../security/auth.js";
import { verifyGoogleToken } from "../security/google-auth.js";

type UserRole = "admin" | "developer" | "viewer";

const isValidEmail = (email: unknown): email is string => typeof email === "string" && email.includes("@");

const isValidPassword = (password: unknown): password is string => typeof password === "string" && password.length >= 6;

const isValidRole = (role: unknown): role is UserRole => role === "admin" || role === "developer" || role === "viewer";

const pickUser = (u: {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: string;
  createdAt: string;
}) => ({ id: u.id, email: u.email, name: u.name, tenantId: u.tenantId, role: u.role, createdAt: u.createdAt });

/** Attach an optional picture field without violating exactOptionalPropertyTypes. */
const withPicture = <T extends { id: string }>(base: T, picture: string | undefined): T & { picture?: string } =>
  picture ? { ...base, picture } : base;

/**
 * Look up the Google avatar for a user from the identities collection.
 * Returns undefined when the DB is unavailable or no avatar is stored.
 */
async function lookupAvatar(userId: string): Promise<string | undefined> {
  try {
    const identitiesCol = getCollection("identities");
    const identityDoc = await identitiesCol.findOne(
      { user_id: userId, provider: "google" },
      { projection: { avatar_url: 1 } },
    );
    return (identityDoc?.avatar_url as string) ?? undefined;
  } catch {
    return undefined;
  }
}

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
  return context;
};

export function registerHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const { email, password, name, tenantId, role } = (request.body ?? {}) as Record<string, unknown>;

    if (!isValidEmail(email)) throw new AppError("A valid email address is required", "VALIDATION_ERROR", 400);
    if (!isValidPassword(password))
      throw new AppError("Password must be at least 6 characters", "VALIDATION_ERROR", 400);

    // Assign admin role for privileged emails (even on email/password registration)
    const normalizedEmail = String(email).trim().toLowerCase();
    const requestedRole = isValidRole(role) ? role : "developer";
    const finalRole: UserRole = ADMIN_EMAILS.has(normalizedEmail) ? "admin" : requestedRole;

    const user = userStore.register({
      email,
      password,
      name: typeof name === "string" ? name : "",
      ...(typeof tenantId === "string" && { tenantId }),
      role: finalRole,
    });

    // Persist to MongoDB so the user appears in admin panel and survives restarts
    const usersCol = getCollection("users");
    usersCol
      .insertOne({
        id: user.id,
        email: user.email,
        name: user.name,
        tenant_id: user.tenantId,
        role: user.role,
        password_hash: user.passwordHash,
        salt: user.salt,
        created_at: user.createdAt,
      })
      .catch((dbErr: unknown) => {
        console.warn(
          "[AUTH] Failed to persist registered user to MongoDB:",
          dbErr instanceof Error ? dbErr.message : dbErr,
        );
      });

    response.status(201).json({ token: createSessionToken(user), user: pickUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function loginHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = (request.body ?? {}) as Record<string, unknown>;

    if (!isValidEmail(email)) throw new AppError("Email is required", "VALIDATION_ERROR", 400);
    if (!password || typeof password !== "string") throw new AppError("Password is required", "VALIDATION_ERROR", 400);

    // Tier 1: In-memory store (fast path for active sessions)
    let user = userStore.findByEmail(email);

    // Tier 2: MongoDB lookup for registered users not yet in memory
    if (!user) {
      try {
        const dbUser = await findUserByEmailFromDb(email);
        if (dbUser && dbUser.passwordHash && dbUser.salt) {
          user = dbUser;
        }
      } catch (dbErr) {
        console.warn("[AUTH] Login: MongoDB lookup failed:", dbErr instanceof Error ? dbErr.message : dbErr);
      }
    }

    if (!user || !userStore.verifyPassword(user, password)) {
      throw new AppError("Invalid email or password", "AUTHENTICATION_ERROR", 401);
    }

    // Upgrade to admin if email is privileged
    const normalizedEmail = user.email.trim().toLowerCase();
    const upgraded = ADMIN_EMAILS.has(normalizedEmail) ? { ...user, role: "admin" as const } : user;

    response.status(200).json({ token: createSessionToken(upgraded), user: pickUser(upgraded) });
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
      console.error(
        "[AUTH] Google token verification failed:",
        tokenError instanceof Error ? tokenError.message : tokenError,
      );
      throw new AppError("Invalid Google credential", "AUTHENTICATION_ERROR", 401);
    }

    // Find or create the user and get a session token
    const { user, token } = await findOrCreateGoogleUser(googlePayload);

    response.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenantId,
        role: user.role,
        picture: user.picture,
      },
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

    // Tier 1: In-memory userStore (email/password users)
    const memUser = userStore.findById(context.userId);
    if (memUser) {
      const picture = await lookupAvatar(context.userId);
      response.status(200).json({ user: withPicture(pickUser(memUser), picture) });
      return;
    }

    // Tier 2: Database lookup for persisted users
    try {
      const dbUser = await findUserByIdFromDb(context.userId);
      if (dbUser) {
        const picture = await lookupAvatar(context.userId);
        response.status(200).json({ user: withPicture(pickUser(dbUser), picture) });
        return;
      }
    } catch (dbErr) {
      console.warn(
        `[AUTH] me: DB lookup failed for ${context.userId}:`,
        dbErr instanceof Error ? dbErr.message : dbErr,
      );
    }

    // Tier 3: In-memory Google user fallback (when DB was unavailable during login)
    const googleUser = findGoogleUserByIdInMemory(context.userId);
    if (googleUser) {
      console.warn(`[AUTH] me: using in-memory fallback for Google user ${context.userId} (${googleUser.email})`);
      response.status(200).json({ user: withPicture(pickUser({ ...googleUser, createdAt: "" }), googleUser.picture) });
      return;
    }

    // Tier 4: Dev-mode fallback — no user found anywhere
    // Re-extract role from JWT token so admin status is preserved on page refresh
    let fallbackRole: "admin" | "developer" | "viewer" = "developer";
    try {
      const authHeader = request.header("authorization")?.trim();
      const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
      if (rawToken) {
        const session = verifySessionToken(rawToken);
        fallbackRole = session.role;
      }
    } catch {
      /* keep default */
    }

    console.warn(`[AUTH] me: no user found for ${context.userId}, returning dev-mode fallback (role=${fallbackRole})`);
    response.status(200).json({
      user: {
        id: context.userId,
        tenantId: context.tenantId,
        role: fallbackRole,
        email: `${context.userId}@local.dev`,
        name: context.userId,
      },
    });
  } catch (error) {
    next(error);
  }
}
