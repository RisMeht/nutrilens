import { NextResponse } from "next/server";
import { enrichAlternativesWithImages } from "../../../lib/openfoodfacts";
import { gradeForScore } from "../../../lib/nutrition";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = `You are NutriLens, a careful nutrition assistant.
Return ONLY valid JSON with this exact shape:
{"name":"string","category":"string","score":number,"summary":"one helpful sentence","calories":number,"protein":number,"carbs":number,"fat":number,"highlights":["string","string","string"],"concerns":["string"],"alternatives":["string","string"],"caution":"string"}.
Rules:
- Use conservative nutrition estimates from visible evidence only, for a single realistic serving of what's shown.
- If serving size is uncertain, state uncertainty in summary and caution.
- Never invent ingredient lists, medical claims, or disease advice.
- Score is 0-100, where higher means a more nutritious everyday choice. Weigh protein, fiber and whole-food ingredients positively; weigh added sugar, sodium, saturated fat and degree of processing negatively. Roughly: 80-100 whole/minimally processed and nutrient-dense, 65-79 solid everyday choice, 45-64 mixed/moderately processed, 25-44 noticeably unbalanced, 0-24 heavily processed or nutrient-poor.
- Do not include a "grade" field — it is computed from the score.
- Alternatives must be realistic healthier swaps for the same food type.`;

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
      max_tokens: 500,
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
    const alternatives = await enrichAlternativesWithImages(parsed.alternatives);
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0;
    // Grade is derived from the score rather than trusted from the model, so the two can never disagree.
    return NextResponse.json({ ...parsed, score, grade: gradeForScore(score), alternatives });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
