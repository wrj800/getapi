import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAdminStats } from "@/lib/users";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return Response.json(await getAdminStats());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "没有权限。" },
      { status: 403 }
    );
  }
}
