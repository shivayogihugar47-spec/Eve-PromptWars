import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth";
import { getAuth } from "@/lib/auth/server";

type AuthHandlers = ReturnType<ReturnType<typeof getAuth>["handler"]>;
type RouteContext = { params: Promise<{ path: string[] }> };

function routeHandler(method: keyof AuthHandlers) {
  return async (request: Request, context: RouteContext) => {
    if (!authConfig.isConfigured) {
      return NextResponse.json({ error: "Account sign-in is not configured for this deployment." }, { status: 503 });
    }
    return getAuth().handler()[method](request, context);
  };
}

export const GET = routeHandler("GET");
export const POST = routeHandler("POST");
export const PUT = routeHandler("PUT");
export const PATCH = routeHandler("PATCH");
export const DELETE = routeHandler("DELETE");
