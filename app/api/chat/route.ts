import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildSystemPrompt, sanitizeMessages } from "@/lib/chat";
import { MODEL_ID_SET } from "@/lib/models";
import { getClientId } from "@/lib/security";
import { pickUpstreamKey, recordUpstreamResult } from "@/lib/upstream";
import {
  canUseModel,
  recordUsage,
  refundCredit,
  reserveCredit,
  toPublicUser
} from "@/lib/users";

export const runtime = "edge";

type RequestBody = {
  model?: unknown;
  messages?: unknown;
  turnstileToken?: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function extractCompletionTextFromSse(chunk: string) {
  let output = "";
  const lines = chunk.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const payload = JSON.parse(data);
      const text = payload?.choices?.[0]?.delta?.content;
      if (typeof text === "string") {
        output += text;
      }
    } catch {
      // Streaming chunks may be partial; this is only best-effort usage logging.
    }
  }
  return output;
}

export async function POST(request: NextRequest) {
  let upstreamKey;
  try {
    upstreamKey = await pickUpstreamKey();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "服务端还没有配置上游 key。", 500);
  }

  let user;
  try {
    user = await requireUser(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "请先登录。", 401);
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonError("请求体不是有效 JSON。", 400);
  }

  const model = typeof body.model === "string" ? body.model : "";
  if (!MODEL_ID_SET.has(model)) {
    return jsonError("模型不在本站白名单内。", 400);
  }

  if (!canUseModel(user, model)) {
    return jsonError("你的账号暂未开放这个模型。", 403);
  }

  const userMessages = sanitizeMessages(body.messages);
  if (!userMessages.some((message) => message.role === "user")) {
    return jsonError("请输入问题后再发送。", 400);
  }

  try {
    user = await reserveCredit(user.id);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "额度不足。", 402);
  }

  const maxTokens = Number(process.env.MAX_OUTPUT_TOKENS ?? "1800");
  const promptChars = userMessages.reduce((sum, message) => sum + message.content.length, 0);
  const startedAt = Date.now();

  const upstreamPayload = {
    model,
    stream: true,
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: Math.min(Math.max(maxTokens, 256), 4096),
    messages: [{ role: "system", content: buildSystemPrompt() }, ...userMessages]
  };

  const upstream = await fetch(`${upstreamKey.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${upstreamKey.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(upstreamPayload)
  });

  if (!upstream.ok || !upstream.body) {
    await refundCredit(user.id);
    const text = await upstream.text();
    const safeText = text.slice(0, 600);
    await recordUpstreamResult({
      keyLabel: upstreamKey.keyLabel,
      model,
      ok: false,
      status: upstream.status,
      elapsedMs: Date.now() - startedAt
    });
    return jsonError(`上游模型调用失败：${upstream.status} ${safeText}`, upstream.status || 502);
  }

  const clientId = getClientId(request.headers);
  const decoder = new TextDecoder();
  let completionChars = 0;

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      completionChars += extractCompletionTextFromSse(text).length;
      controller.enqueue(chunk);
    },
    async flush() {
      await recordUsage({
        userId: user.id,
        email: user.email,
        model,
        at: new Date().toISOString(),
        promptChars,
        completionChars,
        elapsedMs: Date.now() - startedAt,
        ok: true
      }).catch(() => undefined);
      await recordUpstreamResult({
        keyLabel: upstreamKey.keyLabel,
        model,
        ok: true,
        status: upstream.status,
        elapsedMs: Date.now() - startedAt
      });
    }
  });

  return new Response(upstream.body.pipeThrough(stream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Client-Id": clientId,
      "X-User-Quota": encodeURIComponent(JSON.stringify(toPublicUser(user)))
    }
  });
}
