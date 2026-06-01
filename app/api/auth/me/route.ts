import { NextRequest } from "next/server";
import { authResponse, getSessionUser } from "@/lib/auth";
import { hasStoreConfig } from "@/lib/store";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  if (!hasStoreConfig()) {
    return Response.json({ user: null, storeConfigured: false });
  }

  const user = await getSessionUser(request);
  return Response.json({
    user: user ? authResponse(user).user : null,
    storeConfigured: true
  });
}
