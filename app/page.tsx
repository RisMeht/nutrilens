"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, Barcode, Camera, ChevronRight, CircleHelp, Flashlight, History as HistoryIcon, ImagePlus, Info, Leaf, LoaderCircle, MessageCircle, ScanLine, Search, Sparkles, SwitchCamera, Trash2, TrendingUp, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Alternative = { name: string; image?: string; code?: string };
type NutrientRange = { bucket: "low" | "moderate" | "high"; positionPct: number; good: boolean; bad: boolean };
type NutritionFact = { label: string; value: string; range?: NutrientRange };
type AdditiveFlag = { name: string; risk: "green" | "yellow" | "orange" | "red"; note: string; detail?: string };
type ScoreBreakdown = {
  nutrition: { score: number };
  additives: { score: number; items: AdditiveFlag[]; applicable: boolean };
  bonus: { organic: boolean };
};
type Result = {
  name: string;
  category?: string;
  score: number;
  grade: string;
  summary: string;
  meta?: string;
  image?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  highlights: string[];
  concerns?: string[];
  alternatives?: Alternative[];
  caution: string;
  facts?: NutritionFact[];
  breakdown?: ScoreBreakdown;
  code?: string;
};

type ScanMode = "food" | "barcode";
type Tab = "history" | "recs" | "scan" | "top" | "search";
type BrowseItem = { code: string; name: string; image: string; grade: string };

