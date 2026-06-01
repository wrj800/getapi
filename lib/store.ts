export class StoreNotConfiguredError extends Error {
  constructor() {
    super("未配置持久化存储。请在 Vercel 环境变量里设置 KV_REST_API_URL/KV_REST_API_TOKEN 或 UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN。");
  }
}

type RedisPayload<T> = {
  result?: T;
  error?: string;
};

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

export function hasStoreConfig() {
  const { url, token } = getRedisConfig();
  return Boolean(url && token);
}

export async function redisCommand<T>(command: unknown[]) {
  const { url, token } = getRedisConfig();

  if (!url || !token) {
    throw new StoreNotConfiguredError();
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => ({}))) as RedisPayload<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Redis command failed: ${response.status}`);
  }

  return payload.result as T;
}

export async function redisGetJson<T>(key: string) {
  const value = await redisCommand<string | null>(["GET", key]);
  if (!value) {
    return null;
  }
  return JSON.parse(value) as T;
}

export async function redisSetJson(key: string, value: unknown) {
  await redisCommand<"OK">(["SET", key, JSON.stringify(value)]);
}

export async function redisDelete(key: string) {
  await redisCommand<number>(["DEL", key]);
}
