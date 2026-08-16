import { NextResponse } from "next/server";
import { fetchOpenFoodFactsProduct, gradeFromNutriments } from "../../../lib/openfoodfacts";

export const runtime = "nodejs";

// Search/Top/Better-swaps paint their grade badges instantly from Open Food Facts' search
// index — fast, but that index empirically lags/disagrees with the canonical product database
// often enough (confirmed by direct comparison: several sampled products had meaningfully
// different nutriment values between the two, occasionally enough to flip a letter grade) that
// trusting it alone reintroduces the exact "list said X, detail says Y" bug the deterministic
// scoring fix was meant to close. This endpoint recomputes the same grade from the canonical
// source for one product at a time, cheap enough to fire in the background for every visible
// tile right after the grid itself has already painted — the badge quietly self-corrects a
// moment later if the two sources actually disagreed, without blocking the initial (fast) paint.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") || "";
  if (!/^\d{8,14}$/.test(code)) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const product = await fetchOpenFoodFactsProduct(code);
  if (!product) return NextResponse.json({ code, grade: null });

  const grade = gradeFromNutriments((product.nutriments || {}) as Record<string, unknown>, product.nova_group);
  return NextResponse.json({ code, grade: grade === "?" ? null : grade });
}
