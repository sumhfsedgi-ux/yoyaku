import { PrismaClient } from "@/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * Runtime PrismaClient. Connects through DATABASE_URL.
 *
 * Two driver adapters are supported:
 *  - @prisma/adapter-neon (HTTP/WebSocket) against Neon's pooled endpoint in
 *    production - this is what the plan calls for on Vercel, since it avoids
 *    holding TCP connections open across serverless invocations.
 *  - @prisma/adapter-pg (plain node-postgres/TCP) against local Docker/native
 *    Postgres in development and tests - Neon's WebSocket driver only speaks
 *    to Neon's own proxy infrastructure and cannot reach a generic Postgres
 *    server, so it is unusable for local dev.
 *
 * Which one is used is decided by the DATABASE_URL's host: a "neon.tech" host
 * (or an explicit DATABASE_DRIVER=neon override) selects adapter-neon;
 * anything else (localhost, a Docker container, etc.) selects adapter-pg.
 *
 * IMPORTANT - session timezone: @prisma/adapter-pg (7.9.1) serializes outgoing
 * Date parameters for timestamptz columns as a bare "YYYY-MM-DD HH:mm:ss"
 * string built from the UTC getters, with NO timezone marker (see its
 * formatDateTime()). Postgres interprets a timezone-less literal using the
 * CONNECTION's `timezone` session setting - so if that setting isn't UTC, the
 * stored instant silently drifts by the session's offset. This is exactly
 * what happened during development against a local Windows PostgreSQL
 * install, whose installer had defaulted the session timezone to the OS
 * locale (Asia/Tokyo) rather than UTC: reservations were silently stored 9
 * hours off from the intended instant. A separate quirk in the adapter's
 * READ path happened to invert the same offset, so `prisma.reservation
 * .findUnique(...).startAt` looked correct even though the raw stored value
 * (verified independently via psql) was wrong - which is exactly the kind of
 * bug that stays invisible until something reads the data outside Prisma
 * (raw SQL, a report, the EXCLUDE constraint's own overlap comparison).
 *
 * Fix applied at the database level (ALTER ROLE/DATABASE ... SET timezone TO
 * 'UTC') for the local dev Postgres. The `options: '-c TimeZone=UTC'` pool
 * config below is a defense-in-depth backstop so this app is correct even
 * against a Postgres instance nobody remembered to configure. This must be a
 * startup parameter, not a `client.query("SET TIME ZONE...")` run from a
 * pool `'connect'` listener - pg-pool's `connect` event is a synchronous
 * EventEmitter emit that does not await listeners, so an async setup query
 * there races the pool handing that same connection to Prisma's own first
 * query (confirmed via pg's "already executing a query" warning). The
 * `options` startup parameter is applied atomically by Postgres during
 * connection establishment, before any query can run on it.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function shouldUseNeonAdapter(databaseUrl: string): boolean {
  if (process.env.DATABASE_DRIVER === "neon") return true;
  if (process.env.DATABASE_DRIVER === "pg") return false;
  try {
    return new URL(databaseUrl).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;

  if (shouldUseNeonAdapter(connectionString)) {
    // Neon is a managed Postgres service and defaults new connections to a
    // UTC session timezone, so the adapter-pg pitfall documented above does
    // not apply here in practice. If that were ever not the case, the fix is
    // the same idea as below, applied to @neondatabase/serverless's Pool.
    return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
  }

  const pool = new Pool({ connectionString, options: "-c TimeZone=UTC" });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
