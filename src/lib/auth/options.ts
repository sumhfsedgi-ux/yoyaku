import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
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

        // Brute-force protection: limits both a single IP hammering many
        // emails and many IPs hammering one email, per plan §10. Checked
        // before touching the DB/bcrypt so a lockout is cheap for the server too.
        const ip = clientIpFromHeaders(req.headers);
        const [ipLimit, emailLimit] = await Promise.all([
          checkRateLimit({ key: `login-ip:${ip}`, limit: 20, windowSeconds: 15 * 60 }),
          checkRateLimit({ key: `login-email:${credentials.loginEmail}`, limit: 10, windowSeconds: 15 * 60 }),
        ]);
        if (!ipLimit.ok || !emailLimit.ok) return null;

        const staff = await prisma.staff.findUnique({ where: { loginEmail: credentials.loginEmail } });
        if (!staff || !staff.active) return null;

        const passwordMatches = await bcrypt.compare(credentials.password, staff.passwordHash);
        if (!passwordMatches) return null;

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
      if (user) {
        token.staffId = user.id;
        token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.staffId = token.staffId as string;
        session.mustChangePassword = token.mustChangePassword as boolean;
      }
      return session;
    },
  },
};
