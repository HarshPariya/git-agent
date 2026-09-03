import test from "node:test";
import assert from "node:assert/strict";
import { UserStore, createSessionToken, verifySessionToken } from "../src/security/auth.js";

test("UserStore registers new users with hashed passwords", () => {
  const store = new UserStore();
  const user = store.register({
    email: "testuser@example.com",
    name: "Test User",
    password: "securePassword123",
    tenantId: "tenant-test",
    role: "developer",
  });

  assert.equal(user.email, "testuser@example.com");
  assert.equal(user.tenantId, "tenant-test");
  assert.notEqual(user.passwordHash, "securePassword123");
  assert.ok(user.salt);
  assert.ok(store.verifyPassword(user, "securePassword123"));
  assert.equal(store.verifyPassword(user, "wrongPassword"), false);
});

test("UserStore rejects duplicate email registration", () => {
  const store = new UserStore();
  store.register({ email: "dup@example.com", name: "User 1", password: "password123" });
  assert.throws(() => {
    store.register({ email: "dup@example.com", name: "User 2", password: "password123" });
  }, /already exists/);
});

test("createSessionToken and verifySessionToken roundtrip", () => {
  const store = new UserStore();
  const user = store.register({
    email: "tokenuser@example.com",
    name: "Token User",
    password: "password123",
    tenantId: "tenant-token",
    role: "admin",
  });

  const token = createSessionToken(user);
  assert.ok(token.includes("."));

  const session = verifySessionToken(token);
  assert.equal(session.userId, user.id);
  assert.equal(session.tenantId, "tenant-token");
  assert.equal(session.role, "admin");
  assert.equal(session.email, "tokenuser@example.com");
});

test("verifySessionToken rejects tampered or expired tokens", () => {
  assert.throws(() => verifySessionToken("invalid.token"), /signature|format/);
  assert.throws(() => verifySessionToken("not-a-token"), /format/);
});
