import { toNumber } from "./nutrition";

const OFF_BASE = "https://world.openfoodfacts.org";
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
  const searchUrl = new URL(`${OFF_BASE}/cgi/search.pl`);
  searchUrl.searchParams.set("search_terms", productName || "food");
  searchUrl.searchParams.set("search_simple", "1");
  searchUrl.searchParams.set("action", "process");
  searchUrl.searchParams.set("json", "1");
  searchUrl.searchParams.set("page_size", "30");
  searchUrl.searchParams.set("fields", "code,product_name,product_name_en,nutriscore_grade,image_front_small_url,image_front_url,categories_tags,nutriments");

  const response = await withTimeout(fetch(searchUrl, { headers: OFF_HEADERS, next: { revalidate: 86400 } })).catch(() => null);
  if (!response?.ok) return [] as Array<{ name: string; image: string }>;
  const data = await response.json();
  const products: Record<string, unknown>[] = Array.isArray(data?.products) ? data.products : [];

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
      const image = (typeof item.image_front_small_url === "string" && item.image_front_small_url) || (typeof item.image_front_url === "string" && item.image_front_url) || "";
      if (!image) return null;

      const overlapScore = categoryOverlap(categories, item.categories_tags);
      const improvement =
        (sugarPer100g - sugar) * 2 +
        (sodiumMgPer100g - sodiumMg) / 80 +
        (satFatPer100g - satFat) * 2 +
        (energyPer100g - energy) / 80 +
        (6 - nutriRank(item.nutriscore_grade)) +
        overlapScore;

      const name = (typeof item.product_name === "string" && item.product_name.trim()) || (typeof item.product_name_en === "string" && item.product_name_en.trim()) || "Healthier option";
      return { name, image, improvement };
    })
    .filter((item): item is { name: string; image: string; improvement: number } => Boolean(item && item.improvement > 1.5))
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 4)
    .map(({ name, image }) => ({ name, image }));
};

export const enrichAlternativesWithImages = async (alternatives: unknown) => {
  if (!Array.isArray(alternatives)) return [] as Array<{ name: string; image: string }>;
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
      const searchUrl = new URL(`${OFF_BASE}/cgi/search.pl`);
      searchUrl.searchParams.set("search_terms", name);
      searchUrl.searchParams.set("search_simple", "1");
      searchUrl.searchParams.set("action", "process");
      searchUrl.searchParams.set("json", "1");
      searchUrl.searchParams.set("page_size", "3");
      searchUrl.searchParams.set("fields", "product_name,product_name_en,image_front_small_url,image_front_url");

      const response = await withTimeout(fetch(searchUrl, { headers: OFF_HEADERS, next: { revalidate: 86400 } }), 7000).catch(() => null);
      if (!response?.ok) return { name, image: "" };
      const data = await response.json();
      const products: Record<string, unknown>[] = Array.isArray(data?.products) ? data.products : [];
      const withImage = products.find((item) =>
        (typeof item.image_front_small_url === "string" && item.image_front_small_url) ||
        (typeof item.image_front_url === "string" && item.image_front_url)
      );
      const image = withImage
        ? (typeof withImage.image_front_small_url === "string" && withImage.image_front_small_url) ||
          (typeof withImage.image_front_url === "string" && withImage.image_front_url) ||
          ""
        : "";
      return { name, image };
    })
  );

  // Keep every suggested alternative even when Open Food Facts has no product photo for it
  // (common for generic/home foods, since OFF mostly covers packaged branded products) — the
  // client falls back to a generated placeholder tile rather than the swap disappearing entirely.
  return resolved;
};
