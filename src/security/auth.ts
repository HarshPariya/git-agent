import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";
import { getCollection, withTransaction } from "../db/mongodb.js";
import type { GoogleTokenPayload } from "./google-auth.js";

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
// bdbdbdb
const JWT_SECRET = process.env.AUTH_SECRET?.trim();
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET must be configured in production");
}
const SESSION_SECRET = JWT_SECRET || "development-only-auth-secret";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 1000;
const PBKDF2_KEY_LENGTH = 64;

const envAdminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Emails that receive the admin role on sign-in. */
export const ADMIN_EMAILS = new Set(["harshpariya195@gmail.com", ...envAdminEmails]);

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
  {
    id: "user-admin-1",
    email: "admin@codegpt.io",
    name: "Enterprise Admin",
    tenantId: "tenant-enterprise",
    role: "admin",
    password: "password123",
  },
  {
    id: "user-alice-1",
    email: "alice@company-a.com",
    name: "Alice Developer",
    tenantId: "tenant-alpha",
    role: "developer",
    password: "password123",
  },
  {
    id: "user-bob-1",
    email: "bob@company-b.com",
    name: "Bob Engineer",
    tenantId: "tenant-beta",
    role: "developer",
    password: "password123",
  },
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

  register(params: { email: string; name: string; password: string; tenantId?: string; role?: User["role"] }): User {
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

  findByEmail = (email: string): User | undefined => this.usersByEmail.get(email.trim().toLowerCase());

  findById = (id: string): User | undefined => this.usersById.get(id);

  verifyPassword = (user: User, candidatePassword: string): boolean => {
    const candidateHash = hashPassword(candidatePassword, user.salt);
    return crypto.timingSafeEqual(Buffer.from(user.passwordHash), Buffer.from(candidateHash));
  };

  listUsers = (): User[] => Array.from(this.usersById.values());
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

const INVALID_TOKEN_ERROR = (message: string) => new AppError(message, "AUTHENTICATION_ERROR", 401);

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

// ---------------------------------------------------------------------------
// Google Sign-In: database-backed user creation / lookup
// ---------------------------------------------------------------------------

export interface GoogleUserResult {
  user: { id: string; email: string; name: string; tenantId: string; role: User["role"]; picture: string | undefined };
  token: string;
}

// In-memory Google user store (fallback when database is unavailable)
const googleUsersBySub = new Map<
  string,
  { id: string; email: string; name: string; tenantId: string; role: User["role"]; picture: string | undefined }
>();

/** Find a Google user by their application user ID (searches the in-memory fallback store). */
export function findGoogleUserByIdInMemory(
  userId: string,
):
  | { id: string; email: string; name: string; tenantId: string; role: User["role"]; picture: string | undefined }
  | undefined {
  for (const user of googleUsersBySub.values()) {
    if (user.id === userId) return user;
  }
  return undefined;
}

function findOrCreateGoogleUserInMemory(googlePayload: GoogleTokenPayload): GoogleUserResult {
  const { sub, email, name, picture } = googlePayload;

  const existing = googleUsersBySub.get(sub);
  if (existing) {
    console.warn(`[AUTH] Google login (memory): existing user ${existing.id} (${existing.email})`);
    const token = createSessionToken({
      id: existing.id,
      email: existing.email,
      name: existing.name,
      tenantId: existing.tenantId,
      role: existing.role,
      passwordHash: "",
      salt: "",
      createdAt: "",
    });
    return { user: existing, token };
  }

  const userId = `usr-g-${crypto.randomUUID().substring(0, 8)}`;
  const tenantId = `t-g-${crypto.randomUUID().substring(0, 8)}`;
  const displayName = name || email.split("@")[0] || "User";
  const role: User["role"] = ADMIN_EMAILS.has(email) ? "admin" : "developer";
  const user: GoogleUserResult["user"] = {
    id: userId,
    email,
    name: displayName,
    tenantId,
    role,
    picture: picture ?? undefined,
  };

  googleUsersBySub.set(sub, user);
  console.warn(`[AUTH] Google login (memory): created user ${userId} (${email})`);

  const token = createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
    tenantId: user.tenantId,
    role,
    passwordHash: "",
    salt: "",
    createdAt: new Date().toISOString(),
  });
  return { user, token };
}

