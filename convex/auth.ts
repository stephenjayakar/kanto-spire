import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      profile(p) {
        const email = String(p.email || "").toLowerCase();
        if (!p.email_verified) throw new Error(`${email || "This account"} has no verified email.`);
        return { id: p.sub, name: p.name, email, image: p.picture };
      },
    }),
  ],
  callbacks: {
    // Anyone with a verified Google email may sign in (needed to redeem an invite link); every
    // function and the asset packs still require the allowedEmails table.
    // The game is served from more than one origin (the hosted site and localhost), so accept any
    // origin listed in SITE_URL (comma-separated) instead of only one.
    async redirect({ redirectTo }) {
      const origins = (process.env.SITE_URL || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
      for (const o of origins) {
        if (redirectTo === o || redirectTo.startsWith(o + "/") || redirectTo.startsWith(o + "?")) return redirectTo;
      }
      if (origins[0] && (redirectTo.startsWith("/") || redirectTo.startsWith("?"))) return origins[0] + redirectTo;
      throw new Error(`Invalid redirectTo ${redirectTo}`);
    },
  },
});
