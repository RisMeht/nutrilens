import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const fallbackFoodImage = (name: string) => `https://source.unsplash.com/640x480/?food,${encodeURIComponent(name)}`;
const normalizeAlternatives = (alternatives: unknown) => {
  if (!Array.isArray(alternatives)) return [];
  return alternatives
    .map((item) => {
      if (typeof item === "string") return { name: item.trim(), image: fallbackFoodImage(item) };
      if (item && typeof item === "object" && "name" in item && typeof (item as { name: unknown }).name === "string") {
        const alt = item as { name: string; image?: unknown };
        return { name: alt.name.trim(), image: typeof alt.image === "string" && alt.image ? alt.image : fallbackFoodImage(alt.name) };
      }
      return null;
    })
    .filter((item): item is { name: string; image: string } => Boolean(item && item.name));
};

const system = `You are NutriLens, a careful nutrition assistant. Identify the food or packaged product in the image.
Return ONLY valid JSON with this exact shape:
{"name":"string","category":"string","score":number,"grade":"A|B|C|D|E","summary":"one helpful sentence","calories":number,"protein":number,"carbs":number,"fat":number,"highlights":["string","string","string"],"concerns":["string"],"alternatives":[{"name":"string","image":"https://..."}],"caution":"string"}.
Score is 0-100 where high means a generally nutritious everyday choice.
Grade A 80-100, B 65-79, C 45-64, D 25-44, E 0-24.
Consider protein, fiber, added sugar, sodium, saturated fat, ingredients and degree of processing.
Be conservative: a photo cannot establish exact serving size or ingredients.
Use 0 for uncertain macros; never diagnose or make medical claims.
If you do not know alternative image URLs, return alternatives as text names and NutriLens will fill images.`;

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
      temperature: 0.2,
      max_tokens: 450,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this food photo." },
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
    return NextResponse.json({ ...parsed, alternatives: normalizeAlternatives(parsed.alternatives) });
  } catch {
    return NextResponse.json({ error: "The AI returned an unreadable result. Please try again." }, { status: 502 });
  }
}
