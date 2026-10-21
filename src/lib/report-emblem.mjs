const EMBLEM =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Seal_of_Bihar.svg/120px-Seal_of_Bihar.svg.png";
let cached;

export function reportEmblem() {
  if (!cached)
    cached = fetch(EMBLEM, {
      headers: { Accept: "image/png" },
      signal: AbortSignal.timeout(2000),
      cache: "force-cache",
    })
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("image/png")
        )
          return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        return bytes.length > 0 && bytes.length < 100000 ? bytes : null;
      })
      .catch(() => null);
  return cached;
}
