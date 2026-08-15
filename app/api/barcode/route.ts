import { NextResponse } from "next/server";

const toNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const gradeForScore = (score: number) => (score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : score >= 25 ? "D" : "E");

const buildHealthScore = (nutriments: Record<string, unknown>, additivesCount: number, ingredientCount: number) => {
  const sugar = toNumber(nutriments.sugars_100g);
  const satFat = toNumber(nutriments["saturated-fat_100g"]);
  const fiber = toNumber(nutriments.fiber_100g);
  const protein = toNumber(nutriments.proteins_100g);
  const energy = toNumber(nutriments["energy-kcal_100g"] ?? nutriments.energy_kcal);
  const sodiumMg = toNumber(nutriments.sodium_100g) * 1000;
  const fruitVegPct = toNumber(
    nutriments["fruits-vegetables-nuts-estimate-from-ingredients_100g"] ??
    nutriments["fruits-vegetables-nuts_100g"] ??
    nutriments["fruits-vegetables-legumes-estimate-from-ingredients_100g"]
  );

  const sugarPenalty = clamp((sugar - 4) * 1.9, 0, 25);
  const satFatPenalty = clamp((satFat - 1) * 4.2, 0, 20);
  const sodiumPenalty = clamp((sodiumMg - 120) / 23, 0, 24);
  const energyPenalty = clamp((energy - 140) / 15, 0, 14);
  const additivesPenalty = clamp(additivesCount * 2, 0, 10);
  const complexityPenalty = clamp((ingredientCount - 12) * 0.8, 0, 8);
  const fiberBonus = clamp(fiber * 2.2, 0, 12);
  const proteinBonus = clamp((protein - 2) * 1.2, 0, 9);
  const fruitVegBonus = clamp(fruitVegPct / 7.5, 0, 12);

  const score = Math.round(
    clamp(
      68 - sugarPenalty - satFatPenalty - sodiumPenalty - energyPenalty - additivesPenalty - complexityPenalty + fiberBonus + proteinBonus + fruitVegBonus,
      0,
      100
    )
  );

  return { score, grade: gradeForScore(score), sugar, satFat, fiber, protein, energy, sodiumMg };
};

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.replace(/\D/g, "");
  if (!code || code.length < 8) return NextResponse.json({ error: "Enter a valid barcode." }, { status: 400 });

  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, {
    headers: { "User-Agent": "NutriLens/1.0 (nutrition scanner)" },
    next: { revalidate: 86400 }
  });
  const data = await response.json();

  if (!data.product) {
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
      concerns: ["This barcode may belong to inventory equipment or a non-food item."],
      alternatives: [],
      caution: "No Open Food Facts entry was found for this barcode.",
      facts: [{ label: "Barcode", value: code }],
      code
    });
  }

  const product = data.product;
  const nutriments = (product.nutriments || {}) as Record<string, unknown>;
  const ingredientsText = (product.ingredients_text_en || product.ingredients_text || "").toString().trim();
  const ingredients = ingredientsText
    .split(/[,;]+/)
    .map((item: string) => item.trim())
    .filter(Boolean);
  const additivesCount = Array.isArray(product.additives_tags) ? product.additives_tags.length : toNumber(product.additives_n);
  const { score, grade, sugar, satFat, fiber, protein, energy, sodiumMg } = buildHealthScore(nutriments, additivesCount, ingredients.length);
  const calories = Math.round(energy);
  const carbs = Math.round(toNumber(nutriments.carbohydrates_100g));
  const fat = Math.round(toNumber(nutriments.fat_100g));
  const concerns: string[] = [];

  if (sugar >= 10) concerns.push(`High sugar: ${sugar.toFixed(1)}g per 100g.`);
  if (sodiumMg >= 400) concerns.push(`High sodium: ${Math.round(sodiumMg)}mg per 100g.`);
  if (satFat >= 5) concerns.push(`High saturated fat: ${satFat.toFixed(1)}g per 100g.`);
  if (additivesCount >= 3) concerns.push(`${additivesCount} additives listed.`);
  if (!ingredientsText) concerns.push("Ingredient list is incomplete in the source database.");

  const facts = [
    { label: "Sugar", value: `${sugar ? sugar.toFixed(1) : "0"}g / 100g` },
    { label: "Sodium", value: `${Math.round(sodiumMg)}mg / 100g` },
    { label: "Sat fat", value: `${satFat ? satFat.toFixed(1) : "0"}g / 100g` },
    { label: "Fiber", value: `${fiber ? fiber.toFixed(1) : "0"}g / 100g` },
    { label: "Additives", value: `${additivesCount || 0}` },
    { label: "Ingredients", value: `${ingredients.length || 0}` }
  ];

  return NextResponse.json({
    name: product.product_name || product.product_name_en || "Scanned product",
    category: "BARCODE",
    grade,
    score,
    summary: product.generic_name || "Instant label summary from Open Food Facts. Gemini insights are loading next.",
    calories,
    protein: Math.round(protein),
    carbs,
    fat,
    highlights: [
      product.brands ? `Brand: ${product.brands}` : "Brand not listed",
      product.quantity ? `Pack size: ${product.quantity}` : "Pack size missing",
      product.nova_group ? `NOVA group ${product.nova_group}` : "Processing level unavailable"
    ],
    concerns,
    alternatives: [],
    caution: ingredientsText
      ? "Check the on-pack allergen statement and serving size before eating."
      : "Some product details are missing in the community database.",
    facts,
    code
  });
}
