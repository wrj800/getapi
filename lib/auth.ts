import { NextRequest } from "next/server";
import { getUserById, PublicUser, toPublicUser, UserRecord } from "@/lib/users";

const COOKIE_NAME = "public_ai_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function getAuthSecret() {
  return process.env.AUTH_SECRET || "dev-secret-change-before-deploy";
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
}

async function verify(value: string, signature: string) {
  const expected = await sign(value);
  if (expected.length !== signature.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}

function parseCookies(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && rest.length > 0) {
      cookies.set(name, rest.join("="));
    }
  }
  return cookies;
}

export async function createSessionCookie(userId: string) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId,
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
    })
  );
  const signature = await sign(payload);
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export async function getSessionUser(request: NextRequest) {
  const raw = parseCookies(request.headers.get("cookie")).get(COOKIE_NAME);
  if (!raw) {
    return null;
  }

  const [payload, signature] = raw.split(".");
  if (!payload || !signature || !(await verify(payload, signature))) {
    return null;
  }

  const parsed = JSON.parse(base64UrlDecode(payload)) as { userId?: string; exp?: number };
  if (!parsed.userId || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return getUserById(parsed.userId);
}

export async function requireUser(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Error("请先登录。");
  }
  if (user.status !== "active") {
    throw new Error("账号已被禁用。");
  }
  return user;
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireUser(request);
  if (user.role !== "admin") {
    throw new Error("需要管理员权限。");
  }
  return user;
}

export function authResponse(user: UserRecord | PublicUser) {
  return {
    user: "passwordHash" in user ? toPublicUser(user) : user
  };
}
