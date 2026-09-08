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

const JWT_SECRET = process.env.AUTH_SECRET?.trim();
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET must be configured in production");
}
const SESSION_SECRET = JWT_SECRET || "development-only-auth-secret";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 1000;
const PBKDF2_KEY_LENGTH = 64;

const hashPassword = (password: string, salt: string): string =>
  crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, "sha512").toString("hex");

const generateSalt = (): string => crypto.randomBytes(SALT_LENGTH).toString("hex");

interface DefaultAccount {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: User["role"];
  password: string;
}

const DEFAULT_ACCOUNTS: readonly DefaultAccount[] = [
  { id: "user-admin-1", email: "admin@codegpt.io", name: "Enterprise Admin", tenantId: "tenant-enterprise", role: "admin", password: "password123" },
  { id: "user-alice-1", email: "alice@company-a.com", name: "Alice Developer", tenantId: "tenant-alpha", role: "developer", password: "password123" },
  { id: "user-bob-1", email: "bob@company-b.com", name: "Bob Engineer", tenantId: "tenant-beta", role: "developer", password: "password123" },
];

export class UserStore {
  private readonly usersByEmail = new Map<string, User>();
  private readonly usersById = new Map<string, User>();

  constructor() {
    for (const acc of DEFAULT_ACCOUNTS) {
      const salt = generateSalt();
      const user: User = {
        id: acc.id,
        email: acc.email.toLowerCase(),
        name: acc.name,
        tenantId: acc.tenantId,
        role: acc.role,
        passwordHash: hashPassword(acc.password, salt),
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
    tenantId?: string;
    role?: User["role"];
  }): User {
    const normalizedEmail = params.email.trim().toLowerCase();
    if (this.usersByEmail.has(normalizedEmail)) {
      throw new AppError("An account with this email already exists", "AUTHENTICATION_ERROR", 409);
    }

    const salt = generateSalt();
    const userId = `usr-${crypto.randomUUID().substring(0, 8)}`;
    const tenantId = params.tenantId?.trim() || `t-${crypto.randomUUID().substring(0, 8)}`;

    const user: User = {
      id: userId,
      email: normalizedEmail,
      name: params.name.trim() || normalizedEmail.split("@")[0] || "User",
      tenantId,
      role: params.role || "developer",
      passwordHash: hashPassword(params.password, salt),
      salt,
      createdAt: new Date().toISOString(),
    };

    this.usersByEmail.set(normalizedEmail, user);
    this.usersById.set(userId, user);
    return user;
  }

  findByEmail = (email: string): User | undefined =>
    this.usersByEmail.get(email.trim().toLowerCase());

  findById = (id: string): User | undefined => this.usersById.get(id);

  verifyPassword = (user: User, candidatePassword: string): boolean => {
    const candidateHash = hashPassword(candidatePassword, user.salt);
    return crypto.timingSafeEqual(Buffer.from(user.passwordHash), Buffer.from(candidateHash));
  };
}

export const userStore = new UserStore();

export const createSessionToken = (user: User): string => {
  const payload: AuthSession = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
};

const INVALID_TOKEN_ERROR = (message: string) =>
  new AppError(message, "AUTHENTICATION_ERROR", 401);

export const verifySessionToken = (token: string): AuthSession => {
  const parts = token.split(".");
  if (parts.length !== 2) throw INVALID_TOKEN_ERROR("Invalid authentication token format");

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) throw INVALID_TOKEN_ERROR("Invalid authentication token");

  const expectedSignature = crypto.createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw INVALID_TOKEN_ERROR("Invalid authentication token signature");
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AuthSession;
    if (payload.exp < Date.now()) throw INVALID_TOKEN_ERROR("Authentication token expired");
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw INVALID_TOKEN_ERROR("Malformed authentication token payload");
  }
};