// A designed fallback for whenever a real product photo isn't available, instead of a plain
// placeholder text box: picks a food-appropriate emoji and one of a few brand-matched
// gradients (keyed off the name so the same food always looks the same), rendered as a small
// inline SVG — no network round trip, so it never shows up broken or slow to load.
const EMOJI_RULES: [RegExp, string][] = [
  [/salad|greens|lettuce|spinach|kale/i, "🥗"],
  [/berry|apple|banana|orange|grape|melon|mango|pear|peach|fruit/i, "🍎"],
  [/carrot/i, "🥕"],
  [/avocado/i, "🥑"],
  [/bread|toast|bagel|bun|loaf/i, "🍞"],
  [/rice|grain|oat|cereal|granola|muesli/i, "🌾"],
  [/chicken|turkey|beef|pork|steak|meat/i, "🍗"],
  [/fish|salmon|tuna|shrimp|seafood/i, "🐟"],
  [/egg/i, "🥚"],
  [/cheese|yogurt|yoghurt|milk|dairy/i, "🧀"],
  [/nut|almond|peanut|cashew/i, "🥜"],
  [/bar|protein/i, "🍫"],
  [/chocolate|candy|cookie|cake|dessert|sweet/i, "🍪"],
  [/chip|crisp|snack|cracker|pretzel/i, "🍟"],
  [/soda|cola|juice|drink|beverage/i, "🥤"],
  [/water/i, "💧"],
  [/coffee|tea/i, "☕"],
  [/pizza/i, "🍕"],
  [/pasta|noodle/i, "🍝"],
  [/soup/i, "🍲"]
];
const GRADIENTS: [string, string][] = [
  ["#dff2d8", "#a9d79c"],
  ["#e4f0e9", "#a8cdb9"],
  ["#eaf3dd", "#bcd48f"],
  ["#dcefe8", "#94c9b4"]
];
const hashString = (value: string) => { let h = 0; for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0; return h; };
const fallbackFoodImage = (name: string) => {
  const emoji = EMOJI_RULES.find(([re]) => re.test(name))?.[1] || "🥗";
  const [from, to] = GRADIENTS[hashString(name) % GRADIENTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="320" rx="32" fill="url(#g)"/><text x="50%" y="53%" font-size="132" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
const normalizeAlternatives = (alts?: unknown): Alternative[] => {
  if (!Array.isArray(alts)) return [];
  return alts
    .map((item): Alternative | null => {
      if (typeof item === "string") return { name: item, image: fallbackFoodImage(item) };
      if (item && typeof item === "object" && "name" in item && typeof (item as { name: unknown }).name === "string") {
        const alt = item as { name: string; image?: unknown; code?: unknown };
        return {
          name: alt.name,
          image: typeof alt.image === "string" && alt.image ? alt.image : fallbackFoodImage(alt.name),
          code: typeof alt.code === "string" ? alt.code : undefined
        };
      }
      return null;
    })
    .filter((item): item is Alternative => item !== null);
};

// Shared by the live barcode-scan flow and the Browse screen (picking any product from a
// search/category list runs through the exact same lookup+merge as actually scanning it) —
// both the instant Open Food Facts lookup and the Gemini enrichment are fetched together (in
// parallel) and merged into one result before anything is shown.
const resolveBarcodeResult = async (code: string): Promise<Result> => {
  const [offRes, enrichRes] = await Promise.allSettled([
    fetch(`/api/barcode?code=${encodeURIComponent(code)}`).then(async r => ({ ok: r.ok, data: await r.json() })),
    fetch("/api/barcode/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then(async r => ({ ok: r.ok, data: await r.json() }))
  ]);
  if (offRes.status !== "fulfilled" || !offRes.value.ok) {
    throw new Error(offRes.status === "fulfilled" ? offRes.value.data.error : "We couldn’t look up that barcode.");
  }
  const base = offRes.value.data;
  let merged = base;
  if (enrichRes.status === "fulfilled" && enrichRes.value.ok) {
    const e = enrichRes.value.data;
    merged = {
      ...base,
      score: typeof e.score === "number" ? e.score : base.score,
      grade: typeof e.grade === "string" ? e.grade : base.grade,
      summary: typeof e.summary === "string" ? e.summary : base.summary,
      highlights: Array.isArray(e.highlights) && e.highlights.length ? e.highlights : base.highlights,
      concerns: Array.isArray(e.concerns) ? e.concerns : base.concerns,
      alternatives: Array.isArray(e.alternatives) && e.alternatives.length ? e.alternatives : base.alternatives,
      caution: typeof e.caution === "string" ? e.caution : base.caution,
      breakdown: e.breakdown && typeof e.breakdown === "object" ? e.breakdown : base.breakdown
    };
  }
  return { ...merged, alternatives: normalizeAlternatives(merged.alternatives) };
};

// On-device scan history — no account or backend, matching this app's architecture, so it's
// stored in localStorage and only ever visible on this browser/device. Yuka's own history is
// tied to their account system; this is the closest equivalent that doesn't require one.
type HistoryEntry = Result & { historyId: string; scannedAt: number };
const HISTORY_KEY = "nutrilens-history-v1";
const MAX_HISTORY = 60;
const loadHistory = (): HistoryEntry[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const persistHistory = (list: HistoryEntry[]) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* storage full/unavailable — history is a nice-to-have, never block scanning over it */ }
};
// A food photo can be several MB straight from a phone's gallery — saved as-is, a handful of
// scans would blow past localStorage's ~5-10MB quota. Barcode images are already just short
// URLs (loaded fresh from Open Food Facts when history is viewed), so only photo-mode's data-URL
// captures need shrinking down to a small thumbnail before they're persisted.
const shrinkImageForHistory = (dataUrl: string): Promise<string> => new Promise((resolve) => {
  if (!dataUrl.startsWith("data:")) { resolve(dataUrl); return; }
  const img = new window.Image();
  img.onload = () => {
    const size = 240;
    const ratio = Math.min(1, size / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * ratio));
    canvas.height = Math.max(1, Math.round(img.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) { resolve(""); return; }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL("image/jpeg", 0.6));
  };
  img.onerror = () => resolve("");
  img.src = dataUrl;
});
const addHistoryEntry = async (result: Result) => {
  const image = result.image ? await shrinkImageForHistory(result.image) : result.image;
  const entry: HistoryEntry = { ...result, image, historyId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, scannedAt: Date.now() };
  persistHistory([entry, ...loadHistory()].slice(0, MAX_HISTORY));
};
const timeAgo = (ts: number) => {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

export default function Home() {
  const [mode, setMode] = useState<ScanMode>("food"), [cameraOn, setCameraOn] = useState(false), [entered, setEntered] = useState(false), [facing, setFacing] = useState<"environment" | "user">("environment");
  const [loading, setLoading] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [cameraError, setCameraError] = useState(""), [helpOpen, setHelpOpen] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [torchOn, setTorchOn] = useState(false), [torchSupported, setTorchSupported] = useState(false);
  const [homeLeaving, setHomeLeaving] = useState(false);
  const [additiveDetail, setAdditiveDetail] = useState<AdditiveFlag | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("scan");
  const [searchSeed, setSearchSeed] = useState("");
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]), [clearArmed, setClearArmed] = useState(false);
  const openTab = (next: Tab) => { if (next === "history") { setHistoryList(loadHistory()); setClearArmed(false); } setTab(next); };
  const removeHistoryEntry = (id: string) => { const next = loadHistory().filter(e => e.historyId !== id); persistHistory(next); setHistoryList(next); };
  const clearAllHistory = () => {
    if (!clearArmed) { setClearArmed(true); window.setTimeout(() => setClearArmed(false), 3000); return; }
    persistHistory([]); setHistoryList([]); setClearArmed(false);
  };
  const viewHistoryEntry = (entry: HistoryEntry) => { setResult(entry); setError(""); setTab("scan"); };
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), imageInput = useRef<HTMLInputElement>(null);
  const stopCamera = useCallback(() => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setCameraReady(false); setTorchSupported(false); setTorchOn(false); }, []);
  const toggleTorch = useCallback(async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }); setTorchOn(next); } catch { /* some browsers advertise torch support but reject it anyway */ }
  }, [torchOn]);

  // Animates the score ring's number toward its target (both on first reveal, and again if
  // AI enrichment later revises the score) rather than snapping straight to the new value.
  const displayScoreRef = useRef(0);
  const scoreValue = result?.score;
  useEffect(() => {
    if (typeof scoreValue !== "number") { displayScoreRef.current = 0; setDisplayScore(0); return; }
    const target = Math.round(scoreValue);
    const start = displayScoreRef.current;
    const startTime = performance.now();
    const duration = 650;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(start + (target - start) * eased);
      displayScoreRef.current = value;
      setDisplayScore(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scoreValue]);

  // Both the instant Open Food Facts lookup and the Gemini enrichment are fetched together
  // (in parallel, so the wait is roughly max() not sum()) and merged into ONE result before
  // anything is shown — previously the deterministic score appeared first and then visibly
  // changed once Gemini responded, which read as a bug rather than a feature. The camera
  // stays live the whole time (see below) so the scan screen doesn't flash back to its
  // empty state while this is in flight.
  const barcodeResult = useCallback(async (code: string) => {
    setLoading(true);
    setError("");
    try {
      const finalResult = await resolveBarcodeResult(code);
      setResult(finalResult);
      addHistoryEntry(finalResult).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn’t look up that barcode.");
    } finally {
      setLoading(false);
      stopCamera();
      setCameraOn(false);
    }
  }, [stopCamera]);

  // Opens the raw camera stream once per (cameraOn, facing) pair. This is intentionally
  // NOT re-run when `mode` changes: requesting getUserMedia again on every Food/Barcode
  // toggle is what caused the camera to visibly drop out and restart (the "shrinks then
  // grows" glitch) every time the mode switched. The stream now stays live across modes.
  useEffect(() => {
    if (!cameraOn || !video.current) return; let cancelled = false;
    const open = async () => { setCameraError(""); try {
      const constraints = { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
      const media = await navigator.mediaDevices.getUserMedia(constraints);
      if (cancelled) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; video.current!.srcObject = media; await video.current!.play();
      if (cancelled) return;
      setCameraReady(true);
      const caps = media.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchSupported(!!caps?.torch);
    } catch { if (!cancelled) setCameraError("Camera access is off. Click the camera icon in your browser’s address bar, allow it, then try again."); } };
    open();
    return () => { cancelled = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setCameraReady(false); setTorchSupported(false); setTorchOn(false); };
  }, [cameraOn, facing]);
  // Attaches/detaches the barcode decode loop to the already-live video element — no camera
  // restart involved, so flipping between Food and Barcode is instant and glitch-free. This
  // draws each frame to a small downscaled canvas itself rather than using zxing's built-in
  // decodeFromVideoElement loop, which captures at the camera's full resolution (up to
  // 1920x1080) on every attempt — expensive enough to visibly stutter the mode-switch
  // animation. A barcode reads fine from a much smaller frame.
  useEffect(() => {
    if (mode !== "barcode" || !cameraOn || !cameraReady || !video.current) return;
    let cancelled = false, timeoutId = 0;
    const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const SCAN_WIDTH = 640;
    const tick = () => {
      if (cancelled) return;
      const el = video.current;
      if (el && ctx && el.videoWidth) {
        const ratio = SCAN_WIDTH / el.videoWidth;
        canvas.width = SCAN_WIDTH;
        canvas.height = Math.round(el.videoHeight * ratio);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        try {
          const result = reader.decodeFromCanvas(canvas);
          if (result && !cancelled) { cancelled = true; barcodeResult(result.getText()); return; }
        } catch { /* no barcode in this frame yet — keep scanning */ }
      }
      timeoutId = window.setTimeout(tick, 200);
    };
    // Waits out the mode-switch CSS transition before the decode loop starts competing for
    // the main thread — starting it immediately was still enough to make the transition (which
    // plays over roughly this same window) stutter, even at a downscaled resolution.
    timeoutId = window.setTimeout(tick, 220);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [mode, cameraOn, cameraReady, barcodeResult]);
  useEffect(() => () => stopCamera(), [stopCamera]);
  const analyze = async (image: string) => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // The photo the user just took/picked doubles as the result header image — no extra round trip needed.
      const finalResult = { ...data, image: data.image || image, alternatives: normalizeAlternatives(data.alternatives) };
      setResult(finalResult);
      addHistoryEntry(finalResult).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "The food scan did not finish.");
    } finally {
      setLoading(false);
    }
  };
  const takeFoodScan = () => { const source = video.current; if (!source || !source.videoWidth) return imageInput.current?.click(); const c = document.createElement("canvas"), ratio = Math.min(1, 1400 / source.videoWidth); c.width = Math.round(source.videoWidth * ratio); c.height = Math.round(source.videoHeight * ratio); c.getContext("2d")?.drawImage(source, 0, 0, c.width, c.height); analyze(c.toDataURL("image/jpeg", .8)); };
  const file = (f?: File) => { if (!f) return; const reader = new FileReader(); reader.onload = () => analyze(reader.result as string); reader.readAsDataURL(f); };
  const changeMode = (next: ScanMode) => {
    if (next === mode) return;
    setMode(next);
    // The live stream carries over across modes untouched (see the camera effect above).
    // Only retry acquiring it here if it never actually came up (e.g. permission was denied).
    if (cameraOn && !cameraReady) { setCameraError(""); setCameraOn(false); requestAnimationFrame(() => setCameraOn(true)); }
  };
  const scanAgain = () => {
    setSheetClosing(true);
    setCameraOn(true); // start reopening the camera immediately, in parallel with the sheet's own closing animation
    window.setTimeout(() => { setResult(null); setError(""); setCameraError(""); setSheetClosing(false); }, 220);
  };
  const grade = result?.grade?.toLowerCase() || "a";
  const displayNumber = (value: number | undefined, suffix = "") => Number.isFinite(value) ? `${value}${suffix}` : "—";
  const resultSheetOpen = !loading && !!(result || error);
  if (!entered) return <main className={`home-screen${homeLeaving ? " leaving" : ""}`}><header className="home-header"><button className="help" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></button></header><div className="home-main"><div className="home-copy"><img className="home-logo" src="/logo" alt="" /><h1>NutriLens</h1><span>Know what’s healthy, instantly.</span></div><div className="home-card"><div className="home-card-icon">🥗</div><div className="home-card-text"><strong>Scan food</strong><span>Photo or barcode</span></div></div></div><SwipeEnter onComplete={() => { setHomeLeaving(true); window.setTimeout(() => { setEntered(true); setCameraOn(true); }, 340); }} />{helpOpen && <Help onClose={() => setHelpOpen(false)} />}</main>;
  return <main className="app-shell"><section className={`camera-screen mode-${mode} ${cameraReady ? "camera-active" : ""}`}><video ref={video} muted playsInline className="camera-feed" /><div className="camera-shade" />
    <header><div className="wordmark"><img className="wordmark-icon" src="/logo" alt="" />NutriLens</div><div className="header-actions">{torchSupported && <button className={`torch ${torchOn ? "on" : ""}`} onClick={toggleTorch} aria-label="Toggle flash"><Flashlight size={18} /></button>}<button className="help" onClick={() => setHelpOpen(true)} aria-label="Help"><CircleHelp size={20} /></button></div></header>
    <div className="top-copy"><h1 key={mode}>{mode === "food" ? "Tap to scan food" : "Hold barcode in frame"}</h1></div>
    <div className={`focus-frame ${mode === "barcode" ? "barcode-frame" : ""}`}><i /><i /><i /><i />{((mode === "barcode" && !loading && cameraReady) || (mode === "food" && loading)) && <div className="scan-beam" />}{loading && mode === "barcode" && <div className="scan-progress"><LoaderCircle className="spin scan-progress-icon" size={56} /></div>}</div>{!cameraReady && !cameraError && <div className="camera-empty"><div className="food-glow">🥗</div><p>Point, scan, understand.</p></div>}{cameraError && <div className="camera-error">{cameraError}</div>}
    <div className="bottom-panel"><div className="mode-switch"><button className={mode === "food" ? "selected" : ""} onClick={() => changeMode("food")}><Camera size={17} /> Food</button><button className={mode === "barcode" ? "selected" : ""} onClick={() => changeMode("barcode")}><Barcode size={18} /> Barcode</button></div><div className="scan-actions"><button className="gallery" onClick={() => imageInput.current?.click()} aria-label="Choose photo"><ImagePlus size={22} /></button><button className="shutter" onClick={() => mode === "food" && takeFoodScan()} aria-label="Scan"><span key={mode}>{mode === "barcode" ? <ScanLine size={31} /> : <Camera size={30} />}</span></button><button className="flip" onClick={() => { setFacing(v => v === "environment" ? "user" : "environment"); }} aria-label="Switch camera"><SwitchCamera size={22} /></button></div></div>
  </section><input ref={imageInput} type="file" accept="image/*" hidden onChange={e => file(e.target.files?.[0])} />
  {!loading && (result || error) && <div className={`result-sheet${sheetClosing ? " closing" : ""}`}><div className="sheet-card"><button className="close-sheet" onClick={scanAgain}><X size={20} /></button>{result && <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Ask about this scan"><MessageCircle size={22} /></button>}{error && !result &&<div className="scan-state"><Info size={37} /><h2>That didn’t scan</h2><p>{error}</p><button className="retry" onClick={scanAgain}>Try again</button></div>}{result && <div className="result-content"><div className="result-photo-wrap"><div className="result-photo-banner"><img src={result.image || fallbackFoodImage(result.name)} alt={result.name} onError={event => { (event.currentTarget as HTMLImageElement).src = fallbackFoodImage(result.name); }} /></div><div className={`score-ring grade-${grade}`}><b>{displayScore}</b><small>/ 100</small><em>{result.grade}</em></div></div><div className="result-title-block"><p>{result.category || "FOOD"}{result.meta ? ` · ${result.meta}` : ""}</p><h2>{result.name}</h2><span>{result.summary}</span></div><div className="nutrition-row"><div><b>{displayNumber(result.calories)}</b><span>Calories</span></div><div><b>{displayNumber(result.protein, "g")}</b><span>Protein</span></div><div><b>{displayNumber(result.carbs, "g")}</b><span>Carbs</span></div><div><b>{displayNumber(result.fat, "g")}</b><span>Fat</span></div>{result.facts?.map((fact, i) => <div key={`${fact.label}-${i}`}><b>{fact.value}</b><span>{fact.label}</span>{fact.range && <i className={`range-bar bucket-${fact.range.bucket}`}><em style={{ left: `${fact.range.positionPct}%` }} /></i>}</div>)}</div>{result.breakdown && <div className="score-breakdown"><strong>Score breakdown</strong><div className="breakdown-row"><span>Nutrition quality</span><i className="breakdown-bar"><em style={{ width: `${result.breakdown.nutrition.score}%` }} /></i><b>{result.breakdown.nutrition.score}</b></div><div className="breakdown-row"><span>Additives</span><i className="breakdown-bar"><em style={{ width: `${result.breakdown.additives.applicable ? result.breakdown.additives.score : 0}%` }} /></i><b>{result.breakdown.additives.applicable ? result.breakdown.additives.score : "—"}</b></div><div className="breakdown-row"><span>Organic bonus</span><i className="breakdown-bar"><em style={{ width: result.breakdown.bonus.organic ? "100%" : "0%" }} /></i><b>{result.breakdown.bonus.organic ? "Yes" : "—"}</b></div><p className="breakdown-weights">Weighted roughly 60% nutrition · 30% additives · 10% organic bonus.</p></div>}{result.breakdown?.additives.applicable && <div className="additives-section"><strong>Ingredients checked</strong>{result.breakdown.additives.items.length ? <div className="additive-list">{result.breakdown.additives.items.map((a, i) => <button key={`${a.name}-${i}`} type="button" className={`additive-flag risk-${a.risk}`} onClick={() => setAdditiveDetail(a)}><i className="risk-dot" /><div><b>{a.name}</b><span>{a.note}</span></div><ChevronRight size={16} className="additive-flag-chevron" /></button>)}</div> : <p className="additive-clear">No concerning additives detected in the ingredient list.</p>}</div>}{(result.highlights?.length || result.concerns?.length || result.alternatives?.length) ? <div className="ai-insights">{result.highlights?.length ? <div className="insights">{result.highlights.map((item, i) => <p key={i}><i>✓</i>{item}</p>)}</div> : null}{result.concerns?.length ? <div className="concerns"><strong><AlertTriangle size={16} /> Watch for</strong>{result.concerns.map((item, i) => <p key={i}>{item}</p>)}</div> : null}{result.alternatives?.length ? <div className="alternatives"><strong>Better swaps</strong><div className="alternatives-grid">{result.alternatives.map((item, i) => <article key={`${item.name}-${i}`}><img src={item.image || fallbackFoodImage(item.name)} alt={item.name} loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).src = fallbackFoodImage(item.name); }} /><span>{item.name}</span></article>)}</div></div> : null}</div> : null}<p className="note">{result.caution}</p>{error && <p className="note">{error}</p>}<button className="retry wide" onClick={scanAgain}>Scan another food</button></div>}</div></div>}{helpOpen && <Help onClose={() => setHelpOpen(false)} />}{additiveDetail && <AdditiveDetail item={additiveDetail} onClose={() => setAdditiveDetail(null)} />}{chatOpen && result && <Chat result={result} onClose={() => setChatOpen(false)} />}
  {tab === "history" && <History list={historyList} clearArmed={clearArmed} onClose={() => setTab("scan")} onView={viewHistoryEntry} onDelete={removeHistoryEntry} onClearAll={clearAllHistory} />}
  {tab === "recs" && <Recs onClose={() => setTab("scan")} onOpenResult={(r) => { setResult(r); setError(""); setTab("scan"); }} onSearch={(q) => { setTab("search"); setSearchSeed(q); }} />}
  {tab === "top" && <Top onClose={() => setTab("scan")} onOpenResult={(r) => { setResult(r); setError(""); setTab("scan"); addHistoryEntry(r).catch(() => {}); }} />}
  {tab === "search" && <Browse seedQuery={searchSeed} onClose={() => { setTab("scan"); setSearchSeed(""); }} onOpenResult={(r) => { setResult(r); setError(""); setTab("scan"); addHistoryEntry(r).catch(() => {}); }} />}
  {!resultSheetOpen && <nav className="tab-bar">
    <button className={tab === "history" ? "active" : ""} onClick={() => openTab("history")}><HistoryIcon size={19} /><span>History</span></button>
    <button className={tab === "recs" ? "active" : ""} onClick={() => openTab("recs")}><Sparkles size={19} /><span>Recs</span></button>
    <button className={tab === "scan" ? "active" : ""} onClick={() => openTab("scan")}><ScanLine size={19} /><span>Scan</span></button>
    <button className={tab === "top" ? "active" : ""} onClick={() => openTab("top")}><TrendingUp size={19} /><span>Top</span></button>
    <button className={tab === "search" ? "active" : ""} onClick={() => openTab("search")}><Search size={19} /><span>Search</span></button>
  </nav>}
  </main>;
}

// A real drag-to-confirm slider (not just a button styled to look like one): the thumb
// tracks the pointer and only completes past ~70% of the track, springing back otherwise.
function SwipeEnter({ onComplete }: { onComplete: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completed, setCompleted] = useState(false);
  const maxXRef = useRef(0);
  const startXRef = useRef(0);
  // Mirrors dragX/dragging outside React state: pointerdown->pointerup can fire faster than a
  // render flushes (a fast, deliberate swipe — or certain automated taps — can do this), and
  // reading the state variables directly inside release() would then see stale pre-drag
  // values, discarding a real completed swipe. The refs are always current regardless of
  // render timing; the state is kept only to drive the visible transform/opacity.
  const dragXRef = useRef(0);
  const draggingRef = useRef(false);
  const THUMB = 58;

  // Pressing anywhere on the track (not just the small thumb) starts the drag — the thumb
  // jumps to meet the finger immediately, then tracks it from there.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (completed) return;
    const track = trackRef.current;
    if (!track) return;
    maxXRef.current = Math.max(0, track.clientWidth - THUMB - 8);
    const pressX = e.clientX - track.getBoundingClientRect().left - THUMB / 2;
    const clamped = Math.min(maxXRef.current, Math.max(0, pressX));
    dragXRef.current = clamped;
    setDragX(clamped);
    startXRef.current = e.clientX - clamped;
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = Math.min(maxXRef.current, Math.max(0, e.clientX - startXRef.current));
    dragXRef.current = next;
    setDragX(next);
  };
  const release = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (maxXRef.current > 0 && dragXRef.current >= maxXRef.current * 0.7) {
      setCompleted(true);
      dragXRef.current = maxXRef.current;
      setDragX(maxXRef.current);
      onComplete(); // fires the screen transition immediately — it plays alongside the thumb's own snap animation rather than waiting for it to finish first
    } else {
      dragXRef.current = 0;
      setDragX(0);
    }
  };
  const progress = maxXRef.current > 0 ? dragX / maxXRef.current : 0;

  return <div className={`swipe-enter${completed ? " completed" : ""}`} ref={trackRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release}>
    <span className="swipe-enter-label" style={{ opacity: Math.max(0, 1 - progress * 1.6) }}>Swipe to scan</span>
    {!completed && <span className="swipe-enter-hint"><ChevronRight size={16} /><ChevronRight size={16} /></span>}
    <div className="swipe-enter-thumb" style={{ transform: `translateX(${dragX}px)`, transition: dragging ? "none" : "transform .32s cubic-bezier(.2,.8,.2,1)" }}>
      <ArrowRight size={24} />
    </div>
  </div>;
}

