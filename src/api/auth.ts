import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { createSessionToken, userStore } from "../security/auth.js";

const pickUser = (u: { id: string; email: string; name: string; tenantId: string; role: string; createdAt: string }) => ({ id: u.id, email: u.email, name: u.name, tenantId: u.tenantId, role: u.role, createdAt: u.createdAt });

export async function registerHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, name, tenantId, role } = request.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) throw new AppError("A valid email address is required", "VALIDATION_ERROR", 400);
    if (!password || typeof password !== "string" || password.length < 6) throw new AppError("Password must be at least 6 characters", "VALIDATION_ERROR", 400);
    const user = userStore.register({ email, password, name: typeof name === "string" ? name : "", tenantId: typeof tenantId === "string" ? tenantId : undefined, role: role === "admin" || role === "developer" || role === "viewer" ? role : "developer" });
    response.status(201).json({ token: createSessionToken(user), user: pickUser(user) });
  } catch (error) { next(error); }
}

export async function loginHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = request.body || {};
    if (!email || typeof email !== "string") throw new AppError("Email is required", "VALIDATION_ERROR", 400);
    if (!password || typeof password !== "string") throw new AppError("Password is required", "VALIDATION_ERROR", 400);
    const user = userStore.findByEmail(email);
    if (!user || !userStore.verifyPassword(user, password)) throw new AppError("Invalid email or password", "AUTHENTICATION_ERROR", 401);
    response.status(200).json({ token: createSessionToken(user), user: pickUser(user) });
  } catch (error) { next(error); }
}

export async function meHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) throw new AppError("Authentication required", "AUTHENTICATION_ERROR", 401);
    const user = userStore.findById(context.userId);
    if (!user) { response.status(200).json({ user: { id: context.userId, tenantId: context.tenantId, role: "developer", email: `${context.userId}@local.dev`, name: context.userId } }); return; }
    response.status(200).json({ user: pickUser(user) });
  } catch (error) { next(error); }
}
