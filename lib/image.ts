// Routes a remote Open Food Facts / Wikimedia photo through Next's built-in image optimizer
// instead of hotlinking it directly. That endpoint resizes to the exact width requested,
// re-encodes as WebP/AVIF (a fraction of the source JPEG's bytes), and caches the transformed
// result at Vercel's edge — so a photo already viewed by anyone loads near-instantly for
// everyone after. `width` must be one of the sizes Next is configured to accept (its defaults
// already include 96/256/640, which is why those are the only three used below) — an
// unlisted width gets rejected with a 400, so don't introduce a new one without also adding it
// to next.config.ts's images.imageSizes/deviceSizes.
export const optimizedImageUrl = (url: string | undefined | null, width: 96 | 256 | 640, quality = 75): string => {
  if (!url || !/^https?:\/\//i.test(url)) return url || "";
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality}`;
};