const RISK_LABEL: Record<AdditiveFlag["risk"], string> = { green: "Risk-free", yellow: "Limited risk", orange: "Moderate risk", red: "High risk" };
function AdditiveDetail({ item, onClose }: { item: AdditiveFlag; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); window.setTimeout(onClose, 200); };
  return <div className={`help-backdrop${closing ? " closing" : ""}`} onClick={close}><section className={`help-card additive-detail-card${closing ? " closing" : ""}`} onClick={event => event.stopPropagation()}><button onClick={close}><X size={19} /></button><span className={`risk-pill risk-${item.risk}`}><i className="risk-dot" />{RISK_LABEL[item.risk]}</span><h2>{item.name}</h2><p>{item.detail || item.note}</p><p className="help-note">Based on mainstream food-safety research (EFSA/IARC-style evidence), not a personal medical assessment.</p></section></div>;
}

type ChatMessage = { role: "user" | "assistant"; text: string };
// Grounded strictly in the currently viewed result's own data (nutrition, score breakdown,
// additive flags, AI notes) — never a general-purpose chatbot, and the panel closes with the
// result itself since a question about one product shouldn't linger into the next scan.
function Chat({ result, onClose }: { result: Result; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => { setClosing(true); window.setTimeout(onClose, 220); };

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  const send = async () => {
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    setErr("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setSending(true);
    try {
      const context = {
        name: result.name,
        category: result.category,
        score: result.score,
        grade: result.grade,
        summary: result.summary,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        facts: result.facts?.map(f => ({ label: f.label, value: f.value })),
        breakdown: result.breakdown,
        highlights: result.highlights,
        concerns: result.concerns,
        caution: result.caution
      };
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context, history: messages })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn’t get an answer.");
      setMessages(m => [...m, { role: "assistant", text: data.answer }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t get an answer.");
    } finally {
      setSending(false);
    }
  };

  return <div className={`chat-backdrop${closing ? " closing" : ""}`} onClick={close}>
    <section className={`chat-panel${closing ? " closing" : ""}`} onClick={event => event.stopPropagation()}>
      <div className="chat-header">
        <div><strong>Ask about this scan</strong><span>{result.name}</span></div>
        <button onClick={close} aria-label="Close"><X size={19} /></button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <div className="chat-empty"><MessageCircle size={26} /><p>Ask anything about {result.name} — the score, an ingredient, or a healthier swap.</p></div>}
        {messages.map((m, i) => <div key={i} className={`chat-bubble chat-${m.role}`}>{m.text}</div>)}
        {sending && <div className="chat-bubble chat-assistant chat-typing"><span /><span /><span /></div>}
      </div>
      {err && <p className="chat-error">{err}</p>}
      <div className="chat-input-row">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="Ask a question…" disabled={sending} />
        <button onClick={send} disabled={sending || !input.trim()} aria-label="Send"><ArrowUp size={18} /></button>
      </div>
    </section>
  </div>;
}

function History({ list, clearArmed, onClose, onView, onDelete, onClearAll }: { list: HistoryEntry[]; clearArmed: boolean; onClose: () => void; onView: (entry: HistoryEntry) => void; onDelete: (id: string) => void; onClearAll: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); window.setTimeout(onClose, 220); };
  return <div className={`full-page${closing ? " closing" : ""}`}>
    <div className="full-page-header">
      <button className="full-page-back" onClick={close} aria-label="Back"><ArrowLeft size={20} /></button>
      <h2>History</h2>
      {list.length > 0 && <button className="page-clear" onClick={onClearAll}><Trash2 size={13} />{clearArmed ? "Tap again to confirm" : "Clear all"}</button>}
    </div>
    <div className="full-page-content">
      {list.length === 0 ? <p className="page-empty">No scans yet — everything you scan will show up here, saved on this device only.</p> : <div className="history-list">
        {list.map(entry => <div key={entry.historyId} className="history-row">
          <button className="history-row-main" onClick={() => onView(entry)}>
            <img src={entry.image || fallbackFoodImage(entry.name)} alt="" onError={ev => { (ev.currentTarget as HTMLImageElement).src = fallbackFoodImage(entry.name); }} />
            <div className="history-row-text"><b>{entry.name}</b><span>{timeAgo(entry.scannedAt)}</span></div>
            <em className={`history-grade grade-${entry.grade.toLowerCase()}`}>{entry.grade}</em>
          </button>
          <button className="history-delete" onClick={() => onDelete(entry.historyId)} aria-label="Delete"><X size={15} /></button>
        </div>)}
      </div>}
    </div>
  </div>;
}

