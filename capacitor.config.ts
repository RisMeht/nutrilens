import type { CapacitorConfig } from '@capacitor/cli';

// This wraps the live Vercel deployment rather than bundling a static export: the app's API
// routes (OpenRouter enrichment, Open Food Facts lookups, barcode/grade endpoints) need a real
// Next.js server behind them, which a static `next export` can't provide. Pointing server.url at
// the production deployment means the native shell is just a thin WKWebView window onto the same
// app already running in the browser — every fix that ships to Vercel updates the iOS app too,
// with no separate native release needed for web-side changes.
const config: CapacitorConfig = {
  appId: 'com.rishaanmehta.viva',
  appName: 'Viva',
  webDir: 'out',
  server: {
    url: 'https://nurafood.vercel.app',
    // The app never navigates to any domain other than its own; this stays intentionally
    // narrow so Capacitor keeps any unexpected external link inside the OS browser instead of
    // loading it into the app's own webview.
    allowNavigation: ['nurafood.vercel.app']
  },
  ios: {
    // 'automatic' (tried briefly) has UIKit add real inset margins around the web content —
    // which render as solid native-colored bars above and below it, not just extra breathing
    // room. 'never' keeps the WebView edge-to-edge instead, so the page's own background/camera
    // preview can extend under the notch and home indicator the way a normal full-screen app
    // does; the app is made notch-aware entirely through its own CSS instead (see globals.css/
    // layout.tsx — env(safe-area-inset-*), enabled only inside the native app via a runtime
    // viewport-fit=cover toggle so it can't affect the separate Mobile Safari PWA experience).
    contentInset: 'never'
  }
};

export default config;
