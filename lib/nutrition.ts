const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const gradeForScore = (score: number) => (score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : score >= 25 ? "D" : "E");

// Shared verbatim between the barcode (enrich) and food-photo (analyze) AI prompts. Scanning
// the same real product by barcode vs. photo used to produce visibly different scores because
// the two prompts described "healthy" in slightly different words — using one shared rubric
// closes that gap as much as prompt wording can.
export const SCORING_RUBRIC =
  'score is 0-100, higher meaning a more nutritious everyday choice for a generally healthy adult. Reason like an experienced nutritionist, not a rigid points formula: weigh protein, fiber, whole-food ingredients and micronutrient density positively; weigh added sugar, sodium, saturated fat and unnecessary ultra-processing negatively. Use real judgment — don\'t let one moderate number (e.g. saturated fat from a chocolate coating, or sodium in an otherwise excellent high-protein food) drag down an otherwise strong choice, and don\'t reward a product just for being low-calorie if it is nutritionally empty. Bands: 80-100 excellent everyday choice, 65-79 solid choice, 45-64 mixed/moderate, 25-44 noticeably unbalanced, 0-24 poor nutritional quality. Score the same real product consistently regardless of how it was scanned.';

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

// Only used for the small "serving ≈ Xkcal" annotation — the actual displayed and scored
// nutrition always comes from nutrientPer100g below, so a missing/unparsable serving size
// just means no annotation, never a wrong or mislabeled number.
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

export type RangeBucket = "low" | "moderate" | "high";
export type NutrientRangeInfo = { bucket: RangeBucket; positionPct: number; good: boolean; bad: boolean; highIsGood: boolean };

// Energy's official Nutri-Score thresholds are published in kJ; calories displayed on screen
// are kcal, so the same table is re-expressed in kcal (÷4.184) rather than converting the
// value at every call site.
const CALORIE_THRESHOLDS = ENERGY_KJ_THRESHOLDS.map((kj) => kj / 4.184);

type RangeKey = "calories" | "sugar" | "sodiumMg" | "satFat" | "fiber" | "protein";
const RANGE_CONFIG: Record<RangeKey, { thresholds: number[]; goodDirection: "low" | "high" }> = {
  calories: { thresholds: CALORIE_THRESHOLDS, goodDirection: "low" },
  sugar: { thresholds: SUGAR_THRESHOLDS, goodDirection: "low" },
  sodiumMg: { thresholds: SODIUM_MG_THRESHOLDS, goodDirection: "low" },
  satFat: { thresholds: SAT_FAT_THRESHOLDS, goodDirection: "low" },
  fiber: { thresholds: FIBER_THRESHOLDS, goodDirection: "high" },
  protein: { thresholds: PROTEIN_THRESHOLDS, goodDirection: "high" }
};

// Buckets a nutrient amount into low/moderate/high using the same published Nutri-Score
// threshold tables the health score itself is built from, rather than inventing separate
// cutoffs — so a "range" shown on screen always agrees with what the score is actually
// penalizing or rewarding. `scale` extends the (per-100g) thresholds to whatever basis the
// value is on, the same trick the FSA "high in" concern flags already use for per-serving figures.
export const nutrientRange = (key: RangeKey, value: number, scale = 1): NutrientRangeInfo => {
  const { thresholds, goodDirection } = RANGE_CONFIG[key];
  const scaled = thresholds.map((t) => t * scale);
  const lowMax = scaled[Math.max(0, Math.ceil(scaled.length / 3) - 1)];
  const highMin = scaled[Math.min(scaled.length - 1, Math.ceil((scaled.length * 2) / 3) - 1)];
  const scaleMax = scaled[scaled.length - 1] * 1.2;
  const positionPct = clamp((value / scaleMax) * 100, 3, 100);
  const bucket: RangeBucket = value <= lowMax ? "low" : value >= highMin ? "high" : "moderate";
  const good = goodDirection === "low" ? bucket === "low" : bucket === "high";
  const bad = goodDirection === "low" ? bucket === "high" : bucket === "low";
  return { bucket, positionPct, good, bad, highIsGood: goodDirection === "high" };
};

// Yuka publishes its scoring as three weighted parts — nutritional quality (Nutri-Score
// based, 60%), additive risk (30%, any single high-risk additive caps the whole product at
// 49/100), and an organic bonus (10%) — without publishing the exact per-additive numbers
// behind it (that database is proprietary). This mirrors the published SHAPE of that method
// using our own Nutri-Score math for the nutrition third and the model's own food-safety
// reasoning (grounded in the same EFSA/IARC-style evidence Yuka cites) for the additive third,
// rather than reproducing anything of Yuka's own.
export type AdditiveRisk = "green" | "yellow" | "orange" | "red";
export type AdditiveFlag = { name: string; risk: AdditiveRisk; note: string; detail?: string };

export const additivesScoreFromFlags = (flags: AdditiveFlag[]) => {
  if (!flags.length) return 100;
  const penalty = flags.reduce((sum, f) => sum + (f.risk === "red" ? 40 : f.risk === "orange" ? 15 : f.risk === "yellow" ? 4 : 0), 0);
  return clamp(100 - penalty, 0, 100);
};
export const hasHighRiskAdditive = (flags: AdditiveFlag[]) => flags.some((f) => f.risk === "red");

export type ScoreBreakdown = {
  nutrition: { score: number };
  additives: { score: number; items: AdditiveFlag[]; applicable: boolean };
  bonus: { organic: boolean };
};
