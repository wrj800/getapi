import { PUBLIC_MODELS } from "@/lib/models";
import { hashPassword, verifyPassword } from "@/lib/password";
import { redisCommand, redisGetJson, redisSetJson } from "@/lib/store";

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "disabled";

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
  dailyLimit: number;
  dailyUsed: number;
  dailyReset: string;
  quotaTotal: number;
  quotaUsed: number;
  allowedModels: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type PublicUser = Omit<UserRecord, "passwordHash"> & {
  remainingDaily: number;
  remainingTotal: number;
};

export type UsageEntry = {
  userId: string;
  email: string;
  model: string;
  at: string;
  promptChars: number;
  completionChars: number;
  elapsedMs: number;
  ok: boolean;
};

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function defaultDailyLimit() {
  return Number(process.env.DEFAULT_DAILY_CREDITS ?? "30");
}

function defaultTotalQuota() {
  return Number(process.env.DEFAULT_TOTAL_CREDITS ?? "1000");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function userKey(id: string) {
  return `user:${id}`;
}

function emailKey(email: string) {
  return `user:email:${normalizeEmail(email)}`;
}

export function toPublicUser(user: UserRecord): PublicUser {
  const normalized = resetDailyIfNeeded(user);
  const remainingDaily =
    normalized.dailyLimit < 0 ? -1 : Math.max(0, normalized.dailyLimit - normalized.dailyUsed);
  const remainingTotal =
    normalized.quotaTotal < 0 ? -1 : Math.max(0, normalized.quotaTotal - normalized.quotaUsed);
  const { passwordHash: _passwordHash, ...publicFields } = normalized;
  return {
    ...publicFields,
    remainingDaily,
    remainingTotal
  };
}

export function resetDailyIfNeeded(user: UserRecord): UserRecord {
  const today = todayKey();
  if (user.dailyReset === today) {
    return user;
  }
  return {
    ...user,
    dailyUsed: 0,
    dailyReset: today,
    updatedAt: new Date().toISOString()
  };
}

export async function saveUser(user: UserRecord) {
  await redisSetJson(userKey(user.id), user);
}

export async function getUserById(id: string) {
  const user = await redisGetJson<UserRecord>(userKey(id));
  if (!user) {
    return null;
  }
  const normalized = resetDailyIfNeeded(user);
  if (normalized !== user) {
    await saveUser(normalized);
  }
  return normalized;
}

export async function getUserByEmail(email: string) {
  const id = await redisCommand<string | null>(["GET", emailKey(email)]);
  if (!id) {
    return null;
  }
  return getUserById(id);
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
  role?: UserRole;
}) {
  const email = normalizeEmail(input.email);
  const existing = await redisCommand<string | null>(["GET", emailKey(email)]);
  if (existing) {
    throw new Error("这个邮箱已经注册。");
  }

  const now = new Date().toISOString();
  const user: UserRecord = {
    id: crypto.randomUUID(),
    email,
    name: input.name?.trim() || email.split("@")[0] || "用户",
    role: input.role ?? "user",
    status: "active",
    passwordHash: await hashPassword(input.password),
    dailyLimit: input.role === "admin" ? -1 : defaultDailyLimit(),
    dailyUsed: 0,
    dailyReset: todayKey(),
    quotaTotal: input.role === "admin" ? -1 : defaultTotalQuota(),
    quotaUsed: 0,
    allowedModels: PUBLIC_MODELS.map((model) => model.id),
    createdAt: now,
    updatedAt: now
  };

  await redisSetJson(userKey(user.id), user);
  await redisCommand<"OK">(["SET", emailKey(email), user.id]);
  await redisCommand<number>(["SADD", "users:index", user.id]);
  return user;
}

