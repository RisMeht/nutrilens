import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./overrides.css";

export const metadata: Metadata = {
  title: "NutriLens — Know your food",
  description: "Scan food photos or barcodes and get serving-based nutrition insights from trusted product data.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "NutriLens", statusBarStyle: "black-translucent" }
};

export const viewport: Viewport = {
  themeColor: "#07150d",
  // Without this, the browser never reports non-zero env(safe-area-inset-*) values, so every
  // safe-area padding already added (tab bar, full-page headers, chat input) was silently a
  // no-op — most visible once installed as a standalone PWA (no browser chrome of its own to
  // absorb the notch/home-indicator area), but this also enables genuine edge-to-edge
  // rendering in a regular browser tab, matching the full-screen camera UI's own intent.
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions such as Grammarly add attributes before React hydrates.
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