export async function findOrCreateGoogleUser(googlePayload: GoogleTokenPayload): Promise<GoogleUserResult> {
  const { sub, email, name, picture } = googlePayload;

  try {
    const usersCol = getCollection("users");
    const identitiesCol = getCollection("identities");

    // 1. Check if a Google identity already exists
    const existingIdentity = await identitiesCol.findOne({ provider: "google", provider_user_id: sub });
    if (existingIdentity) {
      const userDoc = await usersCol.findOne({ id: existingIdentity.user_id });
      if (userDoc) {
        // Upgrade to admin if the email matches, even if they were created as developer
        const currentRole = (userDoc.role as User["role"]) ?? "developer";
        const resolvedRole: User["role"] = ADMIN_EMAILS.has(email) && currentRole !== "admin" ? "admin" : currentRole;
        if (resolvedRole !== currentRole) {
          await usersCol.updateOne({ id: userDoc.id }, { $set: { role: resolvedRole } });
        }
        console.warn(`[AUTH] Google login: existing user ${userDoc.id} (${userDoc.email}) role=${resolvedRole}`);
        const user: GoogleUserResult["user"] = {
          id: userDoc.id as string,
          email: userDoc.email as string,
          name: userDoc.name as string,
          tenantId: userDoc.tenant_id as string,
          role: resolvedRole,
          picture: (existingIdentity.avatar_url as string) ?? picture ?? undefined,
        };
        const token = createSessionToken({
          id: userDoc.id as string,
          email: userDoc.email as string,
          name: userDoc.name as string,
          tenantId: userDoc.tenant_id as string,
          role: resolvedRole,
          passwordHash: "",
          salt: "",
          createdAt: "",
        });
        return { user, token };
      }
    }

    // 2. Check if a user with this email already exists (email/password account)
    const existingUser = userStore.findByEmail(email);
    if (existingUser) {
      console.warn(`[AUTH] Google login: linking to existing account ${existingUser.id} (${email})`);
      const identityId = `id-${crypto.randomUUID().substring(0, 8)}`;
      await identitiesCol.insertOne({
        id: identityId,
        user_id: existingUser.id,
        provider: "google",
        provider_user_id: sub,
        email,
        name,
        avatar_url: picture ?? null,
      });
      const token = createSessionToken(existingUser);
      return {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          tenantId: existingUser.tenantId,
          role: existingUser.role,
          picture: picture ?? undefined,
        },
        token,
      };
    }

    // 3. Create a brand-new user + identity in a transaction
    const userId = `usr-${crypto.randomUUID().substring(0, 8)}`;
    const tenantId = `t-${crypto.randomUUID().substring(0, 8)}`;
    const identityId = `id-${crypto.randomUUID().substring(0, 8)}`;
    const displayName = name || email.split("@")[0] || "User";
    const role: User["role"] = ADMIN_EMAILS.has(email) ? "admin" : "developer";

    await withTransaction(async (session) => {
      await usersCol.insertOne(
        { id: userId, email, name: displayName, tenant_id: tenantId, role, created_at: new Date().toISOString() },
        { session },
      );
      await identitiesCol.insertOne(
        {
          id: identityId,
          user_id: userId,
          provider: "google",
          provider_user_id: sub,
          email,
          name: displayName,
          avatar_url: picture ?? null,
        },
        { session },
      );
    });

    console.warn(`[AUTH] Google login: created new user ${userId} (${email})`);

    const user: GoogleUserResult["user"] = {
      id: userId,
      email,
      name: displayName,
      tenantId,
      role,
      picture: picture ?? undefined,
    };
    const token = createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      role: user.role,
      passwordHash: "",
      salt: "",
      createdAt: new Date().toISOString(),
    });
    return { user, token };
  } catch (dbError) {
    // Database unavailable — fall back to in-memory store
    console.warn(
      `[AUTH] Google login: database unavailable, using in-memory fallback: ${dbError instanceof Error ? dbError.message : "unknown"}`,
    );
    return findOrCreateGoogleUserInMemory(googlePayload);
  }
}

export async function findUserByIdFromDb(userId: string): Promise<{
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: string;
  createdAt: string;
} | null> {
  const usersCol = getCollection("users");
  const row = await usersCol.findOne({ id: userId });
  if (!row) return null;
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    tenantId: row.tenant_id as string,
    role: row.role as string,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  };
}

export async function findUserByEmailFromDb(email: string): Promise<User | null> {
  const usersCol = getCollection("users");
  const row = await usersCol.findOne({ email: email.trim().toLowerCase() });
  if (!row) return null;
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    tenantId: row.tenant_id as string,
    role: (row.role as User["role"]) ?? "developer",
    passwordHash: (row.password_hash as string) ?? "",
    salt: (row.salt as string) ?? "",
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  };
}
