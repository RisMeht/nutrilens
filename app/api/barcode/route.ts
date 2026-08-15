import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.replace(/\D/g, "");
  if (!code || code.length < 8) return NextResponse.json({ error: "Enter a valid barcode." }, { status: 400 });
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, { headers: { "User-Agent": "NutriLens/1.0 (nutrition scanner)" }, next: { revalidate: 86400 } });
  const data = await response.json();
  // The scanner can correctly read inventory/serial barcodes that are not food products.
  // Show a successful scan rather than treating a missing community database entry as a scan failure.
  if (!data.product) return NextResponse.json({
    name: "Barcode detected", grade: "?", score: 0,
    summary: `Code ${code} was read, but it is not in the food database.`, calories: 0, protein: 0, carbs: 0, fat: 0,
    highlights: ["Barcode camera scan worked", "No packaged-food record found", "Try Food mode for AI photo analysis"],
    caution: "This may be an equipment or store-internal barcode rather than a retail food product."
  });
  const p = data.product, n = p.nutriments || {};
  const score = p.nutriscore_data?.score;
  return NextResponse.json({
    name: p.product_name || p.product_name_en || "Scanned product", grade: String(p.nutriscore_grade || "?").toUpperCase(),
    score: typeof score === "number" ? Math.max(0, Math.min(100, 100 - (score + 15) * 4)) : 55,
    summary: p.generic_name || "Nutrition information from the product label.", calories: Math.round(n["energy-kcal_100g"] || n.energy_kcal || 0),
    protein: Math.round(n.proteins_100g || 0), carbs: Math.round(n.carbohydrates_100g || 0), fat: Math.round(n.fat_100g || 0),
    highlights: [p.brands ? `By ${p.brands}` : "Barcode verified", n.fiber_100g ? `${n.fiber_100g}g fiber / 100g` : "Check serving size", n["sugars_100g"] ? `${n["sugars_100g"]}g sugar / 100g` : "Low-sugar data unavailable"],
    caution: p.ingredients_text ? "Always check the ingredient list for allergies and dietary needs." : "Nutrition details may be incomplete for this product."
  });
}
