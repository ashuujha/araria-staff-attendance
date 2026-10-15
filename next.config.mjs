const devScriptPolicy =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const csp = `default-src 'self'; script-src 'self' 'unsafe-inline'${devScriptPolicy} https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://upload.wikimedia.org; font-src 'self'; connect-src 'self' https://vkflommzumlrrzvwbdub.supabase.co https://challenges.cloudflare.com; frame-src https://www.google.com https://challenges.cloudflare.com; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
export default {
  poweredByHeader: false,
  // TypeScript 5 supports the compiler API without spawning a second CLI.
  experimental: { useTypeScriptCli: false },
  async redirects() {
    if (process.env.NODE_ENV !== "production" || !process.env.APP_URL)
      return [];
    const origin = new URL(process.env.APP_URL);
    if (origin.protocol !== "https:") return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "http" }],
        destination: `${origin.origin}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(self), microphone=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};
