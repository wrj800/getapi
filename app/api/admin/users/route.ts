import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listUsers, toPublicUser, updateUserByAdmin } from "@/lib/users";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const users = await listUsers();
    return Response.json({ users: users.map(toPublicUser) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "没有权限。" },
      { status: 403 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as {
      id?: string;
      role?: "user" | "admin";
      status?: "active" | "disabled";
      dailyLimit?: number;
      quotaTotal?: number;
      allowedModels?: string[];
      name?: string;
      resetDailyUsed?: boolean;
      resetTotalUsed?: boolean;
    };
    if (!body.id) {
      return Response.json({ error: "缺少用户 ID。" }, { status: 400 });
    }

    const user = await updateUserByAdmin(body.id, body);
    return Response.json({ user: toPublicUser(user) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新失败。" },
      { status: 400 }
    );
  }
}
