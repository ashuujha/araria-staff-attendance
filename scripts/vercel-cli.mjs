import { existsSync } from "node:fs";
import { createRequire } from "node:module";

export function vercelCommand(args, env = process.env) {
  if (env.VERCEL_CLI_PATH) {
    if (!existsSync(env.VERCEL_CLI_PATH))
      throw Error(
        "VERCEL_CLI_PATH does not exist. Remove this override or correct its path.",
      );
    return [process.execPath, [env.VERCEL_CLI_PATH, ...args]];
  }
  try {
    const require = createRequire(import.meta.url);
    const cli = require.resolve("vercel/dist/index.js");
    return [process.execPath, [cli, ...args]];
  } catch {
    // npm owns its cache location; never depend on a temporary _npx hash.
    return ["npx", ["--yes", "vercel@63.1.0", ...args]];
  }
}

export function safeDiagnostic(output, env = process.env) {
  let result = String(output).replace(/\x1b\[[0-9;]*m/g, "");
  for (const value of Object.values(env)
    .filter((v) => typeof v === "string" && v.length >= 8)
    .sort((a, b) => b.length - a.length))
    result = result.split(value).join("[redacted]");
  return result.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(-4000);
}
