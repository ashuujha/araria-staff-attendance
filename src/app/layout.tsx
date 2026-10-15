import type { Metadata } from "next";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/600.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "./globals.css";
import { BIHAR_EMBLEM } from "../lib/department-branding";
export const metadata: Metadata = {
  title: "Araria Staff Attendance | अररिया कर्मी उपस्थिति",
  description:
    "Araria Staff Attendance — अररिया कर्मियों की दैनिक उपस्थिति, आने और जाने का समय।",
  robots: { index: false, follow: false },
  icons: { icon: { url: BIHAR_EMBLEM, type: "image/svg+xml" } },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hi" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
