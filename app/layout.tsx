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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions such as Grammarly add attributes before React hydrates.
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
