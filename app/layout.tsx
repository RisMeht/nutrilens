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
  themeColor: "#07150d"
  // Deliberately NOT setting viewportFit:"cover" — tried it to make env(safe-area-inset-*)
  // report real values instead of always 0, but combining it with 100vh/100svh-based layout is
  // a well-documented source of exactly the bug that showed up on a real device afterward: the
  // installed standalone PWA rendered with extra blank space at the bottom and everything
  // shifted up, because iOS's "cover" viewport and its dynamic-toolbar viewport height
  // calculation don't agree on where the bottom of the screen actually is. Reverted — the
  // safe-area paddings already in the CSS just fall back to their plain pixel values again
  // (same as before this was ever tried), which is the known-good state.
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions such as Grammarly add attributes before React hydrates.
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
