/**
 * TEST ONLY. A standalone worker process invoked by
 * test/conditional-append-concurrency.test.ts to exercise real,
 * multi-process contention for insertEntryIfVerifiedHead against the same
 * SQLite file. Registers the fake-keyring loader itself (see
 * fake-keyring-loader.mjs) — production code never does this.
 *
 * Imports the BUILT dist/db.js (not src/) — the caller is responsible for
 * running `npm run build` first, so this exercises the exact code that
 * would ship, not a TS-transform-time copy.
 *
 * argv: [expectedHead ("null" for null), content]
 * stdout: the JSON-serialized ConditionalAppendResult.
 */
import { register } from "node:module";

register(new URL("./fake-keyring-loader.mjs", import.meta.url).href);

const { insertEntryIfVerifiedHead } = await import("../../dist/db.js");

const [, , expectedHeadArg, content] = process.argv;
const expectedHead = expectedHeadArg === "null" ? null : expectedHeadArg;

const result = insertEntryIfVerifiedHead({ expectedHead, content });
process.stdout.write(JSON.stringify(result));
