import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one real Postgres database and each file's
    // resetDb() wipes ALL app tables in beforeEach - running test files in
    // parallel (Vitest's default) lets one file's reset delete another file's
    // in-progress fixtures mid-test, causing nondeterministic FK/count
    // failures. Unit tests don't touch the DB, so serializing everything here
    // costs little and removes that whole class of flakiness.
    fileParallelism: false,
  },
});
