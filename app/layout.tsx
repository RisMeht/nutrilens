import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./overrides.css";

export const metadata: Metadata = {
  title: "Viva — Know what you eat",
  description: "Scan food photos or barcodes and get serving-based nutrition insights from trusted product data.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "Viva", statusBarStyle: "black-translucent" }
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
  return <html lang="en" suppressHydrationWarning>
    <head>
      {/* Every product photo comes from one of these two hosts — opening the connection
          (DNS + TLS) before the first image is actually requested shaves that round trip off
          the very first photo on every screen, not just the first page load. */}
      <link rel="preconnect" href="https://images.openfoodfacts.org" />
      <link rel="preconnect" href="https://upload.wikimedia.org" />
      {/* viewport-fit=cover is deliberately absent from the `viewport` export above — combining
          it with this app's 100vh/100svh layout broke the installed Safari PWA on a real device
          (see that export's comment). But the iOS app (Capacitor, capacitor.config.ts) runs the
          exact same page in a WKWebView with no browser chrome at all, so Safari's dynamic-toolbar
          bug can't happen there — and it separately NEEDS viewport-fit=cover, since that's what
          makes env(safe-area-inset-*) report real values instead of always 0, which the app's
          header/topbar padding now uses to clear the notch/Dynamic Island (see overrides.css).
          Capacitor's native bridge injects `window.Capacitor` before any page script runs, so
          this can reliably tell the two contexts apart and only touch the meta tag in the one
          that needs it — regular Safari/PWA visitors are completely unaffected. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()){var m=document.querySelector('meta[name="viewport"]');if(m){if(m.content.indexOf('viewport-fit=cover')===-1)m.content+=', viewport-fit=cover';}else{m=document.createElement('meta');m.name='viewport';m.content='width=device-width, initial-scale=1, viewport-fit=cover';document.head.appendChild(m);}}}catch(e){}})();`
        }}
      />
    </head>
    <body suppressHydrationWarning>{children}</body>
  </html>;
}
