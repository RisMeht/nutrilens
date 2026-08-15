# NutriLens

NutriLens is a mobile-first food scanner with two paths:

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
4. Optionally add `OPENROUTER_MODEL=mistralai/ministral-3-8b` and `NEXT_PUBLIC_SITE_URL` set to your deployed URL.
5. Deploy. No extra Vercel configuration is needed.

## Model choice and cost

The default is `google/gemini-2.5-flash-lite`, a capable low-cost vision model. Keep image scans tightly framed and the 450-token response cap in place to make credits last. $5 should cover many thousands of normal food scans; it is not literally unlimited because image-token costs vary by resolution and provider.

If a provider is temporarily unavailable, change only `OPENROUTER_MODEL` in Vercel and redeploy—no code change needed. For experimentation, `openrouter/free` can route requests to an available free compatible model, but it is less predictable for a production food scanner.

## Notes

Nutrition from an image is an estimate, not a diagnosis or medical advice. Barcode nutrition and facts are calculated per serving from Open Food Facts fields when available (with per-100g fallback math), so users should still verify with the package label for final allergen and serving confirmation.
