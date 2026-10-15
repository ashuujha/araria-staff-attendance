import { test } from "node:test";
import assert from "node:assert/strict";
import { vercelCommand, safeDiagnostic } from "../scripts/vercel-cli.mjs";

test("deployment uses a valid override and rejects expired paths", () => {
  assert.deepEqual(
    vercelCommand(["--prod"], { VERCEL_CLI_PATH: import.meta.filename }),
    [process.execPath, [import.meta.filename, "--prod"]],
  );
  assert.throws(
    () => vercelCommand([], { VERCEL_CLI_PATH: "/missing/vercel.js" }),
    /does not exist/,
  );
});
test("deployment resolves CLI without hardcoded npm cache hashes", () => {
  const [command, args] = vercelCommand(["env", "ls"], {});
  assert.ok(command);
  assert.deepEqual(args.slice(-2), ["env", "ls"]);
  assert.ok(!args.join(" ").includes("69f9afb961c37556"));
});
test("CLI diagnostics preserve failures while redacting configured values", () => {
  const result = safeDiagnostic(
    "Error: token abc-secret-value denied; Bearer hidden-token",
    { TOKEN: "abc-secret-value" },
  );
  assert.match(result, /denied/);
  assert.ok(!result.includes("abc-secret-value"));
  assert.ok(!result.includes("hidden-token"));
});
