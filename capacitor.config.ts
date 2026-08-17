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
    // The web app's own layout doesn't use env(safe-area-inset-*) CSS — it uses fixed pixel
    // padding calibrated for how Mobile Safari's chrome behaves, from back when this was purely
    // a browser-based PWA. `contentInset: 'never'` told the native WebView to render fully
    // edge-to-edge (no notch/status-bar inset at all), which is right for an app that positions
    // its own content via safe-area CSS, but wrong here — it left the fixed-padding layout with
    // nothing accounting for the notch, so content rendered up under the status bar/island.
    // 'automatic' has the native WebView itself inset content below the notch/status bar,
    // which is what the fixed-padding layout was actually designed against.
    contentInset: 'automatic'
  }
};

export default config;
