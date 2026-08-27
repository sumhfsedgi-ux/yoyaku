import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Mirror Next.js's own env-file layering: real shell-exported env vars win over
// .env.local, which wins over .env. dotenv's config() never overwrites a
// variable that's already set, so loading narrowest-first (and never passing
// override:true) gives exactly that precedence.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// Prisma 7 config. The CLI (migrate/studio/db pull/db seed) connects using
// datasource.url below - this must be a DIRECT (non-pooled) connection, since
// `prisma migrate` needs advisory locks and DDL that a pooled/serverless
// endpoint (e.g. Neon's pgbouncer-style pooler) does not handle well.
//
// This is intentionally a different connection from the app's runtime
// PrismaClient (see src/lib/db/prisma.ts), which uses DATABASE_URL (the pooled
// endpoint) through @prisma/adapter-neon. Driver adapters no longer need to be
// wired up here explicitly for migrations as of Prisma 7 - the CLI handles that
// automatically based on the schema's `provider`.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
