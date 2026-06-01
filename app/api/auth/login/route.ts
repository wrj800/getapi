import { NextRequest } from "next/server";
import { authResponse, createSessionCookie } from "@/lib/auth";
import { enforceRateLimit, getClientId } from "@/lib/security";
import { validateLogin } from "@/lib/users";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const rate = await enforceRateLimit(`login:${getClientId(request.headers)}`, {
      maxRequests: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? "8"),
      windowSeconds: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS ?? "300")
    });
    if (!rate.ok) {
      return Response.json({ error: "登录尝试太频繁，请稍后再试。" }, { status: 429 });
    }

    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return Response.json({ error: "请输入邮箱和密码。" }, { status: 400 });
    }

    const user = await validateLogin(body.email, body.password);
    return Response.json(authResponse(user), {
      headers: {
        "Set-Cookie": await createSessionCookie(user.id)
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "登录失败。" },
      { status: 401 }
    );
  }
}
