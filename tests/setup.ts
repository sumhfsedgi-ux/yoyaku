import { config } from "dotenv";
import path from "node:path";

// Integration tests run against the yoyaku_test database and always use the fake
// Google Calendar/Gmail ports (see src/lib/google/*/factory.ts) - real credentials
// are never required to run the test suite.
config({ path: path.resolve(__dirname, "../.env.test") });
