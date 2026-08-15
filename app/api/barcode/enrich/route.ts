import { NextResponse } from "next/server";
import { enrichAlternativesWithImages, fetchOpenFoodFactsProduct } from "../../../../lib/openfoodfacts";
import { gradeForScore, nutrientPer100g, toNumber } from "../../../../lib/nutrition";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = `You are NutriLens AI, a nutrition expert interpreting one packaged food's per-100g nutrition and ingredient facts.
Return ONLY valid JSON with this exact shape:
{"score":number,"summary":"string","highlights":["string","string","string"],"concerns":["string","string"],"alternatives":["string","string"],"caution":"string"}
Rules:
- score is 0-100, higher meaning a more nutritious everyday choice. Judge holistically like a nutritionist, not a rigid points formula: weigh protein, fiber and whole-food ingredients positively; weigh added sugar, sodium, saturated fat and unnecessary processing negatively — but use real judgment. A high-protein, low-sugar, high-fiber bar or shake should score well even if it's "processed", the same way a nutritionist wouldn't dismiss it just for coming in a wrapper. Don't let one moderate number (e.g. saturated fat from a chocolate coating) tank an otherwise excellent product. Roughly: 80-100 excellent everyday choice, 65-79 solid choice, 45-64 mixed/moderate, 25-44 noticeably unbalanced, 0-24 poor nutritional quality.
- Use only the provided nutrition and ingredient facts, all given per 100g/100ml. Do not invent nutrients, serving sizes, or medical claims.
- Keep highlights/concerns short and concrete (cite actual numbers when useful), max 3 each. Only include a concern that's genuinely notable — don't pad the list.
- Alternatives must be realistic healthier packaged swaps for the same type of product, max 3.`;

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
  const nutrients_per_100g = {
    calories: nutrientPer100g(nutriments, "energy-kcal_100g") || toNumber(nutriments.energy_kcal),
    protein_g: nutrientPer100g(nutriments, "proteins_100g"),
    carbs_g: nutrientPer100g(nutriments, "carbohydrates_100g"),
    fat_g: nutrientPer100g(nutriments, "fat_100g"),
    sugar_g: nutrientPer100g(nutriments, "sugars_100g"),
    sodium_mg: (nutrientPer100g(nutriments, "sodium_100g") || nutrientPer100g(nutriments, "salt_100g") / 2.5) * 1000,
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
    nutrients_per_100g
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
      temperature: 0.2,
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
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null;

    return NextResponse.json({
      score,
      grade: score === null ? null : gradeForScore(score),
      summary: typeof parsed.summary === "string" ? parsed.summary : "AI insights are based on per-100g nutrition and ingredient quality.",
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((item: unknown) => typeof item === "string").slice(0, 3) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((item: unknown) => typeof item === "string").slice(0, 3) : [],
      alternatives,
      caution: typeof parsed.caution === "string" ? parsed.caution : "Nutrition advice is informational and not medical guidance."
    });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
