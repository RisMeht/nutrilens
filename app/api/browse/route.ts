import { NextResponse } from "next/server";
import { browseProducts } from "../../../lib/openfoodfacts";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") || "").trim().slice(0, 80);
  const category = (params.get("category") || "").trim().slice(0, 80);
  if (!query && !category) return NextResponse.json({ items: [] });

  const items = await browseProducts({ query: query || undefined, category: query ? undefined : category || undefined });
  return NextResponse.json({ items });
}
