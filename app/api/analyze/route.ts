import { NextResponse } from "next/server";
import { enrichAlternativesWithImages } from "../../../lib/openfoodfacts";
import { gradeForScore, toNumber, SCORING_RUBRIC } from "../../../lib/nutrition";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = `You are NutriLens, a careful nutrition assistant.
Return ONLY valid JSON with this exact shape:
{"visible":boolean,"name":"string","category":"string","score":number,"summary":"one helpful sentence","calories":number,"protein":number,"carbs":number,"fat":number,"sugar_g":number,"sodium_mg":number,"sat_fat_g":number,"fiber_g":number,"highlights":["string","string"],"concerns":["string"],"alternatives":["string","string"],"caution":"string"}.
Rules:
- Set visible to false if the photo does NOT clearly show a specific, identifiable food or packaged product — e.g. it's blank, black, too dark, blurry, or shows something unrelated to food. In that case set every other field to an empty/zero default and do not guess a specific dish — never invent a plausible-sounding food that isn't actually shown. Only set visible to true when you can genuinely identify what's in the photo.
- When visible is true, use conservative nutrition estimates from visible evidence only, for a single realistic serving of what's shown. Use 0 for a nutrient you truly can't estimate.
- If serving size is uncertain, state uncertainty in summary and caution.
- Never invent ingredient lists, medical claims, or disease advice.
- ${SCORING_RUBRIC}
- Do not include a "grade" field — it is computed from the score.
- Keep highlights and concerns short and concrete, max 2-3 each — only include a concern that's genuinely notable.
- Alternatives must be realistic healthier swaps for the same food type, max 3.`;

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

  const requestedModel = process.env.OPENROUTER_MODEL;
  const model = requestedModel === "mistralai/ministral-3-8b" ? "google/gemini-2.5-flash-lite" : requestedModel || "google/gemini-2.5-flash-lite";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
      "X-Title": "NutriLens"
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_tokens: 550,
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

    const sugar = toNumber(parsed.sugar_g);
    const sodium = toNumber(parsed.sodium_mg);
    const satFat = toNumber(parsed.sat_fat_g);
    const fiber = toNumber(parsed.fiber_g);
    const facts = [
      { label: "Sugar", value: `${sugar ? sugar.toFixed(1) : "0"}g` },
      { label: "Sodium", value: `${Math.round(sodium)}mg` },
      { label: "Sat fat", value: `${satFat ? satFat.toFixed(1) : "0"}g` },
      { label: "Fiber", value: `${fiber ? fiber.toFixed(1) : "0"}g` }
    ];

    // Grade is derived from the score rather than trusted from the model, so the two can never disagree.
    return NextResponse.json({ ...parsed, score, grade: gradeForScore(score), facts, alternatives });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