const TOP_CATEGORIES: { label: string; emoji: string; tag: string }[] = [
  { label: "Snacks", emoji: "🍿", tag: "en:snacks" },
  { label: "Beverages", emoji: "🥤", tag: "en:beverages" },
  { label: "Breakfast", emoji: "🥣", tag: "en:breakfasts" },
  { label: "Dairy", emoji: "🧀", tag: "en:dairies" },
  { label: "Frozen foods", emoji: "🧊", tag: "en:frozen-foods" },
  { label: "Bakery", emoji: "🥐", tag: "en:breads" },
  { label: "Chocolate", emoji: "🍫", tag: "en:chocolates" },
  { label: "Breakfast cereals", emoji: "🌾", tag: "en:breakfast-cereals" },
  { label: "Candy", emoji: "🍬", tag: "en:candies" },
  { label: "Ice cream", emoji: "🍦", tag: "en:ice-creams" }
];

// Shared by Search and Top — a grid of product photo tiles, each opening the exact same
// lookup+AI pipeline as an actual barcode scan (resolveBarcodeResult) when tapped.
function ProductGrid({ items, selecting, onSelect }: { items: BrowseItem[]; selecting: string | null; onSelect: (code: string) => void }) {
  return <div className="browse-grid">{items.map(item => <button key={item.code} className="browse-tile" disabled={!!selecting} onClick={() => onSelect(item.code)}>
    <div className="browse-tile-img"><img src={item.image || fallbackFoodImage(item.name)} alt="" onError={ev => { (ev.currentTarget as HTMLImageElement).src = fallbackFoodImage(item.name); }} />{selecting === item.code && <div className="browse-tile-loading"><LoaderCircle className="spin" size={22} /></div>}</div>
    <span>{item.name}</span>
    {item.grade !== "?" && <em className={`history-grade grade-${item.grade.toLowerCase()}`}>{item.grade}</em>}
  </button>)}</div>;
}

