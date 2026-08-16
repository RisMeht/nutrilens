import { toNumber } from "./nutrition";

const OFF_BASE = "https://world.openfoodfacts.org";
// Open Food Facts' legacy /cgi/search.pl endpoint (used here until now) currently returns a
// hard 503 "Page temporarily unavailable" for every request — silently degrading "Better
// swaps" and alternative-photo lookups to empty results, since both were built to fail
// gracefully rather than throw. Their newer Elasticsearch-backed Search API is a near
// drop-in replacement (same field names via `fields=`, `hits` instead of `products`).
const OFF_SEARCH_BASE = "https://search.openfoodfacts.org";
const OFF_HEADERS = { "User-Agent": "NutriLens/1.0 (nutrition scanner)" };

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 9000) => {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))
  ]);
};

export const fetchOpenFoodFactsProduct = async (code: string) => {
  const v2 = await withTimeout(fetch(`${OFF_BASE}/api/v2/product/${code}.json`, { headers: OFF_HEADERS, next: { revalidate: 86400 } })).catch(() => null);
  if (v2?.ok) {
    const data = await v2.json();
    if (data?.product) return data.product as Record<string, unknown>;
  }

  const v0 = await withTimeout(fetch(`${OFF_BASE}/api/v0/product/${code}.json`, { headers: OFF_HEADERS, next: { revalidate: 86400 } })).catch(() => null);
  if (v0?.ok) {
    const data = await v0.json();
    if (data?.product) return data.product as Record<string, unknown>;
  }

  return null;
};

// Open Food Facts serves each photo at a few fixed widths (100/200/400) via a numeric filename
// suffix, plus one true full-resolution original at the same path with ".full" instead. The
// full original is worth it for the one large hero photo on a result screen, but was also
// being requested for every small grid/list tile (search results, "Better swaps", history rows
// shown at ~120-150px) — multi-MB originals downloaded just to be shrunk by CSS, which is what
// was making those grids feel slow to load. Grid/list tiles now request the 400px version
// instead, plenty sharp at that display size and a fraction of the bytes.
const toSizedImage = (url: string, size: number | "full"): string => url.replace(/\.\d+\.(jpe?g|png)$/i, `.${size}.$1`);
const GRID_IMAGE_SIZE = 400;

export const productImageUrl = (product: Record<string, unknown>): string => {
  const candidates = [product.image_front_url, product.image_url, product.image_front_small_url, product.image_small_url];
  const found = candidates.find((value): value is string => typeof value === "string" && value.length > 0);
  return found ? toSizedImage(found, "full") : "";
};

// A handful of category tags that mean "not actually a food product" — Open Food Facts'
// database occasionally surfaces cosmetics/personal-care items (cross-listed from Open Beauty
// Facts, or just miscategorized) in a plain name search, which is how a "fruit sorbet" swap
// suggestion could resolve to a skin-cleansing water photo instead. Filtering these out trades
// a small amount of recall for not showing a completely unrelated product photo.
const NON_FOOD_CATEGORY_PATTERN = /cosmetic|beauty|perfum|skin-care|personal-care|hygiene|petfood|animal-feed/i;
const looksLikeFood = (categoriesTags: unknown): boolean => {
  if (!Array.isArray(categoriesTags)) return true; // no data to judge by — don't punish a product just for missing categories
  return !categoriesTags.some((tag) => typeof tag === "string" && NON_FOOD_CATEGORY_PATTERN.test(tag));
};

const categoryOverlap = (a: unknown, b: unknown) => {
  const categoriesA = Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  const categoriesB = Array.isArray(b) ? b.filter((x): x is string => typeof x === "string") : [];
  if (!categoriesA.length || !categoriesB.length) return 0;
  const setA = new Set(categoriesA);
  return categoriesB.reduce((count, item) => (setA.has(item) ? count + 1 : count), 0);
};

const nutriRank = (grade: unknown) => {
  const value = typeof grade === "string" ? grade.toLowerCase() : "";
  const map: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  return map[value] ?? 6;
};

