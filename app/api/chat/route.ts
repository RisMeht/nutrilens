import { NextResponse } from "next/server";
import { resolveModel } from "../../../lib/ai-model";

export const runtime = "nodejs";
export const maxDuration = 30;

const system = (context: unknown) => `You are Viva AI, answering a user's question about ONE specific food they just scanned in the app.
Ground every answer in the JSON context below — cite its actual numbers when relevant, and if something is asked that the context doesn't cover, say so honestly instead of guessing or inventing facts.
Keep answers conversational and concise (2-4 sentences unless the question genuinely needs a longer breakdown). General nutrition information only — never a medical diagnosis or personalized medical advice.
Context for this scan:
${JSON.stringify(context).slice(0, 6000)}`;

export async function POST(request: Request) {
  const { question, context, history } = await request.json();
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured on the server." }, { status: 503 });

  const priorTurns = Array.isArray(history)
    ? history
        .slice(-8)
        .filter((m: unknown): m is { role: unknown; text: unknown } => !!m && typeof m === "object")
        .map((m: { role: unknown; text: unknown }) => ({ role: m.role === "user" ? "user" : "assistant", content: typeof m.text === "string" ? m.text : "" }))
        .filter((m: { content: string }) => m.content)
    : [];

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
      temperature: 0.3,
      max_tokens: 350,
      messages: [{ role: "system", content: system(context) }, ...priorTurns, { role: "user", content: question.slice(0, 600) }]
    })
  });

  const data = await response.json();
  if (!response.ok) return NextResponse.json({ error: data?.error?.message || "Couldn't get an answer." }, { status: response.status });

  const answer = data.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) return NextResponse.json({ error: "The AI returned an empty response." }, { status: 502 });
  return NextResponse.json({ answer: answer.trim() });
}