// Search any packaged product in Open Food Facts' database directly, not just what's been
// scanned, sorted best-rated first.
function Browse({ seedQuery, onClose, onOpenResult }: { seedQuery?: string; onClose: () => void; onOpenResult: (result: Result) => void }) {
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState(seedQuery || "");
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const close = () => { setClosing(true); window.setTimeout(onClose, 220); };

  useEffect(() => {
    const q = query.trim();
    if (!q) { setItems([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/browse?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [query]);

  const select = async (code: string) => {
    setSelecting(code);
    setPickError("");
    try {
      const result = await resolveBarcodeResult(code);
      onOpenResult(result);
    } catch {
      setPickError("Couldn’t load that product. Try another.");
    } finally {
      setSelecting(null);
    }
  };

  const empty = !loading && !items.length;
  return <div className={`full-page${closing ? " closing" : ""}`}>
    <div className="full-page-header">
      <button className="full-page-back" onClick={close} aria-label="Back"><ArrowLeft size={20} /></button>
      <h2>Search</h2>
    </div>
    <div className="full-page-content">
      <div className="browse-search"><Search size={16} /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search any packaged food" /></div>
      {loading && <div className="browse-loading"><LoaderCircle className="spin" size={22} /></div>}
      {empty && query && <p className="page-empty">No products found. Try a different search.</p>}
      {empty && !query && <p className="page-empty">Search any packaged food by name — nutrition, additives, and a full score breakdown, same as scanning it.</p>}
      {pickError && <p className="page-empty">{pickError}</p>}
      {!loading && items.length > 0 && <ProductGrid items={items} selecting={selecting} onSelect={select} />}
    </div>
  </div>;
}

// Category-first browsing, sorted best-rated within each category — the closest equivalent to
// a curated "top foods" list without a proprietary ranking database to draw on.
function Top({ onClose, onOpenResult }: { onClose: () => void; onOpenResult: (result: Result) => void }) {
  const [closing, setClosing] = useState(false);
  const [category, setCategory] = useState<{ label: string; tag: string } | null>(null);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const close = () => { setClosing(true); window.setTimeout(onClose, 220); };
  const back = () => { if (category) setCategory(null); else close(); };

  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    setLoading(true);
    setItems([]);
    fetch(`/api/browse?category=${encodeURIComponent(category.tag)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category]);

  const select = async (code: string) => {
    setSelecting(code);
    setPickError("");
    try {
      const result = await resolveBarcodeResult(code);
      onOpenResult(result);
    } catch {
      setPickError("Couldn’t load that product. Try another.");
    } finally {
      setSelecting(null);
    }
  };

  return <div className={`full-page${closing ? " closing" : ""}`}>
    <div className="full-page-header">
      <button className="full-page-back" onClick={back} aria-label="Back"><ArrowLeft size={20} /></button>
      <h2>{category ? category.label : "Top"}</h2>
    </div>
    <div className="full-page-content">
      {!category && <div className="category-list">{TOP_CATEGORIES.map(c => <button key={c.tag} className="category-row" onClick={() => setCategory(c)}><span className="category-emoji">{c.emoji}</span><span className="category-label">{c.label}</span><ChevronRight size={18} /></button>)}</div>}
      {category && loading && <div className="browse-loading"><LoaderCircle className="spin" size={22} /></div>}
      {category && !loading && !items.length && <p className="page-empty">No products found for this category right now.</p>}
      {pickError && <p className="page-empty">{pickError}</p>}
      {category && !loading && items.length > 0 && <ProductGrid items={items} selecting={selecting} onSelect={select} />}
    </div>
  </div>;
}

// Surfaces the poorest-scoring items in on-device history alongside the better swap already
// found for each at scan time — a recommendations feed built entirely from data already on
// this device, no separate ranking system required.
function Recs({ onClose, onOpenResult, onSearch }: { onClose: () => void; onOpenResult: (result: Result) => void; onSearch: (query: string) => void }) {
  const [closing, setClosing] = useState(false);
  const [pairs, setPairs] = useState<{ bad: HistoryEntry; good: Alternative }[]>([]);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const close = () => { setClosing(true); window.setTimeout(onClose, 220); };

  useEffect(() => {
    const list = loadHistory();
    const seen = new Set<string>();
    const built: { bad: HistoryEntry; good: Alternative }[] = [];
    for (const entry of list) {
      const poor = entry.grade === "D" || entry.grade === "E" || (typeof entry.score === "number" && entry.score < 50);
      const good = entry.alternatives?.[0];
      if (poor && good && !seen.has(entry.name)) { seen.add(entry.name); built.push({ bad: entry, good }); }
      if (built.length >= 12) break;
    }
    setPairs(built);
  }, []);

  const openGood = async (good: Alternative) => {
    if (!good.code) { onSearch(good.name); return; }
    setSelecting(good.code);
    setPickError("");
    try {
      const result = await resolveBarcodeResult(good.code);
      onOpenResult(result);
    } catch {
      setPickError("Couldn’t load that product. Try another.");
    } finally {
      setSelecting(null);
    }
  };

  return <div className={`full-page${closing ? " closing" : ""}`}>
    <div className="full-page-header">
      <button className="full-page-back" onClick={close} aria-label="Back"><ArrowLeft size={20} /></button>
      <h2>Recommendations</h2>
    </div>
    <div className="full-page-content">
      {pairs.length === 0 && <p className="page-empty">Scan a few foods and, when one scores low, a better swap will show up here automatically.</p>}
      {pickError && <p className="page-empty">{pickError}</p>}
      {pairs.length > 0 && <div className="recs-list">{pairs.map((pair, i) => <div key={`${pair.bad.historyId}-${i}`} className="recs-pair">
        <button className="recs-tile recs-bad" onClick={() => onOpenResult(pair.bad)}>
          <div className="recs-tile-img"><img src={pair.bad.image || fallbackFoodImage(pair.bad.name)} alt="" onError={ev => { (ev.currentTarget as HTMLImageElement).src = fallbackFoodImage(pair.bad.name); }} /><i className="recs-badge recs-badge-bad"><X size={13} /></i></div>
          <span>{pair.bad.name}</span>
        </button>
        <button className="recs-tile recs-good" disabled={!!selecting} onClick={() => openGood(pair.good)}>
          <div className="recs-tile-img"><img src={pair.good.image || fallbackFoodImage(pair.good.name)} alt="" onError={ev => { (ev.currentTarget as HTMLImageElement).src = fallbackFoodImage(pair.good.name); }} />{selecting === pair.good.code ? <div className="browse-tile-loading"><LoaderCircle className="spin" size={20} /></div> : <i className="recs-badge recs-badge-good">✓</i>}</div>
          <span>{pair.good.name}</span>
        </button>
      </div>)}</div>}
    </div>
  </div>;
}

function Help({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); window.setTimeout(onClose, 200); };
  return <div className={`help-backdrop${closing ? " closing" : ""}`} onClick={close}><section className={`help-card${closing ? " closing" : ""}`} onClick={event => event.stopPropagation()}><button onClick={close}><X size={19} /></button><Leaf size={24} fill="currentColor" /><h2>Quick scan guide</h2><p><b>Food:</b> center your meal, then tap the large scan button.</p><p><b>Barcode:</b> switch modes and hold the code inside the frame—it scans automatically.</p><p className="help-note">Scores are helpful estimates, not medical advice.</p></section></div>;
}
