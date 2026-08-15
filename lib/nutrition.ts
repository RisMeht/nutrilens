const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const gradeForScore = (score: number) => (score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : score >= 25 ? "D" : "E");

export const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parseServing = (servingSize: unknown) => {
  const value = typeof servingSize === "string" ? servingSize.trim().toLowerCase() : "";
  if (!value) return { label: "Not listed", grams: 0 };
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(g|gram|grams|ml|milliliter|milliliters)/i);
  const amount = match ? toNumber(match[1]) : 0;
  const grams = amount;
  return { label: value, grams: grams > 0 ? grams : 0 };
};

export const nutrientPerServing = (
  nutriments: Record<string, unknown>,
  keyPer100g: string,
  keyServing: string,
  servingGrams: number
) => {
  const directServing = toNumber(nutriments[keyServing]);
  if (directServing > 0) return directServing;
  const per100 = toNumber(nutriments[keyPer100g]);
  if (per100 > 0 && servingGrams > 0) return (per100 * servingGrams) / 100;
  return per100;
};

export const buildHealthScore = ({
  sugarPerServing,
  sodiumMgPerServing,
  satFatPerServing,
  fiberPerServing,
  proteinPerServing,
  energyPerServing,
  additivesCount,
  ingredientCount,
  novaGroup,
  fruitVegPct
}: {
  sugarPerServing: number;
  sodiumMgPerServing: number;
  satFatPerServing: number;
  fiberPerServing: number;
  proteinPerServing: number;
  energyPerServing: number;
  additivesCount: number;
  ingredientCount: number;
  novaGroup: number;
  fruitVegPct: number;
}) => {
  const sugarPenalty = clamp((sugarPerServing - 5) * 3.2, 0, 24);
  const sodiumPenalty = clamp((sodiumMgPerServing - 140) / 14, 0, 22);
  const satFatPenalty = clamp((satFatPerServing - 2) * 5.6, 0, 18);
  const energyPenalty = clamp((energyPerServing - 260) / 16, 0, 14);
  const additivePenalty = clamp(additivesCount * 2.3, 0, 12);
  const complexityPenalty = clamp((ingredientCount - 10) * 0.9, 0, 10);
  const processingPenalty = clamp((novaGroup - 1) * 3.8, 0, 12);

  const fiberBonus = clamp(fiberPerServing * 2.4, 0, 14);
  const proteinBonus = clamp((proteinPerServing - 3) * 1.9, 0, 14);
  const fruitVegBonus = clamp(fruitVegPct / 7, 0, 10);

  const score = Math.round(
    clamp(
      72 - sugarPenalty - sodiumPenalty - satFatPenalty - energyPenalty - additivePenalty - complexityPenalty - processingPenalty + fiberBonus + proteinBonus + fruitVegBonus,
      0,
      100
    )
  );

  return { score, grade: gradeForScore(score) };
};
