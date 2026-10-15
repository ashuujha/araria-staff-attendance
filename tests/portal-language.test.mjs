import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createElement } from "react";
await mkdir(".preview", { recursive: true });
for (const [entry, name] of [
  ["src/lib/portal-language.tsx", "portal-language"],
  ["src/app/api/translation/route.ts", "translation-api"],
]) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `.preview/${name}-test.mjs`,
  });
}
const { translatePortalText, localizePortalContent } = await import(
  pathToFileURL(resolve(".preview/portal-language-test.mjs"))
);
const { GET } = await import(
  pathToFileURL(resolve(".preview/translation-api-test.mjs"))
);
test("English UI preserves names, option values, event handlers and identity containers", () => {
  assert.equal(
    translatePortalText("आज की सहेजी गई जानकारी"),
    "Today's saved attendance",
  );
  assert.equal(
    translatePortalText("2 उपस्थिति रिकॉर्ड"),
    "2 attendance records",
  );
  assert.equal(translatePortalText("हसीबुर्ररहमान"), "हसीबुर्ररहमान");
  assert.equal(
    translatePortalText("हसीबुर्ररहमान का विवरण"),
    "Details for हसीबुर्ररहमान",
  );
  const handler = () => {};
  const element = localizePortalContent(
    createElement(
      "option",
      { value: "present", onClick: handler },
      "उपस्थित / Present",
    ),
  );
  assert.equal(element.props.value, "present");
  assert.equal(element.props.children, "Present");
  assert.equal(element.props.onClick, handler);
  const identity = createElement("span", { translate: "no" }, "कर्मी");
  assert.equal(localizePortalContent(identity), identity);
  const input = localizePortalContent(
    createElement("input", {
      value: "कर्मी",
      placeholder: "नाम या मोबाइल नंबर / Name or mobile",
    }),
  );
  assert.equal(input.props.value, "कर्मी");
  assert.equal(input.props.placeholder, "Name or mobile");
});
test("Fixed translation endpoint uses local fallback, caches Google and never exposes credentials", async () => {
  const original = globalThis.fetch,
    old = process.env.GOOGLE_TRANSLATE_API_KEY;
  try {
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
    globalThis.fetch = () => {
      throw Error("Must not fetch without key");
    };
    assert.equal((await (await GET()).json()).provider, "local");
    process.env.GOOGLE_TRANSLATE_API_KEY = "test-private-api-key";
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(
        url,
        "https://translation.googleapis.com/language/translate/v2",
      );
      assert.equal(init.headers["X-goog-api-key"], "test-private-api-key");
      const body = JSON.parse(init.body);
      assert.equal(body.source, "hi");
      assert.equal(body.target, "en");
      assert.ok(body.q.length <= 128);
      assert.ok(!body.q.includes("हसीबुर्ररहमान"));
      return Response.json({
        data: {
          translations: body.q.map(() => ({
            translatedText: "Google UI translation",
          })),
        },
      });
    };
    const first = await (await GET()).json();
    assert.equal(first.provider, "google");
    assert.ok(!JSON.stringify(first).includes("test-private-api-key"));
    const initial = calls;
    await GET();
    assert.equal(calls, initial);
    process.env.GOOGLE_TRANSLATE_API_KEY = "different-test-key";
    globalThis.fetch = async () =>
      Response.json({ error: "unavailable" }, { status: 503 });
    assert.equal((await (await GET()).json()).provider, "local");
  } finally {
    globalThis.fetch = original;
    if (old === undefined) delete process.env.GOOGLE_TRANSLATE_API_KEY;
    else process.env.GOOGLE_TRANSLATE_API_KEY = old;
  }
});
