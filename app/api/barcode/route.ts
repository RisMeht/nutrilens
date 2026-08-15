import { NextResponse } from "next/server";
import { fetchOpenFoodFactsProduct, findBetterSwaps } from "../../../lib/openfoodfacts";
import { buildHealthScore, hasServingNutrientData, nutrientPer100g, nutrientPerServing, parseServing, toNumber } from "../../../lib/nutrition";

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

  // Nutrition is only shown "per serving" when Open Food Facts actually knows a serving
  // weight or gives direct per-serving nutrient fields. Otherwise we show honest per-100g
  // values instead of fabricating a serving size — that mislabeling is what made scans
  // look wildly wrong (e.g. showing a full 100g of a spread as if it were "one serving").
  const serving = parseServing(product.serving_size, product.serving_quantity);
  const useServingBasis = serving.grams > 0 || hasServingNutrientData(nutriments);
  const servingLabel = useServingBasis ? serving.label || `${serving.grams}g serving` : (product.product_quantity_unit === "ml" ? "100ml" : "100g");
  const servingGrams = serving.grams;

  const per100 = {
    energy: nutrientPer100g(nutriments, "energy-kcal_100g") || toNumber(nutriments.energy_kcal),
    protein: nutrientPer100g(nutriments, "proteins_100g"),
    carbs: nutrientPer100g(nutriments, "carbohydrates_100g"),
    fat: nutrientPer100g(nutriments, "fat_100g"),
    sugar: nutrientPer100g(nutriments, "sugars_100g"),
    satFat: nutrientPer100g(nutriments, "saturated-fat_100g"),
    fiber: nutrientPer100g(nutriments, "fiber_100g"),
    sodiumMg: nutrientPer100g(nutriments, "sodium_100g") * 1000
  };

  // nutrientPerServing returns sodium in grams (same unit as the raw field), so it's
  // converted to mg separately from the rest of the per-serving figures below.
  const sodiumGPerServing = nutrientPerServing(nutriments, "sodium_100g", "sodium_serving", servingGrams);

  const display = useServingBasis
    ? {
        energy: nutrientPerServing(nutriments, "energy-kcal_100g", "energy-kcal_serving", servingGrams) ?? per100.energy,
        protein: nutrientPerServing(nutriments, "proteins_100g", "proteins_serving", servingGrams) ?? per100.protein,
        carbs: nutrientPerServing(nutriments, "carbohydrates_100g", "carbohydrates_serving", servingGrams) ?? per100.carbs,
        fat: nutrientPerServing(nutriments, "fat_100g", "fat_serving", servingGrams) ?? per100.fat,
        sugar: nutrientPerServing(nutriments, "sugars_100g", "sugars_serving", servingGrams) ?? per100.sugar,
        satFat: nutrientPerServing(nutriments, "saturated-fat_100g", "saturated-fat_serving", servingGrams) ?? per100.satFat,
        fiber: nutrientPerServing(nutriments, "fiber_100g", "fiber_serving", servingGrams) ?? per100.fiber
      }
    : per100;

  const sodiumMgDisplay = useServingBasis ? (sodiumGPerServing ?? per100.sodiumMg / 1000) * 1000 : per100.sodiumMg;

  const additivesCount = Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n);
  const novaGroup = toNumber(product.nova_group);
  const fruitVegPct = toNumber(
    nutriments["fruits-vegetables-nuts-estimate-from-ingredients_100g"] ??
      nutriments["fruits-vegetables-nuts_100g"] ??
      nutriments["fruits-vegetables-legumes-estimate-from-ingredients_100g"]
  );

  // The score always runs on per-100g density (see lib/nutrition.ts), regardless of what basis is displayed.
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

  // "High in" thresholds: FSA per-100g cutoffs when showing per-100g, FDA-style 20%-DV
  // per-serving cutoffs when a real serving size is known — either way the wording matches the numbers shown.
  const sugarLimit = useServingBasis ? 12 : 22.5;
  const sodiumLimit = useServingBasis ? 500 : 600;
  const satFatLimit = useServingBasis ? 5 : 5;
  const basisWord = useServingBasis ? "serving" : "100g";

  const concerns: string[] = [];
  if (display.sugar >= sugarLimit) concerns.push(`High sugar per ${basisWord}: ${display.sugar.toFixed(1)}g.`);
  if (sodiumMgDisplay >= sodiumLimit) concerns.push(`High sodium per ${basisWord}: ${Math.round(sodiumMgDisplay)}mg.`);
  if (display.satFat >= satFatLimit) concerns.push(`High saturated fat per ${basisWord}: ${display.satFat.toFixed(1)}g.`);
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
    sugarPer100g: per100.sugar,
    sodiumMgPer100g: per100.sodiumMg,
    satFatPer100g: per100.satFat,
    energyPer100g: per100.energy
  });

  const facts = [
    { label: "Basis", value: useServingBasis ? servingLabel : `Per ${servingLabel} (no serving size listed)` },
    { label: "Sugar", value: `${display.sugar ? display.sugar.toFixed(1) : "0"}g / ${basisWord}` },
    { label: "Sodium", value: `${Math.round(sodiumMgDisplay)}mg / ${basisWord}` },
    { label: "Sat fat", value: `${display.satFat ? display.satFat.toFixed(1) : "0"}g / ${basisWord}` },
    { label: "Fiber", value: `${display.fiber ? display.fiber.toFixed(1) : "0"}g / ${basisWord}` },
    { label: "Additives", value: `${additivesCount || 0}` },
    { label: "Ingredients", value: `${ingredients.length || 0}` }
  ];

  return NextResponse.json({
    name: productName,
    category: "BARCODE",
    grade,
    score,
    summary: useServingBasis
      ? `Nutrition is calculated for ${servingLabel} using label data from Open Food Facts.`
      : `This product's label doesn't list a serving size, so nutrition is shown per ${servingLabel}.`,
    calories: Math.round(display.energy),
    protein: Number(display.protein.toFixed(1)),
    carbs: Number(display.carbs.toFixed(1)),
    fat: Number(display.fat.toFixed(1)),
    highlights: [
      product.brands ? `Brand: ${product.brands}` : "Brand not listed",
      product.quantity ? `Pack size: ${product.quantity}` : "Pack size missing",
      useServingBasis ? `Serving: ${servingLabel}` : "Serving size not listed by the manufacturer"
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
