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

// A handful of core nutrients Open Food Facts populates with a "_serving" suffix
// whenever it actually knows the serving weight, independent of serving_size text.
const CORE_NUTRIENT_KEYS = ["energy-kcal", "proteins", "carbohydrates", "fat", "sugars", "sodium", "saturated-fat", "fiber"];

export const hasServingNutrientData = (nutriments: Record<string, unknown>) =>
  CORE_NUTRIENT_KEYS.some((key) => nutriments[`${key}_serving`] !== undefined && nutriments[`${key}_serving`] !== null);

export const parseServing = (servingSize: unknown, servingQuantity: unknown) => {
  const fromQuantity = toNumber(servingQuantity);
  if (fromQuantity > 0) {
    const text = typeof servingSize === "string" ? servingSize.trim() : "";
    return { label: text || `${fromQuantity}g`, grams: fromQuantity };
  }
  const value = typeof servingSize === "string" ? servingSize.trim().toLowerCase() : "";
  if (!value) return { label: "", grams: 0 };
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(g|gram|grams|ml|milliliter|milliliters)/i);
  const amount = match ? toNumber(match[1]) : 0;
  return { label: value, grams: amount > 0 ? amount : 0 };
};

// Resolves one nutrient to an actual per-serving amount. Only trusts a serving-basis
// number when Open Food Facts gives us real serving data (a direct "_serving" field,
// or a serving weight we can multiply the per-100g figure by) — otherwise returns null
// rather than silently passing off per-100g data as "one serving".
export const nutrientPerServing = (nutriments: Record<string, unknown>, key100g: string, keyServing: string, servingGrams: number) => {
  const rawServing = nutriments[keyServing];
  if (rawServing !== undefined && rawServing !== null) return toNumber(rawServing);
  if (servingGrams > 0) {
    const per100 = toNumber(nutriments[key100g]);
    return (per100 * servingGrams) / 100;
  }
  return null;
};

export const nutrientPer100g = (nutriments: Record<string, unknown>, key100g: string) => toNumber(nutriments[key100g]);

// Points-per-threshold lookup, mirroring how the published Nutri-Score algorithm scores
// each nutrient: 0 points below the first (best) threshold, rising by one point per
// threshold crossed, capped at thresholds.length (worst).
const pointsFromThresholds = (value: number, thresholds: number[]) => {
  for (let i = 0; i < thresholds.length; i++) if (value <= thresholds[i]) return i;
  return thresholds.length;
};

const ENERGY_KJ_THRESHOLDS = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGAR_THRESHOLDS = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34];
const SAT_FAT_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SODIUM_MG_THRESHOLDS = [90, 180, 270, 360, 450, 540, 630, 720, 810, 900];
const FIBER_THRESHOLDS = [0.9, 1.9, 2.8, 3.7, 4.7];
const PROTEIN_THRESHOLDS = [1.6, 3.2, 4.8, 6.4, 8];
const fruitVegPoints = (pct: number) => (pct >= 80 ? 5 : pct >= 60 ? 2 : pct >= 40 ? 1 : 0);

// Anchors mapping Nutri-Score-style "final points" (lower is healthier, roughly -15..44
// once the NOVA adjustment below is included) onto this app's 0-100 score, chosen so the
// breakpoints land exactly on gradeForScore's own A-E cutoffs — score and letter grade can
// never disagree.
const SCORE_ANCHORS: Array<[points: number, score: number]> = [
  [-15, 100],
  [-1, 80],
  [2, 65],
  [10, 45],
  [18, 25],
  [44, 0]
];

const scoreFromPoints = (points: number) => {
  const clamped = clamp(points, SCORE_ANCHORS[0][0], SCORE_ANCHORS[SCORE_ANCHORS.length - 1][0]);
  for (let i = 0; i < SCORE_ANCHORS.length - 1; i++) {
    const [p1, s1] = SCORE_ANCHORS[i];
    const [p2, s2] = SCORE_ANCHORS[i + 1];
    if (clamped >= p1 && clamped <= p2) return Math.round(s1 + ((clamped - p1) / (p2 - p1)) * (s2 - s1));
  }
  return 0;
};

// Nutri-Score grades packaged food per 100g/100ml, which is also the one basis Open Food
// Facts reliably has for every product (serving size is frequently missing or unparsable) —
// scoring off per-100g density, rather than a possibly-fabricated "per serving" number,
// keeps the result consistent and matches the same standard shown on real European labels.
// On top of the official nutrient point table, a modest NOVA processing adjustment is added
// (Nutri-Score itself is nutrient-only and ignores ultra-processing) so a highly processed
// product can't out-score a whole-food one purely by having favorable macros.
export const buildHealthScore = ({
  sugarPer100g,
  sodiumMgPer100g,
  satFatPer100g,
  fiberPer100g,
  proteinPer100g,
  energyPer100g,
  novaGroup,
  fruitVegPct
}: {
  sugarPer100g: number;
  sodiumMgPer100g: number;
  satFatPer100g: number;
  fiberPer100g: number;
  proteinPer100g: number;
  energyPer100g: number;
  novaGroup: number;
  fruitVegPct: number;
}) => {
  const energyPts = pointsFromThresholds(energyPer100g * 4.184, ENERGY_KJ_THRESHOLDS);
  const sugarPts = pointsFromThresholds(sugarPer100g, SUGAR_THRESHOLDS);
  const satFatPts = pointsFromThresholds(satFatPer100g, SAT_FAT_THRESHOLDS);
  const sodiumPts = pointsFromThresholds(sodiumMgPer100g, SODIUM_MG_THRESHOLDS);
  const nutrientNegativePoints = energyPts + sugarPts + satFatPts + sodiumPts; // 0-40, official scale

  const processingPoints = novaGroup >= 4 ? 4 : novaGroup === 3 ? 2 : 0; // 0 when NOVA is unknown, rather than assuming the worst
  const negativePoints = nutrientNegativePoints + processingPoints;

  const fiberPts = pointsFromThresholds(fiberPer100g, FIBER_THRESHOLDS);
  const fruitVegPts = fruitVegPoints(fruitVegPct);
  const proteinPts = pointsFromThresholds(proteinPer100g, PROTEIN_THRESHOLDS);
  // Official rule: protein only counts toward the positive side once the food isn't
  // already heavily negative-scored, otherwise a protein-fortified junk food could look healthy.
  const proteinCounts = nutrientNegativePoints < 11 || fruitVegPts === 5;
  const positivePoints = fiberPts + fruitVegPts + (proteinCounts ? proteinPts : 0);

  const finalPoints = negativePoints - positivePoints;
  const grade = finalPoints <= -1 ? "A" : finalPoints <= 2 ? "B" : finalPoints <= 10 ? "C" : finalPoints <= 18 ? "D" : "E";
  const score = scoreFromPoints(finalPoints);

  return { score, grade };
};
