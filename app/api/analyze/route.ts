import { NextResponse } from "next/server";
import { enrichAlternativesWithImages } from "../../../lib/openfoodfacts";
import { gradeForScore, nutrientRange, toNumber, additivesScoreFromFlags, SCORING_RUBRIC, type AdditiveFlag, type AdditiveRisk, type ScoreBreakdown } from "../../../lib/nutrition";
import { resolveModel } from "../../../lib/ai-model";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = `You are Viva, a careful nutrition assistant.
Return ONLY valid JSON with this exact shape:
{"visible":boolean,"reasoning":"one short internal sentence weighing the nutrition facts before you commit to a score","name":"string","category":"string","score":number,"summary":"one helpful sentence","calories":number,"protein":number,"carbs":number,"fat":number,"sugar_g":number,"sodium_mg":number,"sat_fat_g":number,"fiber_g":number,"highlights":["string","string"],"concerns":["string"],"alternatives":["string","string"],"caution":"string","ingredients_visible":boolean,"additives":[{"name":"string","risk":"green"|"yellow"|"orange"|"red","note":"one short reason, under 12 words","detail":"2-3 sentences: what it is / why it's used in food, then what the risk concern actually is (or why it's considered safe)"}]}.
Fill "reasoning" first, before deciding the score — briefly note the 2-3 factors that matter most for this specific food, then let the score follow from that.
Rules:
- Set visible to false if the photo does NOT clearly show a specific, identifiable food or packaged product — e.g. it's blank, black, too dark, blurry, or shows something unrelated to food. In that case set every other field to an empty/zero default and do not guess a specific dish — never invent a plausible-sounding food that isn't actually shown. Only set visible to true when you can genuinely identify what's in the photo.
- When visible is true, use conservative nutrition estimates from visible evidence only, for a single realistic serving of what's shown. Use 0 for a nutrient you truly can't estimate.
- If serving size is uncertain, state uncertainty in summary and caution.
- Never invent ingredient lists, medical claims, or disease advice.
- ${SCORING_RUBRIC}
- Do not include a "grade" field — it is computed from the score.
- Keep highlights and concerns short and concrete, max 2-3 each — only include a concern that's genuinely notable.
- Alternatives must be realistic healthier swaps for the same food type, max 3.
- "ingredients_visible": true ONLY if an actual printed ingredients list on packaging is legible enough in the photo to actually read specific ingredient names off it (not just a nutrition facts panel, and not a guess at what a homemade or unpackaged dish probably contains). Home-cooked meals, produce, restaurant plates, and any photo where the ingredients text is blurry/cut off/too small to read must get ingredients_visible:false and additives:[].
- When ingredients_visible is true, scan the ingredients you actually read for real food additives (E-numbers, preservatives, artificial colors/sweeteners, emulsifiers, stabilizers) — skip plain foods, water, spices, and basic ingredients like flour or salt. Classify each by mainstream food-safety consensus (the kind of evidence EFSA/IARC review): "red" = credible evidence of meaningful health risk (e.g. potassium bromate, BHA/BHT, certain azo dyes, some nitrites/nitrates); "orange" = moderate/uncertain-but-real concern; "yellow" = limited/low-level concern; "green" = widely regarded as safe (e.g. citric acid, ascorbic acid, pectin, lecithin, natural flavors). If nothing notable, return an empty array — never invent an ingredient you didn't actually read off the package.`;

