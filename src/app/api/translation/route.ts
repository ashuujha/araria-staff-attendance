import { englishCatalog } from "../../../lib/portal-language-catalog";
type Result = {
  provider: "local" | "google";
  translations: Record<string, string>;
};
let cached: Promise<Result> | undefined;
let cachedAt = 0;
let cachedKey: string | undefined;
const local: Result = { provider: "local", translations: englishCatalog };
async function translateCatalog(key: string): Promise<Result> {
  try {
    const catalog = Object.keys(englishCatalog);
    const translated: Record<string, string> = {};
    for (let offset = 0; offset < catalog.length; offset += 128) {
      const batch = catalog.slice(offset, offset + 128);
      const response = await fetch(
        "https://translation.googleapis.com/language/translate/v2",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": key,
          },
          body: JSON.stringify({
            q: batch,
            source: "hi",
            target: "en",
            format: "text",
          }),
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        },
      );
      if (!response.ok) return local;
      const data = await response.json();
      const output = data?.data?.translations;
      if (!Array.isArray(output) || output.length !== batch.length)
        return local;
      for (let index = 0; index < batch.length; index++) {
        const value = output[index]?.translatedText;
        if (typeof value !== "string" || !value.trim() || value.length > 2000)
          return local;
        translated[batch[index]] = value;
      }
    }
    return { provider: "google", translations: translated };
  } catch {
    return local;
  }
}
// No arbitrary input: only fixed public UI copy can leave the server.
export async function GET() {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key)
    return Response.json(local, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  if (!cached || cachedKey !== key || Date.now() - cachedAt > 86400000) {
    cachedAt = Date.now();
    cachedKey = key;
    cached = translateCatalog(key);
  }
  return Response.json(await cached, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
