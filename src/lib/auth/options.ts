import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
// Native (Rust/napi) bcrypt for the login hot path only - measured ~1.2x
// faster than bcryptjs at the same cost factor (10) and produces/accepts the
// identical $2b$ hash format, so existing passwordHash rows compare
// correctly with no migration. Cost factor is unchanged; this is a pure
// implementation swap, not a security weakening. Password/hash CREATION
// (actions/staff.ts, actions/security.ts, prisma/seed.ts,
// bootstrap-admin.ts) stays on bcryptjs - it's not on the login critical
// path and wasn't shown to be a bottleneck.
import { compare as bcryptCompare } from "@node-rs/bcrypt";
import { prisma } from "@/lib/db/prisma";
import { checkRateLimit } from "@/lib/security/rateLimit";

function clientIpFromHeaders(headers: Record<string, unknown> | undefined): string {
  const raw = headers?.["x-forwarded-for"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.split(",")[0].trim() : "unknown";
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        loginEmail: { label: "メールアドレス", type: "email" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.loginEmail || !credentials?.password) return null;

        // TEMPORARY (login-perf investigation, see .claude/plans): stage
        // timing behind PERF_DEBUG. Never logs email/password/hash/token.
        const perf = process.env.PERF_DEBUG === "1";
        const t0 = performance.now();

        // Brute-force protection: limits both a single IP hammering many
        // emails and many IPs hammering one email, per plan §10. Checked
        // before touching the DB/bcrypt so a lockout is cheap for the server too.
        const ip = clientIpFromHeaders(req.headers);
        const [ipLimit, emailLimit] = await Promise.all([
          checkRateLimit({ key: `login-ip:${ip}`, limit: 20, windowSeconds: 15 * 60 }),
          checkRateLimit({ key: `login-email:${credentials.loginEmail}`, limit: 10, windowSeconds: 15 * 60 }),
        ]);
        const t1 = performance.now();
        if (perf) console.log(`[perf:authorize] rateLimit ${(t1 - t0).toFixed(1)}ms`);
        if (!ipLimit.ok || !emailLimit.ok) return null;

        const staff = await prisma.staff.findUnique({
          where: { loginEmail: credentials.loginEmail },
          select: { id: true, displayName: true, loginEmail: true, passwordHash: true, mustChangePassword: true, active: true },
        });
        const t2 = performance.now();
        if (perf) console.log(`[perf:authorize] staffLookup ${(t2 - t1).toFixed(1)}ms`);
        if (!staff || !staff.active) return null;

        const passwordMatches = await bcryptCompare(credentials.password, staff.passwordHash);
        const t3 = performance.now();
        if (perf) console.log(`[perf:authorize] bcryptCompare ${(t3 - t2).toFixed(1)}ms`);
        if (!passwordMatches) return null;

        if (perf) console.log(`[perf:authorize] total ${(t3 - t0).toFixed(1)}ms`);
        return {
          id: staff.id,
          name: staff.displayName,
          email: staff.loginEmail,
          mustChangePassword: staff.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const t0 = performance.now();
      if (user) {
        token.staffId = user.id;
        token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
      }
      if (process.env.PERF_DEBUG === "1") console.log(`[perf:jwt] ${(performance.now() - t0).toFixed(1)}ms`);
      return token;
    },
    async session({ session, token }) {
      const t0 = performance.now();
      if (session.user) {
        session.staffId = token.staffId as string;
        session.mustChangePassword = token.mustChangePassword as boolean;
      }
      if (process.env.PERF_DEBUG === "1") console.log(`[perf:session] ${(performance.now() - t0).toFixed(1)}ms`);
      return session;
    },
  },
};
