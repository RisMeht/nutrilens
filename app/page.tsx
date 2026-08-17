"use client";

import { readBarcodes, prepareZXingModule, type ReaderOptions } from "zxing-wasm/reader";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Aperture, ArrowLeft, ArrowRight, ArrowUp, Barcode, Camera, ChevronRight, CircleHelp, Flashlight, History as HistoryIcon, ImagePlus, Info, Leaf, LoaderCircle, MessageCircle, ScanLine, Search, Sparkles, SwitchCamera, Trash2, TrendingUp, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

// The Shape Detection API's BarcodeDetector isn't in TypeScript's DOM lib yet — minimal shape
// for the one method/fields actually used (native detect() call + its bounding box/rawValue).
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string; boundingBox: { x: number; y: number; width: number; height: number } }>> };

type Alternative = { name: string; image?: string; code?: string; grade?: string };
type NutrientRange = { bucket: "low" | "moderate" | "high"; positionPct: number; good: boolean; bad: boolean; highIsGood: boolean };
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
        const alt = item as { name: string; image?: unknown; code?: unknown; grade?: unknown };
        return {
          name: alt.name,
          image: typeof alt.image === "string" && alt.image ? alt.image : fallbackFoodImage(alt.name),
          code: typeof alt.code === "string" ? alt.code : undefined,
          grade: typeof alt.grade === "string" && /^[A-E]$/.test(alt.grade) ? alt.grade : undefined
        };
      }
      return null;
    })
    .filter((item): item is Alternative => item !== null);
};

