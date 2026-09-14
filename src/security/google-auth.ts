import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";

const googleClientId = env.googleClientId;
const client = googleClientId ? new OAuth2Client(googleClientId) : null;

export interface GoogleTokenPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string | undefined;
  emailVerified: boolean;
}

export async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
  if (!client) {
    throw new Error("Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in .env");
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: googleClientId,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Invalid Google token: empty payload");
  }

  return {
    sub: payload.sub,
    email: payload.email ?? "",
    name: payload.name ?? "",
    picture: payload.picture,
    emailVerified: payload.email_verified ?? false,
  };
}

export function isGoogleAuthConfigured(): boolean {
  return !!googleClientId;
}
