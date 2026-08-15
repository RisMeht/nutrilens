// Upgraded from google/gemini-2.5-flash-lite: the lite model's scoring was inconsistent
// (the same barcode could score differently on repeat scans, and food-photo vs barcode scores
// of the same product diverged more than they should). The standard flash model reasons more
// reliably for a small added cost per scan — still small enough not to meaningfully threaten a
// $5 budget at normal usage. Anyone with OPENROUTER_MODEL already set to a prior default in
// Vercel gets upgraded automatically; an intentionally-chosen different model is left alone.
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const KNOWN_PRIOR_DEFAULTS = new Set(["mistralai/ministral-3-8b", "google/gemini-2.5-flash-lite"]);

export const resolveModel = () => {
  const requested = process.env.OPENROUTER_MODEL;
  if (!requested || KNOWN_PRIOR_DEFAULTS.has(requested)) return DEFAULT_MODEL;
  return requested;
};
