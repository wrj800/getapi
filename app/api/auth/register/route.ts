import { NextRequest } from "next/server";
import { authResponse, createSessionCookie } from "@/lib/auth";
import { consumeInvite } from "@/lib/invites";
import { enforceRateLimit, getClientId } from "@/lib/security";
import { createUser } from "@/lib/users";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  if (process.env.ALLOW_PUBLIC_REGISTER === "false") {
    return Response.json({ error: "当前未开放公开注册。" }, { status: 403 });
  }

  try {
    const rate = await enforceRateLimit(`register:${getClientId(request.headers)}`, {
      maxRequests: Number(process.env.REGISTER_RATE_LIMIT_MAX ?? "4"),
      windowSeconds: Number(process.env.REGISTER_RATE_LIMIT_WINDOW_SECONDS ?? "3600")
    });
    if (!rate.ok) {
      return Response.json({ error: "注册太频繁，请稍后再试。" }, { status: 429 });
    }

    const body = (await request.json()) as {
      email?: string;
      password?: string;
      name?: string;
      inviteCode?: string;
    };
    if (!body.email || !body.password) {
      return Response.json({ error: "请输入邮箱和密码。" }, { status: 400 });
    }
    if (body.password.length < 8) {
      return Response.json({ error: "密码至少 8 位。" }, { status: 400 });
    }

    if (process.env.REQUIRE_INVITE_CODE !== "false") {
      await consumeInvite(body.inviteCode ?? "");
    }

    const user = await createUser({
      email: body.email,
      password: body.password,
      name: body.name
    });

    return Response.json(authResponse(user), {
      headers: {
        "Set-Cookie": await createSessionCookie(user.id)
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "注册失败。" },
      { status: 400 }
    );
  }
}
