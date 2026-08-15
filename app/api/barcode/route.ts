import { NextResponse } from "next/server";
import { fetchOpenFoodFactsProduct, findBetterSwaps } from "../../../lib/openfoodfacts";
import { buildHealthScore, nutrientPerServing, parseServing, toNumber } from "../../../lib/nutrition";

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
      facts: [{ label: "Barcode", value: code }],
      code
    });
  }

  const nutriments = (product.nutriments || {}) as Record<string, unknown>;
  const ingredientsText = (product.ingredients_text_en || product.ingredients_text || "").toString().trim();
  const ingredients = ingredientsText
    .split(/[,;]+/)
    .map((item: string) => item.trim())
    .filter(Boolean);

  const serving = parseServing(product.serving_size);
  const servingLabel = serving.label === "Not listed" ? "1 serving (from label)" : serving.label;
  const servingGrams = serving.grams;

  const energyPerServing = nutrientPerServing(nutriments, "energy-kcal_100g", "energy-kcal_serving", servingGrams) || toNumber(nutriments.energy_kcal);
  const proteinPerServing = nutrientPerServing(nutriments, "proteins_100g", "proteins_serving", servingGrams);
  const carbsPerServing = nutrientPerServing(nutriments, "carbohydrates_100g", "carbohydrates_serving", servingGrams);
  const fatPerServing = nutrientPerServing(nutriments, "fat_100g", "fat_serving", servingGrams);
  const sugarPerServing = nutrientPerServing(nutriments, "sugars_100g", "sugars_serving", servingGrams);
  const satFatPerServing = nutrientPerServing(nutriments, "saturated-fat_100g", "saturated-fat_serving", servingGrams);
  const fiberPerServing = nutrientPerServing(nutriments, "fiber_100g", "fiber_serving", servingGrams);
  const sodiumGPerServing = nutrientPerServing(nutriments, "sodium_100g", "sodium_serving", servingGrams);
  const sodiumMgPerServing = sodiumGPerServing * 1000;

  const additivesCount = Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n);
  const novaGroup = toNumber(product.nova_group);
  const fruitVegPct = toNumber(
    nutriments["fruits-vegetables-nuts-estimate-from-ingredients_100g"] ??
      nutriments["fruits-vegetables-nuts_100g"] ??
      nutriments["fruits-vegetables-legumes-estimate-from-ingredients_100g"]
  );

  const { score, grade } = buildHealthScore({
    sugarPerServing,
    sodiumMgPerServing,
    satFatPerServing,
    fiberPerServing,
    proteinPerServing,
    energyPerServing,
    additivesCount,
    ingredientCount: ingredients.length,
    novaGroup,
    fruitVegPct
  });

  const concerns: string[] = [];
  if (sugarPerServing >= 12) concerns.push(`High sugar for one serving: ${sugarPerServing.toFixed(1)}g.`);
  if (sodiumMgPerServing >= 500) concerns.push(`High sodium for one serving: ${Math.round(sodiumMgPerServing)}mg.`);
  if (satFatPerServing >= 5) concerns.push(`High saturated fat for one serving: ${satFatPerServing.toFixed(1)}g.`);
  if (additivesCount >= 3) concerns.push(`${additivesCount} additives listed.`);
  if (!ingredientsText) concerns.push("Ingredient list is incomplete in the source database.");

  const productName =
    (typeof product.product_name === "string" && product.product_name.trim()) ||
    (typeof product.product_name_en === "string" && product.product_name_en.trim()) ||
    "Scanned product";

  const alternatives = await findBetterSwaps({
    productName,
    productCode: code,
    categories: product.categories_tags,
    sugarPerServing,
    sodiumMgPerServing,
    satFatPerServing,
    energyPerServing
  });

  const facts = [
    { label: "Serving", value: servingLabel },
    { label: "Sugar", value: `${sugarPerServing ? sugarPerServing.toFixed(1) : "0"}g / serving` },
    { label: "Sodium", value: `${Math.round(sodiumMgPerServing)}mg / serving` },
    { label: "Sat fat", value: `${satFatPerServing ? satFatPerServing.toFixed(1) : "0"}g / serving` },
    { label: "Fiber", value: `${fiberPerServing ? fiberPerServing.toFixed(1) : "0"}g / serving` },
    { label: "Additives", value: `${additivesCount || 0}` },
    { label: "Ingredients", value: `${ingredients.length || 0}` }
  ];

  return NextResponse.json({
    name: productName,
    category: "BARCODE",
    grade,
    score,
    summary: `Nutrition is calculated for ${servingLabel} using reliable label data from Open Food Facts.`,
    calories: Math.round(energyPerServing),
    protein: Number(proteinPerServing.toFixed(1)),
    carbs: Number(carbsPerServing.toFixed(1)),
    fat: Number(fatPerServing.toFixed(1)),
    highlights: [
      product.brands ? `Brand: ${product.brands}` : "Brand not listed",
      product.quantity ? `Pack size: ${product.quantity}` : "Pack size missing",
      servingLabel !== "1 serving (from label)" ? `Serving: ${servingLabel}` : "Serving size not explicitly listed"
    ],
    concerns,
    alternatives,
    caution: ingredientsText
      ? "Always check the package label for allergy and ingredient updates before consuming."
      : "Some details are missing in the source database. Verify with the product label.",
    facts,
    code
  });
}
