import { NextResponse } from "next/server";
import { fetchOpenFoodFactsProduct, findBetterSwaps, productImageUrl } from "../../../lib/openfoodfacts";
import { buildHealthScore, nutrientPer100g, toNumber } from "../../../lib/nutrition";

export async function GET(request: Request) {
  const rawCode = new URL(request.url).searchParams.get("code") || "";
  if (!/^\d{8,14}$/.test(rawCode)) return NextResponse.json({ error: "Enter a valid barcode." }, { status: 400 });
  const code = rawCode;

  const product = await fetchOpenFoodFactsProduct(code);
  if (!product) {
    return NextResponse.json({
      name: "Barcode detected",
      category: "BARCODE",
      grade: "?",
      score: 0,
      summary: `Code ${code} was read, but it is not in the food database.`,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      highlights: ["Barcode camera scan worked", "No packaged-food record found", "Try Food mode for AI photo analysis"],
      concerns: ["This barcode may belong to a non-food item or a product missing from public records."],
      alternatives: [],
      caution: "No Open Food Facts entry was found for this barcode.",
      facts: [],
      code
    });
  }

  const nutriments = (product.nutriments || {}) as Record<string, unknown>;
  const ingredientsText = (product.ingredients_text_en || product.ingredients_text || "").toString().trim();

  // Every number shown and scored comes from one canonical basis — per 100g/100ml, the one
  // figure Open Food Facts reliably has for every product. Serving size is frequently missing,
  // unparsable, or only partially populated (some nutrients have a "_serving" field, others
  // don't) — mixing bases per-nutrient is exactly what made scans show wrong numbers before.
  // When a real serving weight IS known, it's surfaced as a simple secondary annotation only.
  const per100 = {
    energy: nutrientPer100g(nutriments, "energy-kcal_100g") || toNumber(nutriments.energy_kcal),
    protein: nutrientPer100g(nutriments, "proteins_100g"),
    carbs: nutrientPer100g(nutriments, "carbohydrates_100g"),
    fat: nutrientPer100g(nutriments, "fat_100g"),
    sugar: nutrientPer100g(nutriments, "sugars_100g"),
    satFat: nutrientPer100g(nutriments, "saturated-fat_100g"),
    fiber: nutrientPer100g(nutriments, "fiber_100g"),
    // Sodium falls back to salt/2.5 (the standard conversion) since some entries only carry salt.
    sodiumMg: (nutrientPer100g(nutriments, "sodium_100g") || nutrientPer100g(nutriments, "salt_100g") / 2.5) * 1000
  };

  const additivesCount = Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n);
  const novaGroup = toNumber(product.nova_group);
  const fruitVegPct = toNumber(
    nutriments["fruits-vegetables-nuts-estimate-from-ingredients_100g"] ??
      nutriments["fruits-vegetables-nuts_100g"] ??
      nutriments["fruits-vegetables-legumes-estimate-from-ingredients_100g"]
  );

  // This is an instant, deterministic placeholder score (Nutri-Score points + a NOVA
  // adjustment) shown immediately. app/api/barcode/enrich/route.ts replaces it moments
  // later with a holistic score from Gemini, which can weigh context a rigid formula can't
  // (e.g. a high-protein, low-sugar bar shouldn't be marked down just for being packaged).
  const { score, grade } = buildHealthScore({
    sugarPer100g: per100.sugar,
    sodiumMgPer100g: per100.sodiumMg,
    satFatPer100g: per100.satFat,
    fiberPer100g: per100.fiber,
    proteinPer100g: per100.protein,
    energyPer100g: per100.energy,
    novaGroup,
    fruitVegPct
  });

  // FSA "high in" per-100g cutoffs.
  const concerns: string[] = [];
  if (per100.sugar >= 22.5) concerns.push(`High sugar: ${per100.sugar.toFixed(1)}g per 100g.`);
  if (per100.sodiumMg >= 600) concerns.push(`High sodium: ${Math.round(per100.sodiumMg)}mg per 100g.`);
  if (per100.satFat >= 5) concerns.push(`High saturated fat: ${per100.satFat.toFixed(1)}g per 100g.`);
  if (additivesCount >= 3) concerns.push(`${additivesCount} additives listed.`);

  const productName =
    (typeof product.product_name === "string" && product.product_name.trim()) ||
    (typeof product.product_name_en === "string" && product.product_name_en.trim()) ||
    "Scanned product";

  const alternatives = (
    await findBetterSwaps({
      productName,
      productCode: code,
      categories: product.categories_tags,
      sugarPer100g: per100.sugar,
      sodiumMgPer100g: per100.sodiumMg,
      satFatPer100g: per100.satFat,
      energyPer100g: per100.energy
    })
  ).slice(0, 3);

  const facts = [
    { label: "Sugar", value: `${per100.sugar ? per100.sugar.toFixed(1) : "0"}g` },
    { label: "Sodium", value: `${Math.round(per100.sodiumMg)}mg` },
    { label: "Sat fat", value: `${per100.satFat ? per100.satFat.toFixed(1) : "0"}g` },
    { label: "Fiber", value: `${per100.fiber ? per100.fiber.toFixed(1) : "0"}g` }
  ];

  // Open Food Facts is community-edited, and fields like "quantity" occasionally contain
  // garbage (e.g. "55unknown") — only surface it if it actually looks like a size/weight.
  const brand = typeof product.brands === "string" ? product.brands.trim().split(",")[0].trim() : "";
  const quantityText = typeof product.quantity === "string" ? product.quantity.trim() : "";
  const quantity = /\d\s*(g|kg|mg|ml|cl|l|oz|lbs?|pcs?|x)\b/i.test(quantityText) ? quantityText : "";
  const meta = [brand, quantity].filter(Boolean).join(" · ");

  return NextResponse.json({
    name: productName,
    category: "BARCODE",
    grade,
    score,
    summary: "Nutrition shown per 100g of this product.",
    meta,
    image: productImageUrl(product),
    calories: Math.round(per100.energy),
    protein: Number(per100.protein.toFixed(1)),
    carbs: Number(per100.carbs.toFixed(1)),
    fat: Number(per100.fat.toFixed(1)),
    highlights: [],
    concerns,
    alternatives,
    caution: ingredientsText
      ? "Always check the package label for allergy and ingredient updates before consuming."
      : "Some details are missing in the source database. Verify with the product label.",
    facts,
    code
  });
}
