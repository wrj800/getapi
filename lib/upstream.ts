import { redisCommand } from "@/lib/store";

export type UpstreamSelection = {
  apiKey: string;
  keyLabel: string;
  baseUrl: string;
};

function parseKeyPool() {
  const pool = process.env.NVIDIA_API_KEYS || process.env.NVIDIA_API_KEY || "";
  return pool
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function maskKey(key: string) {
  if (key.length <= 14) {
    return "***";
  }
  return `${key.slice(0, 8)}...${key.slice(-5)}`;
}

export function hasUpstreamKeys() {
  return parseKeyPool().length > 0;
}

export async function pickUpstreamKey(): Promise<UpstreamSelection> {
  const keys = parseKeyPool();
  if (keys.length === 0) {
    throw new Error("服务端还没有配置 NVIDIA_API_KEY 或 NVIDIA_API_KEYS。");
  }

  let index = 0;
  if (keys.length > 1) {
    try {
      const counter = await redisCommand<number>(["INCR", "upstream:nvidia:counter"]);
      index = Math.abs(counter - 1) % keys.length;
    } catch {
      index = Math.floor(Math.random() * keys.length);
    }
  }

  const apiKey = keys[index];
  return {
    apiKey,
    keyLabel: `key-${index + 1}:${maskKey(apiKey)}`,
    baseUrl: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1"
  };
}

export async function recordUpstreamResult(input: {
  keyLabel: string;
  model: string;
  ok: boolean;
  status: number;
  elapsedMs: number;
}) {
  const prefix = `upstream:nvidia:${input.keyLabel}`;
  await Promise.all([
    redisCommand<number>(["INCR", `${prefix}:requests`]).catch(() => 0),
    redisCommand<number>(["INCR", input.ok ? `${prefix}:ok` : `${prefix}:fail`]).catch(() => 0),
    redisCommand<number>(["LPUSH", "upstream:nvidia:recent", JSON.stringify(input)]).catch(() => 0),
    redisCommand<number>(["LTRIM", "upstream:nvidia:recent", 0, 99]).catch(() => 0)
  ]);
}
