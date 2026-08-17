# Viva

Viva is a mobile-first food scanner with two paths:

- **Food photo:** sends a compressed user-selected image through a server route to OpenRouter for a structured nutrition estimate.
- **Barcode:** uses Open Food Facts product records with serving-based nutrient calculations and health scoring.

## Run it locally

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add your OpenRouter API key.
4. Run `npm run dev`.

## Deploy on Vercel

1. Push this project to a new GitHub repository.
2. Import that repository at [Vercel](https://vercel.com/new).
3. In **Project → Settings → Environment Variables**, add `OPENROUTER_API_KEY`. Do **not** use `NEXT_PUBLIC_OPENROUTER_API_KEY`—that would expose it to everyone visiting your site.
4. Optionally set `OPENROUTER_MODEL` to override the default model, and `NEXT_PUBLIC_SITE_URL` to your deployed URL.
5. Deploy. No extra Vercel configuration is needed.

## Model choice and cost

The default is `google/gemini-2.5-flash`, chosen over the cheaper `-lite` variant because the lite model's scoring was noticeably inconsistent (the same product could score differently between a barcode scan and a photo scan, or even between two scans of the same barcode). Requests run at temperature 0 for repeatable results and stay capped at a few hundred tokens per scan, so $5 should still cover many thousands of normal scans; it is not literally unlimited because image-token costs vary by resolution and provider.

If a provider is temporarily unavailable, change only `OPENROUTER_MODEL` in Vercel and redeploy—no code change needed. For experimentation, `openrouter/free` can route requests to an available free compatible model, but it is less predictable for a production food scanner.

## iOS app

`ios/` is a [Capacitor](https://capacitorjs.com) wrapper — a thin native shell that loads the
live production site (`capacitor.config.ts` → `server.url`) inside a WKWebView, rather than a
static export. That's not a shortcut so much as a requirement: the app's API routes (OpenRouter
enrichment, Open Food Facts lookups) need a real Next.js server behind them, which `next export`
can't provide. It also means every fix pushed to Vercel updates the iOS app instantly, with no
separate native release for web-side changes — the only reason to touch Xcode again is an icon,
permission, or native-config change.

### What you need installed (once)

This only builds on a Mac, and needs **full Xcode**, not just the Command Line Tools you likely
already have (`xcode-select -p` shows `.../CommandLineTools` if so):

1. Install Xcode from the Mac App Store (multi-GB download).
2. Open Xcode once to accept its license and let it install additional components.
3. Point the command line at it: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (asks for your password — this step can't be scripted around).

No CocoaPods needed — this project's Capacitor version resolves its native dependencies through
Swift Package Manager, which Xcode handles automatically on first open.

### Build and run

```bash
npx cap sync ios   # re-copies config after editing capacitor.config.ts or Info.plist
npx cap open ios   # opens ios/App/App.xcworkspace in Xcode
```

Then in Xcode: pick a simulator or your plugged-in iPhone from the scheme selector, and press
Run (▶). **Test barcode/camera scanning on a real device, not the Simulator** — the Simulator has
no real camera, so those flows can't be meaningfully exercised there.

If you rename the app or change its bundle identifier, update `capacitor.config.ts`
(`appId`/`appName`) and re-run `npx cap sync ios` rather than editing the Xcode project directly.

### Getting it onto the App Store

Everything above gets you a working build. The rest is account-bound work only you can do (an
agent has no way to act as you on Apple's systems):

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year, your own Apple ID).
2. In Xcode's target settings → **Signing & Capabilities**, sign in with that Apple ID and let
   Xcode manage signing automatically (creates the App ID / provisioning profile for you).
3. Create the app's listing in [App Store Connect](https://appstoreconnect.apple.com): name,
   category, age rating, screenshots per device size, description, and a **privacy policy URL**
   — required, since this app sends photos to a third-party AI provider (OpenRouter) and queries
   Open Food Facts. Also fill in the "App Privacy" nutrition-label questionnaire honestly (camera
   photos collected and sent off-device, no account/tracking data otherwise).
4. Xcode → **Product → Archive**, then **Distribute App** to upload the build to App Store Connect.
5. Submit the uploaded build for review from App Store Connect.

Apple's review can reject a submission for things unrelated to the code — missing privacy policy,
unclear permission-usage strings, incomplete metadata — so budget a review cycle or two before it
goes live.

## Notes

Nutrition from an image is an estimate, not a diagnosis or medical advice. Barcode nutrition and facts are calculated per serving from Open Food Facts fields when available (with per-100g fallback math), so users should still verify with the package label for final allergen and serving confirmation.
