import { httpRouter } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

// CORS: only the game's own origins (SITE_URL, comma-separated) may read packs.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const origins = (process.env.SITE_URL || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (!origins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Expose-Headers": "X-Pack-Hash",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// GET /pack?name=gfx with "Authorization: Bearer <Convex Auth token>": one asset pack, for allowed accounts only.
http.route({
  path: "/pack",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const cors = corsHeaders(req);
    const deny = (status: number, msg: string) => new Response(msg, { status, headers: { ...cors, "Content-Type": "text/plain" } });
    const userId = await getAuthUserId(ctx).catch(() => null); // a malformed or expired token throws
    if (!userId) return deny(401, "Sign in first.");
    if (!(await ctx.runQuery(internal.access.userAllowed, { userId }))) return deny(403, "This account is not allowed to play.");
    const name = new URL(req.url).searchParams.get("name") || "";
    const pack = await ctx.runQuery(internal.packs.byName, { name });
    if (!pack) return deny(404, "No such pack.");
    const blob = await ctx.storage.get(pack.storageId);
    if (!blob) return deny(404, "Pack data missing.");
    return new Response(blob, {
      status: 200,
      headers: { ...cors, "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Pack-Hash": pack.hash },
    });
  }),
});

http.route({
  path: "/pack",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req) })),
});

export default http;
