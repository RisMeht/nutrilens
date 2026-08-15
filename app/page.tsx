"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Barcode, Camera, ChevronRight, CircleHelp, Flashlight, ImagePlus, Info, Leaf, LoaderCircle, ScanLine, Sparkles, SwitchCamera, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Alternative = { name: string; image?: string };
type NutritionFact = { label: string; value: string };
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
  code?: string;
};

type ScanMode = "food" | "barcode";

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
        const alt = item as { name: string; image?: unknown };
        return { name: alt.name, image: typeof alt.image === "string" && alt.image ? alt.image : fallbackFoodImage(alt.name) };
      }
      return null;
    })
    .filter((item): item is Alternative => item !== null);
};

export default function Home() {
  const [mode, setMode] = useState<ScanMode>("food"), [cameraOn, setCameraOn] = useState(false), [entered, setEntered] = useState(false), [facing, setFacing] = useState<"environment" | "user">("environment");
  const [loading, setLoading] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [cameraError, setCameraError] = useState(""), [helpOpen, setHelpOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [torchOn, setTorchOn] = useState(false), [torchSupported, setTorchSupported] = useState(false);
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

  const enrichBarcode = useCallback(async (code: string) => {
    try {
      const response = await fetch("/api/barcode/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI enrichment failed.");
      setResult((prev) => {
        if (!prev) return null;
        const alternatives = normalizeAlternatives(data.alternatives);
        return {
          ...prev,
          score: typeof data.score === "number" ? data.score : prev.score,
          grade: typeof data.grade === "string" ? data.grade : prev.grade,
          summary: typeof data.summary === "string" ? data.summary : prev.summary,
          highlights: Array.isArray(data.highlights) && data.highlights.length ? data.highlights : prev.highlights,
          concerns: Array.isArray(data.concerns) ? data.concerns : prev.concerns,
          alternatives: alternatives.length ? alternatives : prev.alternatives,
          caution: typeof data.caution === "string" ? data.caution : prev.caution
        };
      });
    } catch {
      setError("Loaded product details, but AI insights are unavailable right now.");
    } finally {
      setEnriching(false);
    }
  }, []);

  const barcodeResult = useCallback(async (code: string) => {
    stopCamera();
    setCameraOn(false);
    setLoading(true);
    setError("");
    setEnriching(false);
    try {
      const r = await fetch(`/api/barcode?code=${encodeURIComponent(code)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResult({ ...data, alternatives: normalizeAlternatives(data.alternatives) });
      setEnriching(true);
      void enrichBarcode(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn’t look up that barcode.");
    } finally {
      setLoading(false);
    }
  }, [enrichBarcode, stopCamera]);

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
      timeoutId = window.setTimeout(tick, 150);
    };
    tick();
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [mode, cameraOn, cameraReady, barcodeResult]);
  useEffect(() => () => stopCamera(), [stopCamera]);
  const analyze = async (image: string) => {
    setLoading(true); setError(""); setEnriching(false);
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // The photo the user just took/picked doubles as the result header image — no extra round trip needed.
      setResult({ ...data, image: data.image || image, alternatives: normalizeAlternatives(data.alternatives) });
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
  const scanAgain = () => { setResult(null); setError(""); setCameraError(""); setEnriching(false); setCameraOn(true); };
  const grade = result?.grade?.toLowerCase() || "a";
  const displayNumber = (value: number | undefined, suffix = "") => Number.isFinite(value) ? `${value}${suffix}` : "—";
  if (!entered) return <main className="home-screen"><header><div className="wordmark"><span><Leaf size={17} fill="currentColor" /></span>NutriLens</div><button className="help" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></button></header><div className="home-copy"><p><Sparkles size={13} /> SMART FOOD SCANNER</p><h1>Know your<br /><i>next bite.</i></h1><span>Food scores made simple.</span></div><div className="home-card"><div className="home-bowl">🥑<b>🥕</b><i>🍅</i></div><div><strong>Scan food</strong><span>Photo or barcode</span></div><em>01</em></div><SwipeEnter onComplete={() => { setEntered(true); setCameraOn(true); }} />{helpOpen && <Help onClose={() => setHelpOpen(false)} />}</main>;
  return <main className="app-shell"><section className={`camera-screen mode-${mode} ${cameraReady ? "camera-active" : ""}`}><video ref={video} muted playsInline className="camera-feed" /><div className="camera-shade" />
    <header><div className="wordmark"><span><Leaf size={17} fill="currentColor" /></span>NutriLens</div><div className="header-actions">{torchSupported && <button className={`torch ${torchOn ? "on" : ""}`} onClick={toggleTorch} aria-label="Toggle flash"><Flashlight size={18} /></button>}<button className="help" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></button></div></header>
    <div className="top-copy"><h1>{mode === "food" ? "Tap to scan food" : "Hold barcode in frame"}</h1></div>
    <div className={`focus-frame ${mode === "barcode" ? "barcode-frame" : ""}`}><i /><i /><i /><i />{mode === "barcode" && <div className="scan-beam" />}</div>{!cameraReady && !cameraError && <div className="camera-empty"><div className="food-glow">🥗</div><p>Point, scan, understand.</p></div>}{cameraError && <div className="camera-error">{cameraError}</div>}
    <div className="bottom-panel"><div className="mode-switch"><button className={mode === "food" ? "selected" : ""} onClick={() => changeMode("food")}><Camera size={17} /> Food</button><button className={mode === "barcode" ? "selected" : ""} onClick={() => changeMode("barcode")}><Barcode size={18} /> Barcode</button></div><div className="scan-actions"><button className="gallery" onClick={() => imageInput.current?.click()} aria-label="Choose photo"><ImagePlus size={22} /></button><button className="shutter" onClick={() => mode === "food" && takeFoodScan()} aria-label="Scan"><span>{mode === "barcode" ? <ScanLine size={31} /> : <Camera size={30} />}</span></button><button className="flip" onClick={() => { setFacing(v => v === "environment" ? "user" : "environment"); }} aria-label="Switch camera"><SwitchCamera size={22} /></button></div></div>
  </section><input ref={imageInput} type="file" accept="image/*" capture="environment" hidden onChange={e => file(e.target.files?.[0])} />
  {loading && <div className="scan-loading-overlay"><div className="scan-loading-card"><div className="pulse-bars"><i /><i /><i /><i /><i /></div><h3>{mode === "food" ? "Scanning your photo" : "Looking up nutrition"}</h3><p>{mode === "food" ? "Identifying the food and estimating nutrition…" : "Matching this barcode to nutrition facts…"}</p></div></div>}
  {!loading && (result || error) && <div className="result-sheet"><div className="sheet-card"><button className="close-sheet" onClick={scanAgain}><X size={20} /></button>{error && !result && <div className="scan-state"><Info size={37} /><h2>That didn’t scan</h2><p>{error}</p><button className="retry" onClick={scanAgain}>Try again</button></div>}{result && <div className="result-content"><div className="result-heading"><img className="result-photo" src={result.image || fallbackFoodImage(result.name)} alt={result.name} onError={event => { (event.currentTarget as HTMLImageElement).src = fallbackFoodImage(result.name); }} /><div className="result-title"><p>{result.category || "FOOD"}{result.meta ? ` · ${result.meta}` : ""}</p><h2>{result.name}</h2><span>{result.summary}</span></div><div className={`score-ring grade-${grade}`}><b>{displayScore}</b><small>/ 100</small><em>{result.grade}</em></div></div><div className="nutrition-row"><div><b>{displayNumber(result.calories)}</b><span>Calories</span></div><div><b>{displayNumber(result.protein, "g")}</b><span>Protein</span></div><div><b>{displayNumber(result.carbs, "g")}</b><span>Carbs</span></div><div><b>{displayNumber(result.fat, "g")}</b><span>Fat</span></div>{result.facts?.map((fact, i) => <div key={`${fact.label}-${i}`}><b>{fact.value}</b><span>{fact.label}</span></div>)}</div>{enriching && <div className="ai-status"><LoaderCircle className="spin" size={16} /><span>Loading Gemini health insights…</span></div>}{(result.highlights?.length || result.concerns?.length || result.alternatives?.length) ? <div className="ai-insights">{result.highlights?.length ? <div className="insights">{result.highlights.map((item, i) => <p key={i}><i>✓</i>{item}</p>)}</div> : null}{result.concerns?.length ? <div className="concerns"><strong><AlertTriangle size={16} /> Watch for</strong>{result.concerns.map((item, i) => <p key={i}>{item}</p>)}</div> : null}{result.alternatives?.length ? <div className="alternatives"><strong>Better swaps</strong><div className="alternatives-grid">{result.alternatives.map((item, i) => <article key={`${item.name}-${i}`}><img src={item.image || fallbackFoodImage(item.name)} alt={item.name} loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).src = fallbackFoodImage(item.name); }} /><span>{item.name}</span></article>)}</div></div> : null}</div> : null}<p className="note">{result.caution}</p>{error && <p className="note">{error}</p>}<button className="retry wide" onClick={scanAgain}>Scan another food</button></div>}</div></div>}{helpOpen && <Help onClose={() => setHelpOpen(false)} />}</main>;
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
  const THUMB = 58;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (completed) return;
    const track = trackRef.current;
    if (!track) return;
    maxXRef.current = Math.max(0, track.clientWidth - THUMB - 8);
    startXRef.current = e.clientX - dragX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragX(Math.min(maxXRef.current, Math.max(0, e.clientX - startXRef.current)));
  };
  const release = () => {
    if (!dragging) return;
    setDragging(false);
    if (maxXRef.current > 0 && dragX >= maxXRef.current * 0.7) {
      setCompleted(true);
      setDragX(maxXRef.current);
      window.setTimeout(onComplete, 260);
    } else {
      setDragX(0);
    }
  };
  const progress = maxXRef.current > 0 ? dragX / maxXRef.current : 0;

  return <div className={`swipe-enter${completed ? " completed" : ""}`} ref={trackRef}>
    <div className="swipe-enter-fill" style={{ width: `${dragX + THUMB + 8}px` }} />
    <span className="swipe-enter-label" style={{ opacity: Math.max(0, 1 - progress * 1.6) }}>Swipe to scan</span>
    {!completed && <span className="swipe-enter-hint"><ChevronRight size={16} /><ChevronRight size={16} /></span>}
    <div className="swipe-enter-thumb" style={{ transform: `translateX(${dragX}px)`, transition: dragging ? "none" : "transform .32s cubic-bezier(.2,.8,.2,1)" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={release} onPointerCancel={release}>
      <Camera size={22} />
    </div>
  </div>;
}

function Help({ onClose }: { onClose: () => void }) {
  return <div className="help-backdrop" onClick={onClose}><section className="help-card" onClick={event => event.stopPropagation()}><button onClick={onClose}><X size={19} /></button><Leaf size={24} fill="currentColor" /><h2>Quick scan guide</h2><p><b>Food:</b> center your meal, then tap the large scan button.</p><p><b>Barcode:</b> switch modes and hold the code inside the frame—it scans automatically.</p><p className="help-note">Scores are helpful estimates, not medical advice.</p></section></div>;
}