export async function POST(request: Request) {
  const { image } = await request.json();
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "Please send a valid food image." }, { status: 400 });
  }
  if (image.length > 5_500_000) {
    return NextResponse.json({ error: "That image is too large. Try a smaller photo." }, { status: 413 });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured on the server." }, { status: 503 });

  const model = resolveModel();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      "X-Title": "Viva"
    },
    body: JSON.stringify({
      model,
      // Deterministic (or as close as the provider allows): the same photo of the same food
      // scanned twice should give the same score, not a different one each time.
      temperature: 0,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this food photo and estimate a realistic per-serving nutrition profile." },
            { type: "image_url", image_url: { url: image } }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || "The AI scan could not be completed." }, { status: response.status });

  try {
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content ?? "{}");

    if (parsed.visible === false) {
      return NextResponse.json({ error: "We couldn't identify a food item in that photo. Try a clearer, well-lit shot." }, { status: 422 });
    }

    const alternatives = await enrichAlternativesWithImages(parsed.alternatives);
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0;

    const calories = toNumber(parsed.calories);
    const protein = toNumber(parsed.protein);
    const carbs = toNumber(parsed.carbs);
    const fat = toNumber(parsed.fat);
    const sugar = toNumber(parsed.sugar_g);
    const sodium = toNumber(parsed.sodium_mg);
    const satFat = toNumber(parsed.sat_fat_g);
    const fiber = toNumber(parsed.fiber_g);
    // Ranges use the same Nutri-Score threshold tables as barcode products, at scale 1 (a
    // single estimated serving has no reliable per-100g conversion from a photo alone) — a
    // directionally useful "how much is this, roughly" gauge rather than a precise density figure.
    // Carbs and fat get no range: Nutri-Score itself only scores saturated fat and sugar
    // specifically, never total carbs or total fat, so a colored good/bad slider for either
    // would be asserting a threshold that doesn't actually exist.
    const facts = [
      { label: "Calories", value: `${Math.round(calories)}`, range: nutrientRange("calories", calories) },
      { label: "Protein", value: `${protein ? protein.toFixed(1) : "0"}g`, range: nutrientRange("protein", protein) },
      { label: "Carbs", value: `${carbs ? carbs.toFixed(1) : "0"}g` },
      { label: "Fat", value: `${fat ? fat.toFixed(1) : "0"}g` },
      { label: "Sugar", value: `${sugar ? sugar.toFixed(1) : "0"}g`, range: nutrientRange("sugar", sugar) },
      { label: "Sodium", value: `${Math.round(sodium)}mg`, range: nutrientRange("sodiumMg", sodium) },
      { label: "Sat fat", value: `${satFat ? satFat.toFixed(1) : "0"}g`, range: nutrientRange("satFat", satFat) },
      { label: "Fiber", value: `${fiber ? fiber.toFixed(1) : "0"}g`, range: nutrientRange("fiber", fiber) }
    ];

    // A photo has no reliable organic signal, so that third of the Yuka-style breakdown never
    // applies here. Additives DO apply when the photo actually shows a legible ingredients
    // list on packaging (ingredients_visible) — same risk-flag detail as a barcode scan — but
    // fall back to not-applicable for home-cooked/unpackaged food the same as before.
    const VALID_RISKS = new Set(["green", "yellow", "orange", "red"]);
    const additives: AdditiveFlag[] = Array.isArray(parsed.additives)
      ? parsed.additives
          .filter((item: unknown): item is { name: unknown; risk: unknown; note: unknown; detail: unknown } => !!item && typeof item === "object")
          .map((item: { name: unknown; risk: unknown; note: unknown; detail: unknown }) => ({
            name: typeof item.name === "string" ? item.name : "",
            risk: (VALID_RISKS.has(item.risk as string) ? item.risk : "green") as AdditiveRisk,
            note: typeof item.note === "string" ? item.note : "",
            detail: typeof item.detail === "string" ? item.detail : ""
          }))
          .filter((item: AdditiveFlag) => item.name)
          .slice(0, 6)
      : [];
    const ingredientsVisible = parsed.ingredients_visible === true;

    const breakdown: ScoreBreakdown = {
      nutrition: { score },
      additives: { score: ingredientsVisible ? additivesScoreFromFlags(additives) : 100, items: ingredientsVisible ? additives : [], applicable: ingredientsVisible },
      bonus: { organic: false }
    };

    // Grade is derived from the score rather than trusted from the model, so the two can never disagree.
    return NextResponse.json({ ...parsed, score, grade: gradeForScore(score), facts, alternatives, breakdown });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
