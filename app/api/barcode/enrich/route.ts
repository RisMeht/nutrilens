import { NextResponse } from "next/server";
import { enrichAlternativesWithImages, fetchOpenFoodFactsProduct } from "../../../../lib/openfoodfacts";
import {
  additivesScoreFromFlags,
  buildHealthScore,
  gradeForScore,
  hasHighRiskAdditive,
  nutrientPer100g,
  parseServing,
  toNumber,
  SCORING_RUBRIC,
  type AdditiveFlag,
  type AdditiveRisk,
  type ScoreBreakdown
} from "../../../../lib/nutrition";
import { resolveModel } from "../../../../lib/ai-model";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = `You are Nura AI, a nutrition expert interpreting one packaged food's nutrition and ingredient facts.
Return ONLY valid JSON with this exact shape:
{"reasoning":"one short internal sentence weighing the nutrition facts before you commit to a score","score":number,"nutritionScore":number,"summary":"string","highlights":["string","string","string"],"concerns":["string","string"],"alternatives":["string","string"],"caution":"string","additives":[{"name":"string","risk":"green"|"yellow"|"orange"|"red","note":"one short reason, under 12 words","detail":"2-3 sentences: what it is / why it's used in food, then what the risk concern actually is (or why it's considered safe)"}]}
Fill "reasoning" first, before deciding the score — briefly note the 2-3 factors that matter most for this specific product, then let the score follow from that.
Rules:
- ${SCORING_RUBRIC} Base the score on nutrients_per_100g (the standard, comparable nutrition-density basis) so it isn't skewed by serving size. A high-protein, low-sugar, high-fiber bar or shake should score well even if it's "processed", the same way a nutritionist wouldn't dismiss it just for coming in a wrapper.
- "nutritionScore" is the same 0-100 scale but judges ONLY the raw nutrient profile (energy, sugar, saturated fat, sodium, fiber, protein density) — ignore ingredients/additives/processing for this number specifically. Judge it the way the official Nutri-Score system would: sugary drinks and sodas are judged strictly by their sugar and calorie density and should score LOW here (mid-30s or worse) even though a single can/bottle is "just one serving" — don't let a modest per-serving gram amount read as harmless the way it might for a solid food.
- When highlights/concerns cite a specific amount, cite the nutrients_per_serving numbers (that's what's shown on screen) using the given serving label — never cite the per-100g numbers directly, and never invent a serving size other than the one given.
- Use only the provided nutrition and ingredient facts. Do not invent nutrients or medical claims.
- Keep highlights/concerns short and concrete, max 3 each. Only include a concern that's genuinely notable — don't pad the list.
- Alternatives must be realistic healthier packaged swaps for the same type of product, max 3.
- For "additives": scan ingredients_text for actual food additives (E-numbers, preservatives, artificial colors/sweeteners, emulsifiers, stabilizers) — skip plain foods, water, spices, and basic ingredients like flour or salt. Classify each by mainstream food-safety consensus (the kind of evidence EFSA/IARC review): "red" = credible evidence of meaningful health risk (e.g. potassium bromate, BHA/BHT, certain azo dyes, some nitrites/nitrates); "orange" = moderate/uncertain-but-real concern (e.g. some phosphate or carrageenan-type additives); "yellow" = limited/low-level concern; "green" = widely regarded as safe (e.g. citric acid, ascorbic acid, pectin, lecithin, natural flavors). If ingredients_text is empty or has no notable additives, return an empty array — never invent an ingredient list. "detail" expands on "note" for a reader who taps into it — plain language, factual, no medical advice or scare language beyond what the evidence supports.`;

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

  const serving = parseServing(product.serving_size, product.serving_quantity);
  const hasServing = serving.grams > 0;
  const scale = hasServing ? serving.grams / 100 : 1;
  const serving_label = hasServing ? serving.label || `${serving.grams}g` : "100g (no serving size listed)";
  const nutrients_per_serving = Object.fromEntries(Object.entries(nutrients_per_100g).map(([key, value]) => [key, Math.round(value * scale * 10) / 10]));

  const ingredientsText = (product.ingredients_text_en || product.ingredients_text || "").toString();
  const context = {
    barcode: code,
    name: product.product_name || product.product_name_en || "Scanned product",
    categories: product.categories || "",
    ingredients_text: ingredientsText,
    nova_group: product.nova_group || null,
    additives_count: Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n),
    serving_label,
    nutrients_per_100g,
    nutrients_per_serving
  };

  // Fallback-only figure for the "Nutritional quality" third of the breakdown, used just in
  // case the model's own nutritionScore below is missing/invalid. Not used as the primary
  // source: buildHealthScore's threshold table is tuned for solid foods, so on its own it
  // reads sugary drinks as far healthier than they are (Nutri-Score's real methodology uses a
  // separate, stricter table for beverages that isn't replicated here) — the model, prompted
  // to judge nutrient density the way Nutri-Score actually treats beverages, does this better.
  const novaGroup = toNumber(product.nova_group);
  const fruitVegPct = toNumber(
    nutriments["fruits-vegetables-nuts-estimate-from-ingredients_100g"] ??
      nutriments["fruits-vegetables-nuts_100g"] ??
      nutriments["fruits-vegetables-legumes-estimate-from-ingredients_100g"]
  );
  const { score: nutritionScoreFallback } = buildHealthScore({
    sugarPer100g: nutrients_per_100g.sugar_g,
    sodiumMgPer100g: nutrients_per_100g.sodium_mg,
    satFatPer100g: nutrients_per_100g.sat_fat_g,
    fiberPer100g: nutrients_per_100g.fiber_g,
    proteinPer100g: nutrients_per_100g.protein_g,
    energyPer100g: nutrients_per_100g.calories,
    novaGroup,
    fruitVegPct
  });
  const isOrganic = Array.isArray(product.labels_tags) && product.labels_tags.some((tag) => typeof tag === "string" && /organic/i.test(tag));

  const model = resolveModel();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      "X-Title": "Nura"
    },
    body: JSON.stringify({
      model,
      // Deterministic (or as close as the provider allows): scanning the same barcode twice
      // should return the same score, not a different one each time.
      temperature: 0,
      max_tokens: 950,
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

    const VALID_RISKS = new Set(["green", "yellow", "orange", "red"]);
    const additives: AdditiveFlag[] = Array.isArray(parsed.additives)
      ? parsed.additives
          .filter((item: unknown): item is { name: unknown; risk: unknown; note: unknown; detail: unknown } => !!item && typeof item === "object")
          .map((item: { name: unknown; risk: unknown; note: unknown; detail: unknown }) => ({
            name: typeof item.name === "string" ? item.name : "",
            risk: (VALID_RISKS.has(item.risk as string) ? item.risk : "green") as AdditiveRisk,
            note: typeof item.note === "string" ? item.note : "",
            detail: typeof item.detail === "string" ? item.detail : ""
          }))
          .filter((item: AdditiveFlag) => item.name)
          .slice(0, 6)
      : [];

    let score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null;
    // Enforced server-side (not left to the model) so it's never inconsistent: Yuka's
    // published rule is that a single high-risk additive caps the whole product at 49/100,
    // and organic products get a small bonus — same 60/30/10 shape as the breakdown below.
    if (score !== null) {
      if (isOrganic) score = Math.min(100, score + 6);
      if (hasHighRiskAdditive(additives)) score = Math.min(score, 49);
    }

    const nutritionScore =
      typeof parsed.nutritionScore === "number" && Number.isFinite(parsed.nutritionScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.nutritionScore)))
        : nutritionScoreFallback;
    const breakdown: ScoreBreakdown = {
      nutrition: { score: nutritionScore },
      additives: { score: additivesScoreFromFlags(additives), items: additives, applicable: ingredientsText.length > 0 },
      bonus: { organic: isOrganic }
    };

    return NextResponse.json({
      score,
      grade: score === null ? null : gradeForScore(score),
      summary: typeof parsed.summary === "string" ? parsed.summary : "AI insights are based on nutrition and ingredient quality.",
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((item: unknown) => typeof item === "string").slice(0, 3) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((item: unknown) => typeof item === "string").slice(0, 3) : [],
      alternatives,
      caution: typeof parsed.caution === "string" ? parsed.caution : "Nutrition advice is informational and not medical guidance.",
      breakdown
    });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