export async function validateLogin(email: string, password: string) {
  const adminEmail = process.env.ADMIN_EMAIL ? normalizeEmail(process.env.ADMIN_EMAIL) : "";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  const normalizedEmail = normalizeEmail(email);

  let user = await getUserByEmail(normalizedEmail);
  if (!user && adminEmail && adminPassword && normalizedEmail === adminEmail && password === adminPassword) {
    user = await createUser({
      email: normalizedEmail,
      password,
      name: "管理员",
      role: "admin"
    });
  }

  if (!user) {
    throw new Error("账号或密码不正确。");
  }

  const envAdminMatch = adminEmail && adminPassword && normalizedEmail === adminEmail && password === adminPassword;
  const passwordOk = envAdminMatch || (await verifyPassword(password, user.passwordHash));
  if (!passwordOk) {
    throw new Error("账号或密码不正确。");
  }

  if (user.status !== "active") {
    throw new Error("账号已被禁用，请联系管理员。");
  }

  const updated: UserRecord = {
    ...user,
    role: envAdminMatch ? "admin" : user.role,
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveUser(updated);
  return updated;
}

export async function listUsers() {
  const ids = await redisCommand<string[]>(["SMEMBERS", "users:index"]);
  const users = await Promise.all((ids ?? []).map((id) => getUserById(id)));
  return users
    .filter((user): user is UserRecord => Boolean(user))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateUserByAdmin(
  id: string,
  patch: Partial<
    Pick<UserRecord, "role" | "status" | "dailyLimit" | "quotaTotal" | "allowedModels" | "name"> & {
      resetDailyUsed: boolean;
      resetTotalUsed: boolean;
    }
  >
) {
  const user = await getUserById(id);
  if (!user) {
    throw new Error("用户不存在。");
  }

  const allowedIds = new Set(PUBLIC_MODELS.map((model) => model.id));
  const next: UserRecord = {
    ...user,
    name: typeof patch.name === "string" ? patch.name.trim().slice(0, 40) || user.name : user.name,
    role: patch.role === "admin" || patch.role === "user" ? patch.role : user.role,
    status: patch.status === "active" || patch.status === "disabled" ? patch.status : user.status,
    dailyLimit:
      typeof patch.dailyLimit === "number" && Number.isFinite(patch.dailyLimit)
        ? Math.max(-1, Math.floor(patch.dailyLimit))
        : user.dailyLimit,
    dailyUsed: patch.resetDailyUsed ? 0 : user.dailyUsed,
    quotaTotal:
      typeof patch.quotaTotal === "number" && Number.isFinite(patch.quotaTotal)
        ? Math.max(-1, Math.floor(patch.quotaTotal))
        : user.quotaTotal,
    quotaUsed: patch.resetTotalUsed ? 0 : user.quotaUsed,
    allowedModels: Array.isArray(patch.allowedModels)
      ? patch.allowedModels.filter((model) => allowedIds.has(model))
      : user.allowedModels,
    updatedAt: new Date().toISOString()
  };

  await saveUser(next);
  return next;
}

export function canUseModel(user: UserRecord, model: string) {
  return user.role === "admin" || user.allowedModels.includes(model);
}

export async function reserveCredit(userId: string) {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("用户不存在。");
  }
  if (user.status !== "active") {
    throw new Error("账号已被禁用。");
  }

  const adminBypass = process.env.ADMIN_BYPASS_QUOTA !== "false";
  if (user.role === "admin" && adminBypass) {
    return user;
  }

  const normalized = resetDailyIfNeeded(user);
  if (normalized.dailyLimit >= 0 && normalized.dailyUsed >= normalized.dailyLimit) {
    throw new Error("今日额度已用完。");
  }
  if (normalized.quotaTotal >= 0 && normalized.quotaUsed >= normalized.quotaTotal) {
    throw new Error("总额度已用完。");
  }

  const next: UserRecord = {
    ...normalized,
    dailyUsed: normalized.dailyUsed + 1,
    quotaUsed: normalized.quotaUsed + 1,
    updatedAt: new Date().toISOString()
  };
  await saveUser(next);
  return next;
}

export async function refundCredit(userId: string) {
  const user = await getUserById(userId);
  if (!user || (user.role === "admin" && process.env.ADMIN_BYPASS_QUOTA !== "false")) {
    return;
  }

  await saveUser({
    ...user,
    dailyUsed: Math.max(0, user.dailyUsed - 1),
    quotaUsed: Math.max(0, user.quotaUsed - 1),
    updatedAt: new Date().toISOString()
  });
}

export async function recordUsage(entry: UsageEntry) {
  const today = todayKey();
  await Promise.all([
    redisCommand<number>(["INCR", "stats:requests"]),
    redisCommand<number>(["INCRBY", "stats:prompt_chars", entry.promptChars]),
    redisCommand<number>(["INCRBY", "stats:completion_chars", entry.completionChars]),
    redisCommand<number>(["INCR", `stats:day:${today}:requests`]),
    redisCommand<number>(["LPUSH", `usage:user:${entry.userId}`, JSON.stringify(entry)]),
    redisCommand<number>(["LPUSH", "usage:recent", JSON.stringify(entry)])
  ]);
  await Promise.all([
    redisCommand<"OK">(["LTRIM", `usage:user:${entry.userId}`, 0, 99]),
    redisCommand<"OK">(["LTRIM", "usage:recent", 0, 199])
  ]);
}

export async function getAdminStats() {
  const [userCount, requests, promptChars, completionChars, recent, upstreamRecent] = await Promise.all([
    redisCommand<number>(["SCARD", "users:index"]),
    redisCommand<string | null>(["GET", "stats:requests"]),
    redisCommand<string | null>(["GET", "stats:prompt_chars"]),
    redisCommand<string | null>(["GET", "stats:completion_chars"]),
    redisCommand<string[]>(["LRANGE", "usage:recent", 0, 20]),
    redisCommand<string[]>(["LRANGE", "upstream:nvidia:recent", 0, 20])
  ]);

  return {
    userCount,
    requests: Number(requests ?? 0),
    promptChars: Number(promptChars ?? 0),
    completionChars: Number(completionChars ?? 0),
    recent: (recent ?? []).map((item) => JSON.parse(item) as UsageEntry),
    upstreamRecent: (upstreamRecent ?? []).map((item) => JSON.parse(item) as unknown)
  };
}
