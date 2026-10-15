// Configure production values first; never publish if configuration fails.
import { spawn } from "node:child_process";
import { vercelCommand } from "./vercel-cli.mjs";
process.loadEnvFile(".env.local");
const origin = new URL(process.env.APP_URL);
if (
  origin.protocol !== "https:" ||
  ["localhost", "127.0.0.1"].includes(origin.hostname)
)
  throw Error("APP_URL must be the production HTTPS origin before deployment.");
if (new URL(process.env.SUPABASE_URL).protocol !== "https:")
  throw Error("SUPABASE_URL must use HTTPS before production deployment.");
await import("./configure-vercel-env.mjs");
const code = await new Promise((resolve, reject) => {
  const [command, args] = vercelCommand(["--prod", "--yes"]);
  const child = spawn(command, args, {
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("close", (code) => resolve(code ?? 1));
});
process.exitCode = code;
