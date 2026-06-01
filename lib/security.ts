type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function getClientId(headerList: Headers) {
  const forwarded = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  const country = headerList.get("x-vercel-ip-country") ?? "unknown";
  const ip = forwarded?.split(",")[0]?.trim() || realIp || "unknown";
  return `${ip}:${country}`;
}

type RateLimitOptions = {
  maxRequests?: number;
  windowSeconds?: number;
};

async function enforceUpstashRateLimit(clientId: string, options: RateLimitOptions = {}) {
  const redisUrl =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_KV_URL ||
    "";
  const redisToken =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_KV_REST_API_READ_ONLY_TOKEN ||
    "";

  if (!redisUrl || !redisToken) {
    return null;
  }

  const windowSeconds = options.windowSeconds ?? Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60");
  const maxRequests = options.maxRequests ?? Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? "12");
  const key = `rate:${clientId}`;

  const increment = await fetch(`${redisUrl}/incr/${encodeURIComponent(key)}`, {
    headers: {
      Authorization: `Bearer ${redisToken}`
    },
    cache: "no-store"
  });

  if (!increment.ok) {
    return null;
  }

  const incrementPayload = (await increment.json()) as { result?: number };
  const count = Number(incrementPayload.result ?? 1);

  if (count === 1) {
    await fetch(`${redisUrl}/expire/${encodeURIComponent(key)}/${Math.max(10, windowSeconds)}`, {
      headers: {
        Authorization: `Bearer ${redisToken}`
      },
      cache: "no-store"
    });
  }

  return {
    ok: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt: Date.now() + Math.max(10, windowSeconds) * 1000
  };
}

function enforceMemoryRateLimit(clientId: string, options: RateLimitOptions = {}) {
  const windowSeconds = options.windowSeconds ?? Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60");
  const maxRequests = options.maxRequests ?? Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? "12");
  const now = Date.now();
  const windowMs = Math.max(10, windowSeconds) * 1000;
  const current = buckets.get(clientId);

  if (!current || current.resetAt <= now) {
    buckets.set(clientId, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (current.count >= maxRequests) {
    return { ok: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  buckets.set(clientId, current);
  return {
    ok: true,
    remaining: Math.max(0, maxRequests - current.count),
    resetAt: current.resetAt
  };
}

export async function enforceRateLimit(clientId: string, options: RateLimitOptions = {}) {
  const durable = await enforceUpstashRateLimit(clientId, options);
  if (durable) {
    return durable;
  }
  return enforceMemoryRateLimit(clientId, options);
}

export function verifySitePassword(password: unknown) {
  const configured = process.env.PUBLIC_SITE_PASSWORD;
  if (!configured) {
    return true;
  }
  return typeof password === "string" && password === configured;
}

export async function verifyTurnstile(token: unknown, clientIp: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return true;
  }

  if (typeof token !== "string" || token.length < 10) {
    return false;
  }

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  form.append("remoteip", clientIp.split(":")[0] ?? "");

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    return false;
  }

  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
}
