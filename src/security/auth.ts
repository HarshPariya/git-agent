import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly tenantId: string;
  readonly role: "admin" | "developer" | "viewer";
  readonly passwordHash: string;
  readonly salt: string;
  readonly createdAt: string;
}

export interface AuthSession {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: "admin" | "developer" | "viewer";
  readonly email: string;
  readonly exp: number;
}

const JWT_SECRET = process.env.AUTH_SECRET || "codegpt-enterprise-auth-secret-key-2026";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const hashPassword = (password: string, salt: string): string => {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
};

export class UserStore {
  private readonly usersByEmail = new Map<string, User>();
  private readonly usersById = new Map<string, User>();

  constructor() {
    this.seedDefaultUsers();
  }

  private seedDefaultUsers(): void {
    const defaultAccounts = [
      { id: "user-admin-1", email: "admin@codegpt.io", name: "Enterprise Admin", tenantId: "tenant-enterprise", role: "admin" as const, password: "password123" },
      { id: "user-alice-1", email: "alice@company-a.com", name: "Alice Developer", tenantId: "tenant-alpha", role: "developer" as const, password: "password123" },
      { id: "user-bob-1", email: "bob@company-b.com", name: "Bob Engineer", tenantId: "tenant-beta", role: "developer" as const, password: "password123" },
    ];

    for (const acc of defaultAccounts) {
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPassword(acc.password, salt);
      const user: User = {
        id: acc.id,
        email: acc.email.toLowerCase(),
        name: acc.name,
        tenantId: acc.tenantId,
        role: acc.role,
        passwordHash,
        salt,
        createdAt: new Date().toISOString(),
      };
      this.usersByEmail.set(user.email, user);
      this.usersById.set(user.id, user);
    }
  }

  register(params: {
    email: string;
    name: string;
    password: string;
    tenantId?: string | undefined;
    role?: ("admin" | "developer" | "viewer") | undefined;
  }): User {
    const normalizedEmail = params.email.trim().toLowerCase();
    if (this.usersByEmail.has(normalizedEmail)) {
      throw new AppError("An account with this email already exists", "AUTHENTICATION_ERROR", 409);
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(params.password, salt);
    const userId = "usr-" + crypto.randomUUID().substring(0, 8);
    const tenantId = params.tenantId?.trim() || "t-" + crypto.randomUUID().substring(0, 8);

    const user: User = {
      id: userId,
      email: normalizedEmail,
      name: params.name.trim() || normalizedEmail.split("@")[0] || "User",
      tenantId,
      role: params.role || "developer",
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
    };

    this.usersByEmail.set(normalizedEmail, user);
    this.usersById.set(userId, user);
    return user;
  }

  findByEmail(email: string): User | undefined {
    return this.usersByEmail.get(email.trim().toLowerCase());
  }

  findById(id: string): User | undefined {
    return this.usersById.get(id);
  }

  verifyPassword(user: User, candidatePassword: string): boolean {
    const candidateHash = hashPassword(candidatePassword, user.salt);
    return crypto.timingSafeEqual(Buffer.from(user.passwordHash), Buffer.from(candidateHash));
  }
}

export const userStore = new UserStore();

/**
 * Generate a cryptographically signed session token
 */
export const createSessionToken = (user: User): string => {
  const payload: AuthSession = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
};

/**
 * Verify and decode session token
 */
export const verifySessionToken = (token: string): AuthSession => {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new AppError("Invalid authentication token format", "AUTHENTICATION_ERROR", 401);
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    throw new AppError("Invalid authentication token", "AUTHENTICATION_ERROR", 401);
  }

  const expectedSignature = crypto.createHmac("sha256", JWT_SECRET).update(encodedPayload).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new AppError("Invalid authentication token signature", "AUTHENTICATION_ERROR", 401);
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AuthSession;
    if (payload.exp < Date.now()) {
      throw new AppError("Authentication token expired", "AUTHENTICATION_ERROR", 401);
    }
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Malformed authentication token payload", "AUTHENTICATION_ERROR", 401);
  }
};