export const findBetterSwaps = async ({
  productName,
  productCode,
  categories,
  sugarPer100g,
  sodiumMgPer100g,
  satFatPer100g,
  energyPer100g
}: {
  productName: string;
  productCode: string;
  categories: unknown;
  sugarPer100g: number;
  sodiumMgPer100g: number;
  satFatPer100g: number;
  energyPer100g: number;
}) => {
  const searchUrl = new URL(`${OFF_SEARCH_BASE}/search`);
  searchUrl.searchParams.set("q", productName || "food");
  searchUrl.searchParams.set("page_size", "30");
  searchUrl.searchParams.set("fields", "code,product_name,product_name_en,nutriscore_grade,image_front_small_url,image_front_url,categories_tags,nutriments");

  const response = await withTimeout(fetch(searchUrl, { headers: OFF_HEADERS, next: { revalidate: 86400 } })).catch(() => null);
  if (!response?.ok) return [] as Array<{ name: string; image: string; code: string }>;
  const data = await response.json();
  const products: Record<string, unknown>[] = Array.isArray(data?.hits) ? data.hits : [];

  return products
    .map((item) => {
      const code = typeof item.code === "string" ? item.code : "";
      if (!code || code === productCode) return null;
      const nutriments = (item.nutriments || {}) as Record<string, unknown>;
      // Compare on the same per-100g basis as the scanned product — mixing a
      // per-serving reading for one side with a per-100g reading for the other
      // produced nonsense "healthier" rankings.
      const sugar = toNumber(nutriments.sugars_100g);
      const sodiumMg = toNumber(nutriments.sodium_100g) * 1000;
      const satFat = toNumber(nutriments["saturated-fat_100g"]);
      const energy = toNumber(nutriments["energy-kcal_100g"] ?? nutriments.energy_kcal);
      const rawImage = (typeof item.image_front_url === "string" && item.image_front_url) || (typeof item.image_front_small_url === "string" && item.image_front_small_url) || "";
      if (!rawImage || !looksLikeFood(item.categories_tags)) return null;
      const image = toSizedImage(rawImage, GRID_IMAGE_SIZE);

      const overlapScore = categoryOverlap(categories, item.categories_tags);
      const improvement =
        (sugarPer100g - sugar) * 2 +
        (sodiumMgPer100g - sodiumMg) / 80 +
        (satFatPer100g - satFat) * 2 +
        (energyPer100g - energy) / 80 +
        (6 - nutriRank(item.nutriscore_grade)) +
        overlapScore;

      const name = (typeof item.product_name === "string" && item.product_name.trim()) || (typeof item.product_name_en === "string" && item.product_name_en.trim()) || "Healthier option";
      return { name, image, code, improvement };
    })
    .filter((item): item is { name: string; image: string; code: string; improvement: number } => Boolean(item && item.improvement > 1.5))
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 4)
    .map(({ name, image, code }) => ({ name, image, code }));
};

// Free, no-key, legally-clear real photos for generic/home foods that Open Food Facts (mostly
// packaged branded products) doesn't carry — e.g. "grilled chicken salad" won't have a
// barcode product photo, but Wikimedia Commons likely has a real one. Deliberately not using
// real-time AI image generation here: that has a per-image cost and adds latency to every
// scan, a tradeoff worth confirming with the user first rather than wiring up silently.
export const wikimediaImageFor = async (query: string): Promise<string> => {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `filetype:bitmap ${query} food`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "3");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|mime");
  url.searchParams.set("iiurlwidth", "1200");
  url.searchParams.set("format", "json");

  const response = await withTimeout(fetch(url, { headers: OFF_HEADERS, next: { revalidate: 86400 } }), 6000).catch(() => null);
  if (!response?.ok) return "";
  const data = await response.json();
  const pages: Record<string, unknown>[] = data?.query?.pages ? Object.values(data.query.pages) : [];
  for (const page of pages) {
    const info = (page.imageinfo as Record<string, unknown>[] | undefined)?.[0];
    const mime = typeof info?.mime === "string" ? info.mime : "";
    const thumb = typeof info?.thumburl === "string" ? info.thumburl : "";
    if (thumb && mime.startsWith("image/")) return thumb;
  }
  return "";
};

export const enrichAlternativesWithImages = async (alternatives: unknown) => {
  if (!Array.isArray(alternatives)) return [] as Array<{ name: string; image: string; code?: string }>;
  const names = alternatives
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object" && "name" in entry && typeof (entry as { name: unknown }).name === "string") {
        return (entry as { name: string }).name.trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 4);

  const resolved = await Promise.all(
    names.map(async (name) => {
      const searchUrl = new URL(`${OFF_SEARCH_BASE}/search`);
      searchUrl.searchParams.set("q", name);
      searchUrl.searchParams.set("page_size", "5");
      searchUrl.searchParams.set("fields", "code,product_name,product_name_en,image_front_small_url,image_front_url,categories_tags");

      const response = await withTimeout(fetch(searchUrl, { headers: OFF_HEADERS, next: { revalidate: 86400 } }), 7000).catch(() => null);
      const products: Record<string, unknown>[] = response?.ok ? (await response.json())?.hits ?? [] : [];
      // Picks the first result (in the search's own relevance order) that both has a photo
      // AND actually looks like a food product — previously took the first result with ANY
      // photo regardless of relevance or category, which could land on an unrelated
      // cosmetics/personal-care product that happened to share a word with the food name.
      const withImage = products.find((item) =>
        ((typeof item.image_front_url === "string" && item.image_front_url) || (typeof item.image_front_small_url === "string" && item.image_front_small_url)) &&
        looksLikeFood(item.categories_tags)
      );
      const rawOffImage = withImage
        ? (typeof withImage.image_front_url === "string" && withImage.image_front_url) ||
          (typeof withImage.image_front_small_url === "string" && withImage.image_front_small_url) ||
          ""
        : "";
      // The matched OFF product's own barcode, kept so a suggested swap can be opened as a
      // real full result later (Recommendations) rather than just shown as a static image.
      const code = withImage && typeof withImage.code === "string" ? withImage.code : undefined;
      if (rawOffImage) return { name, image: toSizedImage(rawOffImage, GRID_IMAGE_SIZE), code };

      const wikiImage = await wikimediaImageFor(name).catch(() => "");
      return { name, image: wikiImage, code };
    })
  );

  // Keep every suggested alternative even when neither source has a photo for it — the
  // client falls back to a generated placeholder tile rather than the swap disappearing entirely.
  return resolved;
};

