// Local verification only. Production uses Next.js, including its real API routes.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const esbuild = process.env.ARARIA_ESBUILD_PATH
  ? require(process.env.ARARIA_ESBUILD_PATH)
  : require("esbuild");
await mkdir(".preview", { recursive: true });
await writeFile(
  ".preview/entry.tsx",
  "import React from 'react'; import {createRoot} from 'react-dom/client'; import Portal from '../src/components/Portal';createRoot(document.getElementById('root')!).render(<Portal/>);",
);
await esbuild.build({
  entryPoints: [".preview/entry.tsx"],
  bundle: true,
  outfile: ".preview/app.js",
  jsx: "automatic",
  minify: true,
  nodePaths: process.env.ARARIA_NODE_PATH ? [process.env.ARARIA_NODE_PATH] : [],
  define: { "process.env.NODE_ENV": '"production"' },
});
const css = (await readFile("src/app/globals.css", "utf8")).replace(
  "@import 'tailwindcss';",
  "",
);
await writeFile(".preview/app.css", css);
const html =
  '<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>अररिया | कर्मी उपस्थिति पोर्टल</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        error:
          "Live backend setup pending. लॉगिन के लिए Supabase कॉन्फ़िगरेशन आवश्यक है।",
      }),
    );
  }
  const name =
    req.url === "/app.js"
      ? "app.js"
      : req.url === "/app.css"
        ? "app.css"
        : null;
  res.setHeader(
    "Content-Type",
    name?.endsWith("js")
      ? "text/javascript"
      : name
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  res.end(name ? await readFile(resolve(".preview", name)) : html);
});
server.listen(3000, "127.0.0.1", () =>
  console.log("Offline interface preview: http://127.0.0.1:3000"),
);
