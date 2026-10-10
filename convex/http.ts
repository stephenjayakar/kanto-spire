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
    "Access-Control-Expose-Headers": "X-Pack-Hash, X-Pack-Enc",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// GET /pack?name=gfx with "Authorization: Bearer <Convex Auth token>": one asset pack, for allowed accounts only.
// v0.3.21 clients add &h=<hash> (the manifest's): when it is the current pack the response may be kept for a year
// (the URL names exactly these bytes), and &enc=gzip for the gzipped copy (X-Pack-Enc says which one came back).
// X-Pack-Hash is always the hash of the plain pack. Without h (older clients) nothing is cached, as before.
http.route({
  path: "/pack",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const cors = corsHeaders(req);
    const deny = (status: number, msg: string) => new Response(msg, { status, headers: { ...cors, "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    const userId = await getAuthUserId(ctx).catch(() => null); // a malformed or expired token throws
    if (!userId) return deny(401, "Sign in first.");
    if (!(await ctx.runQuery(internal.access.userAllowed, { userId }))) return deny(403, "This account is not allowed to play.");
    const params = new URL(req.url).searchParams;
    const name = params.get("name") || "", h = params.get("h"), gzip = params.get("enc") === "gzip";
    const pack = await ctx.runQuery(internal.packs.byName, { name });
    if (!pack) return deny(404, "No such pack.");
    const zipped = gzip && !!pack.zStorageId;
    const blob = await ctx.storage.get(zipped && pack.zStorageId ? pack.zStorageId : pack.storageId);
    if (!blob) return deny(404, "Pack data missing.");
    const pinned = !!h && h === pack.hash; // (a stale hash still gets the current pack, just not cached)
    return new Response(blob, {
      status: 200,
      headers: {
        ...cors, "Content-Type": "application/octet-stream", "X-Pack-Hash": pack.hash, "X-Pack-Enc": zipped ? "gzip" : "identity",
        "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, no-store",
      },
    });
  }),
});

http.route({
  path: "/pack",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req) })),
});

export default http;
