import { NextResponse } from "next/server";
import { fetchOpenFoodFactsProduct, findBetterSwaps, productImageUrl } from "../../../lib/openfoodfacts";
import { buildHealthScore, nutrientPer100g, parseServing, toNumber } from "../../../lib/nutrition";

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

  // per100 is the one figure Open Food Facts reliably has for every product, so it's the
  // canonical source of truth (and what the health score is always computed from below).
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

  // What's actually shown to the user is per-serving — that's what matches the label they're
  // holding. Rather than trust Open Food Facts' own "_serving" fields (inconsistently
  // populated per nutrient, which is what caused wrong-looking numbers before), every serving
  // figure here is derived by uniformly scaling the trusted per100 numbers by one serving
  // weight. That keeps every nutrient on the same, self-consistent basis. Falls back to
  // showing per 100g only when no serving weight can be determined at all.
  const serving = parseServing(product.serving_size, product.serving_quantity);
  const hasServing = serving.grams > 0;
  const scale = hasServing ? serving.grams / 100 : 1;
  const basisLabel = hasServing ? serving.label || `${serving.grams}g` : "100g";
  const display = {
    energy: per100.energy * scale,
    protein: per100.protein * scale,
    carbs: per100.carbs * scale,
    fat: per100.fat * scale,
    sugar: per100.sugar * scale,
    satFat: per100.satFat * scale,
    fiber: per100.fiber * scale,
    sodiumMg: per100.sodiumMg * scale
  };

  const additivesCount = Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n);
  const novaGroup = toNumber(product.nova_group);
  const fruitVegPct = toNumber(
    nutriments["fruits-vegetables-nuts-estimate-from-ingredients_100g"] ??
      nutriments["fruits-vegetables-nuts_100g"] ??
      nutriments["fruits-vegetables-legumes-estimate-from-ingredients_100g"]
  );

  // This is an instant, deterministic placeholder score (Nutri-Score points + a NOVA
  // adjustment) shown immediately, always computed per 100g regardless of the display basis
  // above. app/api/barcode/enrich/route.ts replaces it moments later with a holistic score
  // from Gemini, which can weigh context a rigid formula can't (e.g. a high-protein,
  // low-sugar bar shouldn't be marked down just for being packaged).
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

  // FSA "high in" per-100g cutoffs, scaled to whatever basis is actually shown.
  const concerns: string[] = [];
  if (display.sugar >= 22.5 * scale) concerns.push(`High sugar: ${display.sugar.toFixed(1)}g per ${basisLabel}.`);
  if (display.sodiumMg >= 600 * scale) concerns.push(`High sodium: ${Math.round(display.sodiumMg)}mg per ${basisLabel}.`);
  if (display.satFat >= 5 * scale) concerns.push(`High saturated fat: ${display.satFat.toFixed(1)}g per ${basisLabel}.`);
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
    { label: "Sugar", value: `${display.sugar ? display.sugar.toFixed(1) : "0"}g` },
    { label: "Sodium", value: `${Math.round(display.sodiumMg)}mg` },
    { label: "Sat fat", value: `${display.satFat ? display.satFat.toFixed(1) : "0"}g` },
    { label: "Fiber", value: `${display.fiber ? display.fiber.toFixed(1) : "0"}g` }
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
    summary: hasServing ? `Nutrition per serving (${basisLabel}).` : "This product's label doesn't list a serving size, so nutrition is shown per 100g.",
    meta,
    image: productImageUrl(product),
    calories: Math.round(display.energy),
    protein: Number(display.protein.toFixed(1)),
    carbs: Number(display.carbs.toFixed(1)),
    fat: Number(display.fat.toFixed(1)),
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
