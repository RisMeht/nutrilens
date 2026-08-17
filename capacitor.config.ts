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
    contentInset: 'never'
  }
};

export default config;