export type BrowseItem = { code: string; name: string; image: string; grade: string };

const mapBrowseItem = (item: Record<string, unknown>): BrowseItem | null => {
  const code = typeof item.code === "string" ? item.code : "";
  const name = (typeof item.product_name === "string" && item.product_name.trim()) || (typeof item.product_name_en === "string" && item.product_name_en.trim()) || "";
  if (!code || !name) return null;
  const rawImage = (typeof item.image_front_url === "string" && item.image_front_url) || (typeof item.image_front_small_url === "string" && item.image_front_small_url) || "";
  const grade = typeof item.nutriscore_grade === "string" && /^[a-e]$/.test(item.nutriscore_grade) ? item.nutriscore_grade.toUpperCase() : "?";
  return { code, name, image: rawImage ? toSizedImage(rawImage, GRID_IMAGE_SIZE) : "", grade };
};

// Backs the Search screen — plain relevance ranking (the API's default when no sort_by is
// given), same as typing into any search box: the point is finding the specific thing typed,
// not being redirected toward whatever happens to be highest-rated.
const searchProducts = async (query: string): Promise<BrowseItem[]> => {
  const url = new URL(`${OFF_SEARCH_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", "24");
  url.searchParams.set("fields", "code,product_name,product_name_en,nutriscore_grade,image_front_small_url,image_front_url");

  const response = await withTimeout(fetch(url, { headers: OFF_HEADERS, next: { revalidate: 3600 } }), 8000).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json();
  const products: Record<string, unknown>[] = Array.isArray(data?.hits) ? data.hits : [];
  return products.map(mapBrowseItem).filter((item): item is BrowseItem => item !== null);
};

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

// Backs the Top screen's category browsing. Sorting a category purely by Nutri-Score (as this
// used to) surfaces whichever obscure, barely-scanned entries happen to tie for grade A —
// mostly foreign-language listings nobody's actually heard of, since ties break close to
// arbitrarily. Pulling the most-scanned products first, THEN ranking that pool by grade,
// answers what "top" should actually mean here: the best-rated among products people
// genuinely recognize, not the single most technically-optimal barcode in the database.
// Restricting to US-available, English-labeled products does double duty: it's the
// "actually available to me, actually readable" filter that was asked for, and — verified
// directly against the API before shipping this — it also happens to fix the "most products
// have no photo" complaint, since popular US/English listings are overwhelmingly
// photographed by Open Food Facts' contributor base (a same-sized unfiltered pool came back
// with plenty of image-less entries; this filtered pool came back 60/60 with photos).
const topProductsForCategory = async (category: string): Promise<BrowseItem[]> => {
  const url = new URL(`${OFF_SEARCH_BASE}/search`);
  url.searchParams.set("q", `categories_tags:"${category}" AND countries_tags:"en:united-states" AND lang:en`);
  url.searchParams.set("sort_by", "-unique_scans_n");
  url.searchParams.set("page_size", "60");
  url.searchParams.set("fields", "code,product_name,product_name_en,nutriscore_grade,image_front_small_url,image_front_url,unique_scans_n");

  const response = await withTimeout(fetch(url, { headers: OFF_HEADERS, next: { revalidate: 3600 } }), 8000).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json();
  const products: Record<string, unknown>[] = Array.isArray(data?.hits) ? data.hits : [];

  return products
    .map((item) => ({ item: mapBrowseItem(item), scans: toNumber(item.unique_scans_n) }))
    // Still requires an actual photo defensively, even though the US+English filter alone
    // already accounts for nearly every result having one — a product without a photo falls
    // back to a generated placeholder tile everywhere else in the app, which isn't "every
    // product has a photo" the way this screen specifically promises.
    .filter((entry): entry is { item: BrowseItem; scans: number } => entry.item !== null && !!entry.item.image)
    // Stable sort keeps popularity as the tiebreaker within each grade — Array.prototype.sort
    // is guaranteed stable in every modern JS engine, so items already ordered
    // most-scanned-first stay in that relative order once grouped by grade.
    .sort((a, b) => (GRADE_RANK[a.item.grade] ?? 5) - (GRADE_RANK[b.item.grade] ?? 5))
    .slice(0, 24)
    .map(({ item }) => item);
};

// Category filtering has to go through `q` as a quoted field query
// (`categories_tags:"en:snacks"`) — a plain `categories_tags` URL param is silently ignored by
// this API (confirmed: it returned identical unfiltered results for every category tried).
export const browseProducts = async ({ query, category }: { query?: string; category?: string }): Promise<BrowseItem[]> => {
  if (query) return searchProducts(query);
  if (category) return topProductsForCategory(category);
  return [];
};
