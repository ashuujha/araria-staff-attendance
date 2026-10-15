// Send environment values via stdin, never command arguments or console output.
import { spawn } from "node:child_process";
import { vercelCommand, safeDiagnostic } from "./vercel-cli.mjs";
process.loadEnvFile(".env.local");
for (const key of [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_AUTH_FORWARD_IP",
  "APP_URL",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "UPLOAD_SCAN_URL",
  "UPLOAD_SCAN_TOKEN",
  "GOOGLE_TRANSLATE_API_KEY",
  "PHOTON_REVERSE_URL",
  "OSM_TILE_BASE_URL",
  "CRON_SECRET",
  "GOOGLE_SHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
]) {
  const value = process.env[key];
  if (!value) continue;
  await new Promise((resolve, reject) => {
    const [command, args] = vercelCommand([
      "env",
      "add",
      key,
      "production",
      "--force",
      "--yes",
    ]);
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.stdin.on("error", () => {}); // CLI may exit before reading stdin.
    child.stdin.end(value);
    child.on("close", (code) => {
      if (code !== 0)
        reject(Error("Failed to set " + key + ":\n" + safeDiagnostic(output)));
      else {
        console.log("Configured production " + key);
        resolve();
      }
    });
  });
}
