import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const fallbackFoodImage = (name: string) => `https://source.unsplash.com/640x480/?food,${encodeURIComponent(name)}`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeAlternatives = (alternatives: unknown) => {
  if (!Array.isArray(alternatives)) return [];
  return alternatives
    .map((entry) => {
      if (typeof entry === "string") return { name: entry.trim(), image: fallbackFoodImage(entry) };
      if (entry && typeof entry === "object" && "name" in entry && typeof (entry as { name: unknown }).name === "string") {
        const value = entry as { name: string; image?: unknown };
        return { name: value.name.trim(), image: typeof value.image === "string" && value.image ? value.image : fallbackFoodImage(value.name) };
      }
      return null;
    })
    .filter((entry): entry is { name: string; image: string } => Boolean(entry && entry.name));
};

const system = `You are NutriLens AI nutrition enrichment for packaged foods.
Return ONLY valid JSON with this exact shape:
{"score":number,"grade":"A|B|C|D|E","summary":"string","highlights":["string","string","string"],"concerns":["string","string"],"alternatives":[{"name":"string","image":"https://..."}],"caution":"string"}
Rules:
- Build a realistic score from 0-100 using sugars, sodium, saturated fat, fiber, protein, additives, ingredient quality, and processing level.
- Keep highlights practical and specific to this product.
- concerns should mention bad ingredients or nutrition red flags when present.
- alternatives must be healthier, realistic swaps (2-4 items max).
- Never make medical diagnoses.`;

export async function POST(request: Request) {
  const { code } = await request.json();
  if (typeof code !== "string" || !/^\d{8,14}$/.test(code)) {
    return NextResponse.json({ error: "Enter a valid barcode." }, { status: 400 });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured on the server." }, { status: 503 });

  const lookupUrl = new URL("https://world.openfoodfacts.org/api/v2/product/00000000.json");
  lookupUrl.pathname = `/api/v2/product/${code}.json`;
  const productResponse = await fetch(lookupUrl, {
    headers: { "User-Agent": "NutriLens/1.0 (nutrition scanner)" },
    next: { revalidate: 86400 }
  });
  const productData = await productResponse.json();
  const product = productData?.product;
  if (!product) {
    return NextResponse.json({ error: "No product data found for this barcode." }, { status: 404 });
  }

  const requestedModel = process.env.OPENROUTER_MODEL;
  const model = requestedModel === "mistralai/ministral-3-8b" ? "google/gemini-2.5-flash-lite" : requestedModel || "google/gemini-2.5-flash-lite";
  const userContext = {
    barcode: code,
    name: product.product_name || product.product_name_en || "Scanned product",
    categories: product.categories || "",
    ingredients_text: product.ingredients_text_en || product.ingredients_text || "",
    ingredients_analysis_tags: product.ingredients_analysis_tags || [],
    additives_tags: product.additives_tags || [],
    nutriscore_grade: product.nutriscore_grade || null,
    nova_group: product.nova_group || null,
    nutriments: {
      calories_100g: product.nutriments?.["energy-kcal_100g"] ?? product.nutriments?.energy_kcal ?? null,
      sugar_100g: product.nutriments?.sugars_100g ?? null,
      sodium_100g_g: product.nutriments?.sodium_100g ?? null,
      saturated_fat_100g: product.nutriments?.["saturated-fat_100g"] ?? null,
      fiber_100g: product.nutriments?.fiber_100g ?? null,
      protein_100g: product.nutriments?.proteins_100g ?? null
    }
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      "X-Title": "NutriLens"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Enrich this barcode product:\n${JSON.stringify(userContext)}`
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || "Gemini enrichment failed." }, { status: response.status });

  try {
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content ?? "{}");
    const score = clamp(Math.round(Number(parsed.score) || 0), 0, 100);
    const grade = typeof parsed.grade === "string" ? parsed.grade.toUpperCase() : "C";
    return NextResponse.json({
      score,
      grade: ["A", "B", "C", "D", "E"].includes(grade) ? grade : "C",
      summary: typeof parsed.summary === "string" ? parsed.summary : "Gemini analyzed the product ingredients and nutrients.",
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((item: unknown) => typeof item === "string").slice(0, 4) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((item: unknown) => typeof item === "string").slice(0, 4) : [],
      alternatives: normalizeAlternatives(parsed.alternatives).slice(0, 4),
      caution: typeof parsed.caution === "string" ? parsed.caution : "Nutrition advice is informational and not medical guidance."
    });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