// Used everywhere a barcode gets decoded from a still canvas: the live scan-loop fallback (for
// browsers without native BarcodeDetector) and the food-photo auto-detect below. zxing-wasm is
// a WebAssembly build of the actual zxing-cpp engine — the real, actively-developed C++ library
// most serious barcode readers are built on — rather than zxing-js's pure-JS reimplementation,
// which independent benchmarks put meaningfully behind it on both speed and read accuracy.
// "AllRetail" covers exactly the barcode families found on packaged food (EAN/UPC/etc), so it's
// not wasting time trying formats that will never appear on a grocery product.
const RETAIL_BARCODE_OPTIONS: ReaderOptions = { tryHarder: true, formats: ["AllRetail"], maxNumberOfSymbols: 1 };
// Kicks off the (network-fetched, then cached) WASM module load as soon as the app starts
// rather than waiting for the first decode attempt, so barcode mode's first scan isn't stuck
// behind a cold module-load delay on top of everything else.
prepareZXingModule({ fireImmediately: true });
const readBarcodeFromCanvas = async (canvas: HTMLCanvasElement): Promise<string | null> => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readBarcodes(imageData, RETAIL_BARCODE_OPTIONS);
    return results[0]?.text || null;
  } catch { return null; }
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
    // score/grade are deliberately NOT taken from enrich — they're always the same
    // deterministic function of nutrients_per_100g base already computed, so this result's
    // grade can never disagree with what a Search/Top/Better-swaps tile already showed for it.
    merged = {
      ...base,
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
const ONBOARDED_KEY = "viva-onboarded-v1";
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

// A plain <img> gives no feedback while its (often slow, external) source is still loading —
// it's just blank space until it either pops in or silently fails. This shows a small spinner
// in its place until the image actually finishes loading, and swaps to the generated fallback
// on error rather than leaving a broken-image icon. Renders as siblings (no wrapping element)
// so it drops into whatever already-positioned container each call site already has.
function Thumb({ src, fallback, alt = "", eager = false }: { src: string; fallback: string; alt?: string; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState(src);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => { setCurrent(src); setLoaded(false); }, [src]);
  // If the browser already had this image cached, the load event can fire before this effect's
  // listener is attached (or synchronously during the src assignment), so onLoad alone misses
  // it — that's what left the spinner stuck forever on an already-loaded photo. Checking
  // .complete right after paint catches that case.
  useEffect(() => { if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setLoaded(true); }, [current]);
  // Deliberately NOT using loading="lazy" here (even off-screen/below-the-fold): native lazy
  // loading's "is this near the viewport" heuristic doesn't reliably re-run right after these
  // tiles mount inside a scrollable sheet/grid mid-transition, so the fetch would just never
  // start until an actual scroll/layout event forced the browser to recheck — exactly the
  // "images don't load until I scroll down and back up" bug. Every image here is core content
  // the grid/result is actively showing, not a long list worth deferring, so eager + async
  // decode + high priority just starts the fetch immediately every time instead.
  return <>
    {!loaded && <span className="thumb-spinner"><LoaderCircle className="spin" size={16} /></span>}
    <img ref={imgRef} src={current} alt={alt} loading="eager" decoding="async" fetchPriority={eager ? "high" : "auto"} onLoad={() => setLoaded(true)} onError={() => setCurrent(fallback)} />
  </>;
}

export default function Home() {
  const [mode, setMode] = useState<ScanMode>("food"), [cameraOn, setCameraOn] = useState(false), [entered, setEntered] = useState(false), [facing, setFacing] = useState<"environment" | "user">("environment");
  const [loading, setLoading] = useState(false), [result, setResult] = useState<Result | null>(null), [error, setError] = useState(""), [cameraError, setCameraError] = useState(""), [helpOpen, setHelpOpen] = useState(false);
  // Shown automatically exactly once, on this device's first-ever open — never again after
  // that (including after a force-quit/crash/reinstall-of-the-same-browser-storage), tracked by
  // a plain localStorage flag rather than anything session-based. Also replayable any time via
  // the Help popup's "Replay tutorial" button, which opens it without touching that flag.
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem(ONBOARDED_KEY)) setOnboardingOpen(true); } catch { /* storage unavailable — just skip the tutorial rather than block the app */ } }, []);
  const closeOnboarding = () => { try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch { /* best-effort */ } setOnboardingOpen(false); };
  // "pulse" = the brief one-shot beam right after a live shutter capture; "processing" = the
  // spinner for the remainder of the AI request (also the immediate state for a gallery pick,
  // which skips the pulse entirely — see file()/takeFoodScan() below).
  const [captureState, setCaptureState] = useState<"idle" | "pulse" | "processing">("idle");
  const [sheetClosing, setSheetClosing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [torchOn, setTorchOn] = useState(false), [torchSupported, setTorchSupported] = useState(false);
  // Live bounding box drawn around a detected-but-not-yet-confirmed barcode, in display pixels
  // relative to the camera-screen container — only populated on browsers with the native
  // BarcodeDetector API (see the decode-loop effect below), since that's the only path that
  // gets a real bounding box essentially for free.
  const [barcodeBox, setBarcodeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [homeLeaving, setHomeLeaving] = useState(false);
  const [additiveDetail, setAdditiveDetail] = useState<AdditiveFlag | null>(null);
  const [nutrientDetail, setNutrientDetail] = useState<NutritionFact | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("scan");
  const [searchSeed, setSearchSeed] = useState("");
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]), [clearArmed, setClearArmed] = useState(false);
  const [altSelecting, setAltSelecting] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<HistoryEntry | null>(null);
  useEffect(() => { setLastScan(loadHistory()[0] || null); }, []);
  const openTab = (next: Tab) => { if (next === "history") { setHistoryList(loadHistory()); setClearArmed(false); } setTab(next); };
  const removeHistoryEntry = (id: string) => { const next = loadHistory().filter(e => e.historyId !== id); persistHistory(next); setHistoryList(next); };
  const clearAllHistory = () => {
    if (!clearArmed) { setClearArmed(true); window.setTimeout(() => setClearArmed(false), 3000); return; }
    persistHistory([]); setHistoryList([]); setClearArmed(false);
  };
  // Opening a result no longer forces the tab back to "scan" — the sheet now layers above
  // whichever tab is currently showing (History/Recs/Top/Search), so closing it (the X button)
  // can return to that same page instead of always bouncing to the scan screen.
  const viewHistoryEntry = (entry: HistoryEntry) => { setResult(entry); setError(""); };
  // Computed here (rather than just before the JSX return, where it previously lived) so the
  // tab-bar indicator effect below — which needs to know when the bar remounts after the
  // result sheet closes — can depend on it.
  const resultSheetOpen = !loading && !!(result || error);

  // Sliding active-tab/active-mode highlights: rather than a CSS-only approach (unreliable once
  // button widths vary with content/breakpoint), the actual pixel position of the active button
  // is measured via its own offsetLeft/offsetWidth and applied to a separate absolutely
  // positioned pill that's free to transition smoothly between positions.
  const tabBarRef = useRef<HTMLElement>(null);
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0, ready: false });
  useEffect(() => {
    const measure = () => {
      const nav = tabBarRef.current;
      const btn = nav?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (btn) setTabIndicator({ left: btn.offsetLeft, width: btn.offsetWidth, ready: true });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // `entered` is included even though it's not read inside: the nav only actually exists in
    // the DOM once the camera screen mounts (after the home screen's entrance), so without it
    // this effect's first real measurement — right when the ref goes from null to attached —
    // would never fire (tab/resultSheetOpen can both stay unchanged across that transition).
  }, [tab, resultSheetOpen, entered]);

  const modeSwitchRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [modeIndicator, setModeIndicator] = useState({ left: 0, width: 0, ready: false });
  useEffect(() => {
    const measure = () => {
      const el = modeSwitchRef.current;
      const btn = el?.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
      if (btn) setModeIndicator({ left: btn.offsetLeft, width: btn.offsetWidth, ready: true });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // Same reasoning as the tab-bar indicator above: `entered` gates when this ref first
    // attaches, so it has to be a dependency even though it isn't read in the body.
  }, [mode, entered]);
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
      // continuous autofocus (ideal, not required — browsers ignore an unrecognized "ideal"
      // constraint rather than rejecting the whole request) matters a lot for barcode reading
      // specifically: without it, a lot of phones default to a fixed/single-shot focus point
      // that just isn't focused at typical barcode distance, which is exactly what "have to
      // move it around so much before it catches" looks like from the outside.
      const constraints = { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: { ideal: "continuous" } } as MediaTrackConstraints, audio: false };
      const media = await navigator.mediaDevices.getUserMedia(constraints);
      if (cancelled) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; video.current!.srcObject = media; await video.current!.play();
      if (cancelled) return;
      setCameraReady(true);
      const track = media.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }) | undefined;
      setTorchSupported(!!caps?.torch);
      // Belt-and-suspenders: some browsers only honor focusMode via applyConstraints after the
      // track exists, not in the initial getUserMedia request, and only expose it under
      // `advanced`. Silently ignored on devices/browsers that don't support it at all (same
      // pattern as the torch toggle above).
      if (caps?.focusMode?.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      }
    } catch { if (!cancelled) setCameraError("Camera access is off. Click the camera icon in your browser’s address bar, allow it, then try again."); } };
    open();
    return () => { cancelled = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setCameraReady(false); setTorchSupported(false); setTorchOn(false); };
  }, [cameraOn, facing]);
  // Attaches/detaches the barcode decode loop to the already-live video element — no camera
  // restart involved, so flipping between Food and Barcode is instant and glitch-free.
  //
  // Prefers the browser's native BarcodeDetector (Shape Detection API) when available — on
  // Chromium (Chrome/Edge, most Android WebViews) it's actually backed by Google's ML Kit under
  // the hood, the same barcode engine real native apps use, so this path is about as good as a
  // web page can possibly get. It runs against the live video element directly (no manual
  // canvas draw needed), is hardware accelerated, reads reliably from much further away/at more
  // of an angle than a JS decoder ever could, and hands back a real bounding box for free, which
  // drives the live scan-box overlay.
  //
  // Safari/iOS has no native barcode API at all (an Apple platform gap, not something fixable
  // here) and Firefox doesn't implement this API either, so both fall back to a WASM-based
  // decode loop below — using zxing-wasm (the real zxing-cpp engine compiled to WebAssembly)
  // rather than a pure-JS decoder, since that's a meaningful, independently-benchmarked step up
  // in both speed and read accuracy over plain JS. It can't produce a bounding box cheaply
  // enough to justify trying, but does get the same tighter frame-crop treatment.
  useEffect(() => {
    if (mode !== "barcode" || !cameraOn || !cameraReady || !video.current) { setBarcodeBox(null); return; }
    let cancelled = false, timeoutId = 0, raf = 0;
    const NativeDetector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    // A browser can advertise the constructor while still rejecting one of the requested
    // formats (some implementations validate against their own supported-format list and throw
    // synchronously) — falls through to the zxing path below rather than leaving barcode
    // scanning broken entirely if that happens.
    const detector = NativeDetector ? (() => { try { return new NativeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"] }); } catch { return null; } })() : null;

    if (detector) {
      const scan = () => {
        if (cancelled || !video.current) return;
        detector.detect(video.current).then((codes) => {
          if (cancelled) return;
          if (codes.length) {
            const hit = codes[0];
            const el = video.current;
            if (el && el.videoWidth) {
              // Maps the barcode's bounding box from the video's own pixel space into the
              // element's displayed CSS size — needed because .camera-feed uses
              // object-fit:cover, which scales+crops the intrinsic frame rather than showing
              // it 1:1, so raw video-pixel coordinates would otherwise land in the wrong spot.
              const rect = el.getBoundingClientRect();
              const scale = Math.max(rect.width / el.videoWidth, rect.height / el.videoHeight);
              const offsetX = (rect.width - el.videoWidth * scale) / 2;
              const offsetY = (rect.height - el.videoHeight * scale) / 2;
              setBarcodeBox({
                left: hit.boundingBox.x * scale + offsetX,
                top: hit.boundingBox.y * scale + offsetY,
                width: hit.boundingBox.width * scale,
                height: hit.boundingBox.height * scale
              });
            }
            cancelled = true;
            barcodeResult(hit.rawValue);
            return;
          }
          setBarcodeBox(null);
          raf = requestAnimationFrame(scan);
        }).catch(() => { if (!cancelled) raf = requestAnimationFrame(scan); });
      };
      timeoutId = window.setTimeout(() => { raf = requestAnimationFrame(scan); }, 620);
      return () => { cancelled = true; window.clearTimeout(timeoutId); cancelAnimationFrame(raf); setBarcodeBox(null); };
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const SCAN_WIDTH = 900;
    const tick = async () => {
      if (cancelled) return;
      const el = video.current;
      const frameEl = frameRef.current;
      if (el && ctx && el.videoWidth && frameEl) {
        // Crop to the visible on-screen barcode frame, mapped back into the video's own pixel
        // space (inverting the same object-fit:cover math used for the live box overlay above),
        // instead of downscaling the entire camera view. Previously a barcode that only filled
        // a small part of the frame got downscaled along with all the irrelevant background
        // around it, throwing away exactly the resolution needed to read it — this way the
        // frame's contents alone fill the full analyzed image, which is a much bigger, easier
        // target without needing to physically move the phone closer.
        const videoRect = el.getBoundingClientRect();
        const frameRect = frameEl.getBoundingClientRect();
        const scale = Math.max(videoRect.width / el.videoWidth, videoRect.height / el.videoHeight);
        const offsetX = (videoRect.width - el.videoWidth * scale) / 2;
        const offsetY = (videoRect.height - el.videoHeight * scale) / 2;
        const sx = Math.max(0, (frameRect.left - videoRect.left - offsetX) / scale);
        const sy = Math.max(0, (frameRect.top - videoRect.top - offsetY) / scale);
        const sw = Math.min(el.videoWidth - sx, frameRect.width / scale);
        const sh = Math.min(el.videoHeight - sy, frameRect.height / scale);
        if (sw > 0 && sh > 0) {
          canvas.width = SCAN_WIDTH;
          canvas.height = Math.round(SCAN_WIDTH * (sh / sw));
          ctx.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          const code = await readBarcodeFromCanvas(canvas);
          if (code && !cancelled) { cancelled = true; barcodeResult(code); return; }
        }
      }
      if (!cancelled) timeoutId = window.setTimeout(tick, 60);
    };
    // Waits out the mode-switch CSS transition before the decode loop starts competing for
    // the main thread — starting it immediately was still enough to make the transition (which
    // plays over roughly this same window) stutter, even at a downscaled resolution. The corner
    // brackets' own transform transition runs .55s (see .focus-frame i in overrides.css); 140ms
    // was landing well inside that window and still visibly janked the food->barcode direction
    // specifically (barcode->food has no decode loop competing for the thread, so it was always
    // smooth) — pushed past the full transition instead.
    timeoutId = window.setTimeout(tick, 620);
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
      setCaptureState("idle");
    }
  };
  // A live shutter capture gets one brief beam pulse (rather than looping it for the whole AI
  // request, which used to make people keep the phone held up pointed at the food the entire
  // time) before switching to the same loading spinner barcode mode already uses. A
  // gallery-picked photo has no "aim the camera" moment to justify a beam at all, so it jumps
  // straight to the spinner.
  const takeFoodScan = async () => {
    const source = video.current;
    if (!source || !source.videoWidth) return imageInput.current?.click();
    const c = document.createElement("canvas"), ratio = Math.min(1, 1400 / source.videoWidth);
    c.width = Math.round(source.videoWidth * ratio); c.height = Math.round(source.videoHeight * ratio);
    c.getContext("2d")?.drawImage(source, 0, 0, c.width, c.height);
    setCaptureState("pulse");
    window.setTimeout(() => setCaptureState(s => (s === "pulse" ? "processing" : s)), 1700);
    // If the product's own barcode happens to be visible in the food photo, use that instead of
    // the AI's best guess from the picture — same per-100g Open Food Facts data as scanning the
    // barcode directly, so it's strictly more accurate whenever it's available.
    const code = await readBarcodeFromCanvas(c);
    if (code) { barcodeResult(code); return; }
    analyze(c.toDataURL("image/jpeg", .8));
  };
  const file = (f?: File) => {
    if (!f) return;
    setCaptureState("processing");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Same barcode-first check as a live shutter capture — a gallery photo can show the
      // product's barcode just as well as the camera can.
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas"), ratio = Math.min(1, 1400 / img.width);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const code = await readBarcodeFromCanvas(canvas);
        if (code) { barcodeResult(code); return; }
        analyze(dataUrl);
      };
      img.onerror = () => analyze(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
  };
  const changeMode = (next: ScanMode) => {
    if (next === mode) return;
    setMode(next);
    // The live stream carries over across modes untouched (see the camera effect above).
    // Only retry acquiring it here if it never actually came up (e.g. permission was denied).
    if (cameraOn && !cameraReady) { setCameraError(""); setCameraOn(false); requestAnimationFrame(() => setCameraOn(true)); }
  };
  // Closing the X on a result no longer always returns to the Scan tab — a result opened
  // from History/Recs/Top/Search should close back onto that same page. Only actually resume
  // the camera if Scan is the tab already showing; otherwise the camera stays off/backgrounded
  // exactly as it was before this result was opened.
  const closeResult = () => {
    setSheetClosing(true);
    setNutrientDetail(null);
    setAdditiveDetail(null);
    if (tab === "scan") setCameraOn(true);
    window.setTimeout(() => { setResult(null); setError(""); setCameraError(""); setSheetClosing(false); }, 220);
  };
  // "Scan another food" (and the error state's "Try again") explicitly want the scan screen,
  // regardless of which tab the result happened to be opened from.
  const scanAnotherFood = () => {
    setSheetClosing(true);
    setNutrientDetail(null);
    setAdditiveDetail(null);
    setTab("scan");
    setCameraOn(true); // start reopening the camera immediately, in parallel with the sheet's own closing animation
    window.setTimeout(() => { setResult(null); setError(""); setCameraError(""); setSheetClosing(false); }, 220);
  };
  // Tapping a Better Swap opens ITS full result in place of the one currently shown, the same
  // lookup+merge used by an actual barcode scan — mirrors Recs' "good" swap tap. Swaps without a
  // matched OFF barcode (AI-only name suggestions) fall back to searching for that name instead.
  const openAlternative = async (item: Alternative) => {
    if (!item.code) { setTab("search"); setSearchSeed(item.name); return; }
    setAltSelecting(item.code);
    try {
      const r = await resolveBarcodeResult(item.code);
      setResult(r);
      setError("");
      addHistoryEntry(r).catch(() => {});
    } catch {
      /* keep showing the current result — the tap just silently didn't pan out */
    } finally {
      setAltSelecting(null);
    }
  };
  const grade = result?.grade?.toLowerCase() || "a";
  // A poorly-rated item's biggest concerns are the most important thing to see first — pulled
  // up above the macro/nutrient breakdown instead of waiting at the bottom of the page. A
  // well-rated item keeps the friendlier default order (highlights first, concerns after).
  const isPoor = !!result && (result.grade === "D" || result.grade === "E" || (typeof result.score === "number" && result.score < 45));
  const concernsBlock = result?.concerns?.length ? <div className="concerns"><strong><AlertTriangle size={16} /> Watch for</strong>{result.concerns.map((item, i) => <p key={i}>{item}</p>)}</div> : null;
  // Heading for the swap grid says something different depending on how badly the scanned item
  // itself scored — "Good swaps"/"Recommended swaps" for a poor item (there's real upside to
  // switching), "Alternate swaps" for a middling one, "Better swaps" only when the item is
  // already decent and these are marginal improvements on it.
  const swapsHeading = result?.grade === "E" ? "Good swaps" : result?.grade === "D" ? "Recommended swaps" : result?.grade === "C" ? "Alternate swaps" : "Better swaps";
  // .result-content is a single, long-lived DOM node whose content just gets replaced on every
  // new scan/swap/history-open — the browser has no reason to reset its own scroll position on
  // that, so tapping a Better Swap while scrolled down on the current product used to leave the
  // NEW product's page opened mid-scroll instead of at the top.
  const resultContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { resultContentRef.current?.scrollTo({ top: 0 }); }, [result]);
  // Same canonical-grade self-correction as the browse/top grids (see ProductGrid), applied to
  // Better Swaps specifically since those grades come from the same search-index data.
  const [swapGradeFixes, setSwapGradeFixes] = useState<Record<string, string | null>>({});
  useEffect(() => {
    setSwapGradeFixes({});
    const codes = result?.alternatives?.map(a => a.code).filter((c): c is string => !!c) || [];
    if (!codes.length) return;
    let cancelled = false;
    codes.forEach((code) => {
      fetch(`/api/grade?code=${encodeURIComponent(code)}`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setSwapGradeFixes(prev => ({ ...prev, [code]: typeof d.grade === "string" ? d.grade : null })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [result]);
  if (!entered) return <main className={`home-screen${homeLeaving ? " leaving" : ""}`}>
    <div className="home-topbar"><button className="help" onClick={() => setHelpOpen(true)} aria-label="Help"><CircleHelp size={20} /></button></div>
    <div className="home-main">
      <div className="home-copy"><img className="home-logo" src="/logo" alt="" /><h1>Viva</h1><span>Know what you eat.</span></div>
      <div className="home-hero">
        <div className="home-hero-emoji">🥗</div>
        {lastScan ? <div className="home-hero-chip"><span className={`home-hero-chip-ring grade-${(lastScan.grade || "a").toLowerCase()}`}>{lastScan.grade}</span><div className="home-hero-chip-text"><b>{lastScan.score}</b><small>Last scan</small></div></div>
          : <div className="home-hero-chip"><span className="home-hero-chip-ring">🍃</span><div className="home-hero-chip-text"><b>Scan</b><small>to see your score</small></div></div>}
      </div>
    </div>
    <SwipeEnter onComplete={() => { setHomeLeaving(true); window.setTimeout(() => { setEntered(true); setCameraOn(true); }, 340); }} />
    {helpOpen && <Help onClose={() => setHelpOpen(false)} onTutorial={() => { setHelpOpen(false); setOnboardingOpen(true); }} />}
    {onboardingOpen && <Onboarding onClose={closeOnboarding} />}
  </main>;
  return <main className="app-shell"><section className={`camera-screen mode-${mode} ${cameraReady ? "camera-active" : ""}`}><video ref={video} muted playsInline className="camera-feed" /><div className="camera-shade" />
    <header><div className="wordmark"><img className="wordmark-icon" src="/logo" alt="" />Viva</div><div className="header-actions">{torchSupported && <button className={`torch ${torchOn ? "on" : ""}`} onClick={toggleTorch} aria-label="Toggle flash"><Flashlight size={18} /></button>}<button className="help" onClick={() => setHelpOpen(true)} aria-label="Help"><CircleHelp size={20} /></button></div></header>
    <div className="top-copy"><h1 key={mode}>{mode === "food" ? "Tap to scan food" : "Hold barcode in frame"}</h1></div>
    <div ref={frameRef} className={`focus-frame ${mode === "barcode" ? "barcode-frame" : ""}`}><i /><i /><i /><i />{mode === "barcode" && !loading && cameraReady && <div className="scan-beam" />}{mode === "food" && loading && captureState === "pulse" && <div className="scan-beam scan-beam-once" />}{loading && (mode === "barcode" || (mode === "food" && captureState !== "pulse")) && <div className="scan-progress"><LoaderCircle className="spin scan-progress-icon" size={56} /></div>}</div>{mode === "barcode" && !loading && barcodeBox && <div className="barcode-box" style={{ left: barcodeBox.left, top: barcodeBox.top, width: barcodeBox.width, height: barcodeBox.height }} />}{!cameraReady && !cameraError && <div className="camera-empty"><div className="food-glow">🥗</div><p>Point, scan, understand.</p></div>}{cameraError && <div className="camera-error">{cameraError}</div>}
    <div className="bottom-panel"><div className="mode-switch" ref={modeSwitchRef}>{modeIndicator.ready && <div className="mode-switch-indicator" style={{ left: modeIndicator.left, width: modeIndicator.width }} />}<button data-mode="food" className={mode === "food" ? "selected" : ""} onClick={() => changeMode("food")}><Camera size={17} /> Food</button><button data-mode="barcode" className={mode === "barcode" ? "selected" : ""} onClick={() => changeMode("barcode")}><Barcode size={18} /> Barcode</button></div><div className="scan-actions"><button className="gallery" onClick={() => imageInput.current?.click()} aria-label="Choose photo"><ImagePlus size={22} /></button><button className="shutter" onClick={() => mode === "food" && takeFoodScan()} aria-label="Scan"><span key={mode}>{mode === "barcode" ? <ScanLine size={31} /> : <Camera size={30} />}</span></button><button className="flip" onClick={() => { setFacing(v => v === "environment" ? "user" : "environment"); }} aria-label="Switch camera"><SwitchCamera size={22} /></button></div></div>
  </section><input ref={imageInput} type="file" accept="image/*" hidden onChange={e => file(e.target.files?.[0])} />
  {!loading && (result || error) && <div className={`result-sheet${sheetClosing ? " closing" : ""}`}><div className="sheet-card"><button className="close-sheet" onClick={closeResult}><X size={20} /></button>{result && <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Ask about this scan"><MessageCircle size={22} /></button>}{error && !result &&<div className="scan-state"><Info size={37} /><h2>That didn’t scan</h2><p>{error}</p><button className="retry" onClick={scanAnotherFood}>Try again</button></div>}{result && <div className="result-content" ref={resultContentRef}><div className="result-photo-wrap"><div className="result-photo-banner"><Thumb src={result.image || fallbackFoodImage(result.name)} fallback={fallbackFoodImage(result.name)} alt={result.name} eager /></div><div className={`score-ring grade-${grade}`}><b>{displayScore}</b><small>/ 100</small><em>{result.grade}</em></div></div><div className="result-title-block"><p>{result.category || "FOOD"}{result.meta ? ` · ${result.meta}` : ""}</p><h2>{result.name}</h2><span>{result.summary}</span></div>{isPoor && concernsBlock}<div className="nutrition-row">{result.facts?.map((fact, i) => <button type="button" key={`${fact.label}-${i}`} onClick={() => setNutrientDetail(fact)}><b>{fact.value}</b><span>{fact.label}</span>{fact.range && <i className={`range-bar bucket-${fact.range.bucket}${fact.range.highIsGood ? " range-bar-reverse" : ""}`}><em style={{ left: `${fact.range.positionPct}%` }} /></i>}</button>)}</div>{result.breakdown && <div className="score-breakdown"><strong>Score breakdown</strong><div className="breakdown-row"><span>Nutrition quality</span><i className="breakdown-bar"><em style={{ width: `${result.breakdown.nutrition.score}%` }} /></i><b>{result.breakdown.nutrition.score}</b></div><div className="breakdown-row"><span>Additives</span><i className="breakdown-bar"><em style={{ width: `${result.breakdown.additives.applicable ? result.breakdown.additives.score : 0}%` }} /></i><b>{result.breakdown.additives.applicable ? result.breakdown.additives.score : "—"}</b></div><div className="breakdown-row"><span>Organic bonus</span><i className="breakdown-bar"><em style={{ width: result.breakdown.bonus.organic ? "100%" : "0%" }} /></i><b>{result.breakdown.bonus.organic ? "Yes" : "—"}</b></div><p className="breakdown-weights">The score above is based on nutrition alone, so it always matches what you see before opening a product. Additives and organic status are shown here for context.</p></div>}{result.breakdown?.additives.applicable && <div className="additives-section"><strong>Ingredients checked</strong>{result.breakdown.additives.items.length ? <div className="additive-list">{result.breakdown.additives.items.map((a, i) => <button key={`${a.name}-${i}`} type="button" className={`additive-flag risk-${a.risk}`} onClick={() => setAdditiveDetail(a)}><i className="risk-dot" /><div><b>{a.name}</b><span>{a.note}</span></div><ChevronRight size={16} className="additive-flag-chevron" /></button>)}</div> : <p className="additive-clear">No concerning additives detected in the ingredient list.</p>}</div>}{(result.highlights?.length || (!isPoor && result.concerns?.length) || result.alternatives?.length) ? <div className="ai-insights">{result.highlights?.length ? <div className="insights">{result.highlights.map((item, i) => <p key={i}><i>✓</i>{item}</p>)}</div> : null}{!isPoor ? concernsBlock : null}{(() => {
                    // Every tile here needs to both open a real product AND show its actual
                    // photo — a name-only AI suggestion that never resolved to a matched OFF
                    // product (no code) used to still render, tapping it just silently jumped
                    // to Search instead of opening anything, which read as a dead/broken tile.
                    const clickableAlts = (result.alternatives ?? []).filter((item) => item.code && item.image);
                    return clickableAlts.length ? <div className="alternatives"><strong>{swapsHeading}</strong><div className="alternatives-grid">{clickableAlts.map((item, i) => { const swapGrade = item.code && item.code in swapGradeFixes ? swapGradeFixes[item.code] : item.grade; return <button type="button" key={`${item.name}-${i}`} disabled={!!altSelecting} onClick={() => openAlternative(item)}><div className="alt-img-wrap"><Thumb src={item.image!} fallback={fallbackFoodImage(item.name)} alt={item.name} />{swapGrade && <em className={`swap-grade grade-${swapGrade.toLowerCase()}`}>{swapGrade}</em>}{altSelecting === item.code && <div className="browse-tile-loading"><LoaderCircle className="spin" size={20} /></div>}</div><span>{item.name}</span></button>; })}</div></div> : null;
                  })()}</div> : null}<p className="note">{result.caution}</p>{error && <p className="note">{error}</p>}<button className="retry wide" onClick={scanAnotherFood}>Scan another food</button></div>}</div></div>}{helpOpen && <Help onClose={() => setHelpOpen(false)} onTutorial={() => { setHelpOpen(false); setOnboardingOpen(true); }} />}{additiveDetail && <AdditiveDetail item={additiveDetail} onClose={() => setAdditiveDetail(null)} />}{nutrientDetail && <NutrientDetail fact={nutrientDetail} onClose={() => setNutrientDetail(null)} />}{chatOpen && result && <Chat result={result} onClose={() => setChatOpen(false)} />}{onboardingOpen && <Onboarding onClose={closeOnboarding} />}
  {tab === "history" && <History list={historyList} clearArmed={clearArmed} onClose={() => setTab("scan")} onView={viewHistoryEntry} onDelete={removeHistoryEntry} onClearAll={clearAllHistory} />}
  {tab === "recs" && <Recs onClose={() => setTab("scan")} onOpenResult={(r) => { setResult(r); setError(""); }} onSearch={(q) => { setTab("search"); setSearchSeed(q); }} />}
  {tab === "top" && <Top onClose={() => setTab("scan")} onOpenResult={(r) => { setResult(r); setError(""); addHistoryEntry(r).catch(() => {}); }} />}
  {tab === "search" && <Browse seedQuery={searchSeed} onClose={() => { setTab("scan"); setSearchSeed(""); }} onOpenResult={(r) => { setResult(r); setError(""); addHistoryEntry(r).catch(() => {}); }} />}
  {!resultSheetOpen && <nav className="tab-bar" ref={tabBarRef}>
    {tabIndicator.ready && <div className="tab-bar-indicator" style={{ left: tabIndicator.left, width: tabIndicator.width }} />}
    <button data-tab="history" className={tab === "history" ? "active" : ""} onClick={() => openTab("history")}><HistoryIcon size={19} /><span>History</span></button>
    <button data-tab="recs" className={tab === "recs" ? "active" : ""} onClick={() => openTab("recs")}><Sparkles size={19} /><span>Recs</span></button>
    <button data-tab="scan" className={tab === "scan" ? "active" : ""} onClick={() => openTab("scan")}><Aperture size={19} /><span>Scan</span></button>
    <button data-tab="top" className={tab === "top" ? "active" : ""} onClick={() => openTab("top")}><TrendingUp size={19} /><span>Top</span></button>
    <button data-tab="search" className={tab === "search" ? "active" : ""} onClick={() => openTab("search")}><Search size={19} /><span>Search</span></button>
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

// Explains what each macro/nutrient actually does and why it's (or isn't) directly scored —
// static, hand-written copy rather than an extra AI call, so tapping a nutrient is instant
// rather than triggering a network round trip for a short explanation that doesn't change
// per-product.
const NUTRIENT_INFO: Record<string, string> = {
  Calories: "Calories measure the energy this food provides. Consistently eating more than your body burns leads to weight gain over time — how much counts as \"a lot\" depends on your daily needs, but a food that's very energy-dense for its serving size is worth noticing.",
  Protein: "Protein supports muscle repair and keeps you fuller for longer. It's one of the few things Nutri-Score directly rewards — more of it, from a food that isn't otherwise unbalanced, is a genuinely good sign.",
  Carbs: "Carbohydrates are the body's primary fuel source. The total amount alone doesn't say much about quality — a whole grain and a spoonful of table sugar are both \"carbs\" but behave very differently, which is why sugar specifically (not total carbs) is what gets scored below.",
  Fat: "Fat is essential for hormone production and absorbing certain vitamins. Like carbs, the total alone doesn't indicate quality — unsaturated fats (nuts, olive oil, fish) are broadly protective, while saturated fat, scored separately below, is the type worth limiting.",
  Sugar: "Added and natural sugars both count here. Excess sugar is linked to weight gain, energy crashes, and long-term metabolic risk — it's one of the four nutrients Nutri-Score penalizes directly.",
  Sodium: "Sodium (salt), eaten in excess, is linked to high blood pressure and cardiovascular strain over time. Most people eat well above the recommended daily amount without realizing it, largely from packaged and restaurant food.",
  "Sat fat": "Saturated fat, eaten in excess, is linked to higher LDL (\"bad\") cholesterol and cardiovascular risk. Unlike total fat, this one is directly penalized by Nutri-Score.",
  Fiber: "Fiber slows digestion, feeds healthy gut bacteria, and helps you feel full — most people eat well below the recommended amount. More of it is one of the few things that can meaningfully raise a food's score."
};
const RANGE_QUALIFIER = (range: NutrientRange): string => {
  if (range.bucket === "moderate") return "This is a moderate amount for this nutrient.";
  const high = range.bucket === "high";
  if (range.highIsGood) return high ? "That's on the higher end — a good sign." : "That's on the lower end — worth boosting.";
  return high ? "That's on the higher end — worth watching." : "That's on the lower end — a good sign.";
};
function NutrientDetail({ fact, onClose }: { fact: NutritionFact; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); window.setTimeout(onClose, 200); };
  return <div className={`help-backdrop${closing ? " closing" : ""}`} onClick={close}><section className={`help-card nutrient-detail-card${closing ? " closing" : ""}`} onClick={event => event.stopPropagation()}><button onClick={close}><X size={19} /></button><span className="nutrient-detail-value">{fact.value}</span><h2>{fact.label}</h2>{fact.range && <div className="nutrient-detail-range"><i className={`range-bar bucket-${fact.range.bucket}${fact.range.highIsGood ? " range-bar-reverse" : ""}`}><em style={{ left: `${fact.range.positionPct}%` }} /></i><span className={fact.range.good ? "range-good" : fact.range.bad ? "range-bad" : ""}>{RANGE_QUALIFIER(fact.range)}</span></div>}<p>{NUTRIENT_INFO[fact.label] || ""}</p></section></div>;
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
        {list.map((entry, i) => <div key={entry.historyId} className="history-row stagger-in" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
          <button className="history-row-main" onClick={() => onView(entry)}>
            <span className="history-row-img"><Thumb src={entry.image || fallbackFoodImage(entry.name)} fallback={fallbackFoodImage(entry.name)} /></span>
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
// Open Food Facts' search index (used for the grade shown the instant this grid paints) turns
// out to genuinely disagree with its own canonical product database for a meaningful share of
// products — confirmed by direct comparison, not a rare fluke — so a grade computed purely
// from the search index can still contradict the one shown once a product is opened. Rather
// than slow the whole grid down waiting on a canonical lookup per tile before painting
// anything, each tile quietly re-checks itself against /api/grade (the same canonical source
// the full result uses) right after the grid appears, and self-corrects if the two disagreed.
function ProductGrid({ items, selecting, onSelect }: { items: BrowseItem[]; selecting: string | null; onSelect: (code: string) => void }) {
  const [gradeFixes, setGradeFixes] = useState<Record<string, string | null>>({});
  useEffect(() => {
    setGradeFixes({});
    let cancelled = false;
    items.forEach((item) => {
      fetch(`/api/grade?code=${encodeURIComponent(item.code)}`)
        .then(r => r.json())
        .then(d => { if (!cancelled) setGradeFixes(prev => ({ ...prev, [item.code]: typeof d.grade === "string" ? d.grade : null })); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [items]);

  return <div className="browse-grid">{items.map((item, i) => {
    const grade = item.code in gradeFixes ? gradeFixes[item.code] : item.grade;
    return <button key={item.code} className="browse-tile stagger-in" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} disabled={!!selecting} onClick={() => onSelect(item.code)}>
      <div className="browse-tile-img"><Thumb src={item.image || fallbackFoodImage(item.name)} fallback={fallbackFoodImage(item.name)} />{selecting === item.code && <div className="browse-tile-loading"><LoaderCircle className="spin" size={22} /></div>}</div>
      <span>{item.name}</span>
      {grade && grade !== "?" && <em className={`history-grade grade-${grade.toLowerCase()}`}>{grade}</em>}
    </button>;
  })}</div>;
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
  // Drilling into a category (and backing out of one) reuses this same full-page-content node
  // rather than remounting it, so it needs its own explicit scroll reset — otherwise leaving a
  // category scrolled halfway down and going "back" reopens the category list mid-scroll too.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [category]);

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
    <div className="full-page-content" ref={contentRef}>
      {!category && <div className="category-list">{TOP_CATEGORIES.map((c, i) => <button key={c.tag} className="category-row stagger-in" style={{ animationDelay: `${i * 30}ms` }} onClick={() => setCategory(c)}><span className="category-emoji">{c.emoji}</span><span className="category-label">{c.label}</span><ChevronRight size={18} /></button>)}</div>}
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
      // Requires a real code (so the tile actually opens a product) and image (so it's not a
      // generated placeholder) — a name-only AI suggestion that never resolved to a matched OFF
      // product used to still show up here and just silently jump to Search on tap instead.
      const good = entry.alternatives?.find((alt) => alt.code && alt.image);
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
      {pairs.length > 0 && <div className="recs-list">{pairs.map((pair, i) => <div key={`${pair.bad.historyId}-${i}`} className="recs-pair stagger-in" style={{ animationDelay: `${i * 50}ms` }}>
        <button className="recs-tile recs-bad" onClick={() => onOpenResult(pair.bad)}>
          <div className="recs-tile-img"><Thumb src={pair.bad.image || fallbackFoodImage(pair.bad.name)} fallback={fallbackFoodImage(pair.bad.name)} /><i className="recs-badge recs-badge-bad"><X size={13} /></i></div>
          <span>{pair.bad.name}</span>
        </button>
        <button className="recs-tile recs-good" disabled={!!selecting} onClick={() => openGood(pair.good)}>
          <div className="recs-tile-img"><Thumb src={pair.good.image || fallbackFoodImage(pair.good.name)} fallback={fallbackFoodImage(pair.good.name)} />{selecting === pair.good.code ? <div className="browse-tile-loading"><LoaderCircle className="spin" size={20} /></div> : <i className="recs-badge recs-badge-good">✓</i>}</div>
          <span>{pair.good.name}</span>
        </button>
      </div>)}</div>}
    </div>
  </div>;
}

type OnboardingStep = { kind: "logo" | "camera" | "barcode" | "score" | "detail"; title: string; body: string };
const ONBOARDING_STEPS: OnboardingStep[] = [
  { kind: "logo", title: "Know exactly what you're eating", body: "Scan any packaged food or meal and get an instant, honest health breakdown — no guessing, no marketing spin." },
  { kind: "camera", title: "Point and scan any food", body: "Snap a photo of a meal, snack, or ingredient label and Viva estimates its nutrition and health score in seconds." },
  { kind: "barcode", title: "Or scan the barcode", body: "Switch to Barcode mode and hold any packaged product's barcode in frame — it reads automatically and pulls real nutrition data." },
  { kind: "score", title: "A score you can trust", body: "Every item gets a 0–100 score and A–E grade from its actual nutrition — sugar, sodium, protein, and more — never influenced by marketing." },
  { kind: "detail", title: "Tap anything for more", body: "Tap any nutrient for a detailed breakdown, check flagged ingredients for their real risk level, and see better swaps when something scores low." }
];

function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const widthRef = useRef(0);
  const last = step === ONBOARDING_STEPS.length - 1;

  const close = () => { setClosing(true); window.setTimeout(onClose, 260); };
  const goTo = (next: number) => setStep(Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, next)));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    widthRef.current = trackRef.current?.clientWidth || 1;
    startXRef.current = e.clientX;
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    let delta = e.clientX - startXRef.current;
    // Rubber-band resistance at the first/last slide instead of dragging past the end into
    // nothing — a stiff wall there would feel broken, but full free travel invites overscrolling.
    if ((step === 0 && delta > 0) || (last && delta < 0)) delta *= 0.35;
    setDragX(delta);
  };
  const release = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const threshold = widthRef.current * 0.18;
    if (dragX < -threshold) goTo(step + 1);
    else if (dragX > threshold) goTo(step - 1);
    setDragX(0);
  };

  return <div className={`onboarding-backdrop${closing ? " closing" : ""}`}>
    <div className="onboarding-card">
      <button type="button" className="onboarding-skip" onClick={close}>Skip</button>
      <div
        className="onboarding-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        style={{ transform: `translateX(calc(${-step * 100}% + ${dragX}px))`, transition: dragging ? "none" : "transform .5s cubic-bezier(.22,.8,.24,1)" }}
      >
        {ONBOARDING_STEPS.map((s, i) => <div className="onboarding-slide" key={i}>
          <div className="onboarding-art">
            {s.kind === "logo" && <img src="/logo" alt="" className="onboarding-logo" />}
            {s.kind === "camera" && <div className="onboarding-icon"><Camera size={44} /></div>}
            {s.kind === "barcode" && <div className="onboarding-icon"><Barcode size={44} /></div>}
            {s.kind === "detail" && <div className="onboarding-icon"><Info size={44} /></div>}
            {s.kind === "score" && <div className="onboarding-score-demo"><div className="score-ring grade-a"><b>92</b><small>/ 100</small><em>A</em></div></div>}
          </div>
          <h2>{s.title}</h2>
          <span>{s.body}</span>
        </div>)}
      </div>
      <div className="onboarding-dots">{ONBOARDING_STEPS.map((_, i) => <button type="button" key={i} className={`onboarding-dot${i === step ? " active" : ""}`} onClick={() => goTo(i)} aria-label={`Go to slide ${i + 1}`} />)}</div>
      <div className="onboarding-nav">
        {step > 0 ? <button type="button" className="onboarding-back" onClick={() => goTo(step - 1)}><ArrowLeft size={18} /></button> : <span />}
        {last
          ? <button type="button" className="onboarding-next onboarding-cta" onClick={close}>Get started <ArrowRight size={17} /></button>
          : <button type="button" className="onboarding-next" onClick={() => goTo(step + 1)}>Next <ArrowRight size={17} /></button>}
      </div>
    </div>
  </div>;
}

function Help({ onClose, onTutorial }: { onClose: () => void; onTutorial: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); window.setTimeout(onClose, 200); };
  return <div className={`help-backdrop${closing ? " closing" : ""}`} onClick={close}><section className={`help-card${closing ? " closing" : ""}`} onClick={event => event.stopPropagation()}><button onClick={close}><X size={19} /></button><Leaf size={24} fill="currentColor" /><h2>Quick scan guide</h2><p><b>Food:</b> center your meal, then tap the large scan button.</p><p><b>Barcode:</b> switch modes and hold the code inside the frame—it scans automatically.</p><p className="help-note">Scores are helpful estimates, not medical advice.</p><button type="button" className="help-tutorial-btn" onClick={onTutorial}><Sparkles size={15} /> Replay tutorial</button><p className="help-credit">Made by Rishaan Mehta</p></section></div>;
}
