import type { Metadata } from "next";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/600.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-devanagari/500.css";
import "@fontsource/noto-sans-devanagari/600.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "अररिया | कर्मी उपस्थिति पोर्टल",
  description:
    "अररिया प्रखंड पंचायत राज कार्यालय का सुरक्षित कर्मी उपस्थिति पोर्टल",
  robots: { index: false, follow: false },
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
