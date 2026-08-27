import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    staffId: string;
    mustChangePassword: boolean;
    user: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    staffId: string;
    mustChangePassword: boolean;
  }
}
