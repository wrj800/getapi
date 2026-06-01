import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createInvite, disableInvite, listInvites } from "@/lib/invites";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return Response.json({ invites: await listInvites() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "没有权限。" },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = (await request.json().catch(() => ({}))) as { note?: string; maxUses?: number };
    const invite = await createInvite({
      createdBy: admin.id,
      note: body.note,
      maxUses: body.maxUses
    });
    return Response.json({ invite });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "创建邀请码失败。" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as { code?: string };
    if (!body.code) {
      return Response.json({ error: "缺少邀请码。" }, { status: 400 });
    }
    return Response.json({ invite: await disableInvite(body.code) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新邀请码失败。" },
      { status: 400 }
    );
  }
}
