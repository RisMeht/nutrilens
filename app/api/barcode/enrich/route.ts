import { NextResponse } from "next/server";
import { enrichAlternativesWithImages, fetchOpenFoodFactsProduct } from "../../../../lib/openfoodfacts";
import { hasServingNutrientData, nutrientPer100g, nutrientPerServing, parseServing, toNumber } from "../../../../lib/nutrition";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = `You are NutriLens AI for packaged food interpretation.
Return ONLY valid JSON with this exact shape:
{"summary":"string","highlights":["string","string","string"],"concerns":["string","string"],"alternatives":["string","string"],"caution":"string"}
Rules:
- Use only the provided nutrition and ingredient facts, and the exact basis (per-serving or per-100g) given — do not relabel per-100g figures as "per serving" or vice versa.
- Do not invent nutrients, serving sizes, or medical claims.
- Keep output concise, practical, and evidence-based.
- Alternatives must be realistic healthier packaged swaps.`;

export async function POST(request: Request) {
  const { code } = await request.json();
  if (typeof code !== "string" || !/^\d{8,14}$/.test(code)) {
    return NextResponse.json({ error: "Enter a valid barcode." }, { status: 400 });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured on the server." }, { status: 503 });

  const product = await fetchOpenFoodFactsProduct(code);
  if (!product) {
    return NextResponse.json({ error: "No product data found for this barcode." }, { status: 404 });
  }

  const nutriments = (product.nutriments || {}) as Record<string, unknown>;
  const serving = parseServing(product.serving_size, product.serving_quantity);
  const useServingBasis = serving.grams > 0 || hasServingNutrientData(nutriments);
  const servingGrams = serving.grams;
  const basis = useServingBasis ? serving.label || "1 serving" : "100g (no serving size listed by the manufacturer)";

  const nutrients = useServingBasis
    ? {
        calories: nutrientPerServing(nutriments, "energy-kcal_100g", "energy-kcal_serving", servingGrams) ?? nutrientPer100g(nutriments, "energy-kcal_100g"),
        protein_g: nutrientPerServing(nutriments, "proteins_100g", "proteins_serving", servingGrams) ?? nutrientPer100g(nutriments, "proteins_100g"),
        carbs_g: nutrientPerServing(nutriments, "carbohydrates_100g", "carbohydrates_serving", servingGrams) ?? nutrientPer100g(nutriments, "carbohydrates_100g"),
        fat_g: nutrientPerServing(nutriments, "fat_100g", "fat_serving", servingGrams) ?? nutrientPer100g(nutriments, "fat_100g"),
        sugar_g: nutrientPerServing(nutriments, "sugars_100g", "sugars_serving", servingGrams) ?? nutrientPer100g(nutriments, "sugars_100g"),
        sodium_mg: (nutrientPerServing(nutriments, "sodium_100g", "sodium_serving", servingGrams) ?? nutrientPer100g(nutriments, "sodium_100g")) * 1000,
        sat_fat_g: nutrientPerServing(nutriments, "saturated-fat_100g", "saturated-fat_serving", servingGrams) ?? nutrientPer100g(nutriments, "saturated-fat_100g"),
        fiber_g: nutrientPerServing(nutriments, "fiber_100g", "fiber_serving", servingGrams) ?? nutrientPer100g(nutriments, "fiber_100g")
      }
    : {
        calories: nutrientPer100g(nutriments, "energy-kcal_100g") || toNumber(nutriments.energy_kcal),
        protein_g: nutrientPer100g(nutriments, "proteins_100g"),
        carbs_g: nutrientPer100g(nutriments, "carbohydrates_100g"),
        fat_g: nutrientPer100g(nutriments, "fat_100g"),
        sugar_g: nutrientPer100g(nutriments, "sugars_100g"),
        sodium_mg: nutrientPer100g(nutriments, "sodium_100g") * 1000,
        sat_fat_g: nutrientPer100g(nutriments, "saturated-fat_100g"),
        fiber_g: nutrientPer100g(nutriments, "fiber_100g")
      };

  const context = {
    barcode: code,
    name: product.product_name || product.product_name_en || "Scanned product",
    categories: product.categories || "",
    ingredients_text: product.ingredients_text_en || product.ingredients_text || "",
    nova_group: product.nova_group || null,
    additives_count: Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n),
    nutrition_basis: basis,
    nutrients
  };

  const requestedModel = process.env.OPENROUTER_MODEL;
  const model = requestedModel === "mistralai/ministral-3-8b" ? "google/gemini-2.5-flash-lite" : requestedModel || "google/gemini-2.5-flash-lite";

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
      temperature: 0.15,
      max_tokens: 420,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Interpret this barcode nutrition profile:\n${JSON.stringify(context)}` }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || "Gemini enrichment failed." }, { status: response.status });

  try {
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content ?? "{}");
    const alternatives = await enrichAlternativesWithImages(parsed.alternatives);

    return NextResponse.json({
      summary: typeof parsed.summary === "string" ? parsed.summary : "AI insights are based on serving-size nutrition and ingredient quality.",
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((item: unknown) => typeof item === "string").slice(0, 4) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((item: unknown) => typeof item === "string").slice(0, 4) : [],
      alternatives,
      caution: typeof parsed.caution === "string" ? parsed.caution : "Nutrition advice is informational and not medical guidance."
    });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
