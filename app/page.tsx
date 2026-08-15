"use client";

import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Barcode, Camera, CircleHelp, ImagePlus, Info, Leaf, LoaderCircle, ScanLine, Sparkles, SwitchCamera, X } from "lucide-react";

type Alternative = { name: string; image?: string };
type NutritionFact = { label: string; value: string };
type Result = {
  name: string;
  category?: string;
  score: number;
  grade: string;
  summary: string;
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

const fallbackFoodImage = (name: string) => `https://placehold.co/640x480/e6efe2/2e5a34?text=${encodeURIComponent(name)}`;
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
  const [enriching, setEnriching] = useState(false), [showHighlights, setShowHighlights] = useState(false), [showConcerns, setShowConcerns] = useState(false), [showAlternatives, setShowAlternatives] = useState(false);
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), barcodeControls = useRef<IScannerControls | null>(null), imageInput = useRef<HTMLInputElement>(null);
  const stopCamera = useCallback(() => { barcodeControls.current?.stop(); barcodeControls.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (video.current) video.current.srcObject = null; }, []);

  useEffect(() => {
    if (!result) {
      setShowHighlights(false); setShowConcerns(false); setShowAlternatives(false);
      return;
    }
    setShowHighlights(false); setShowConcerns(false); setShowAlternatives(false);
    const t1 = window.setTimeout(() => setShowHighlights(true), 120);
    const t2 = window.setTimeout(() => setShowConcerns(true), 240);
    const t3 = window.setTimeout(() => setShowAlternatives(true), 360);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3); };
  }, [result]);

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

  useEffect(() => {
    if (!cameraOn || !video.current) return; let cancelled = false;
    const open = async () => { setCameraError(""); stopCamera(); try {
      const constraints = { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
      if (mode === "barcode") { const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]])); const controls = await reader.decodeFromConstraints(constraints, video.current!, scan => { if (scan && !cancelled) { cancelled = true; controls.stop(); barcodeResult(scan.getText()); } }); await video.current?.play(); if (cancelled) controls.stop(); else barcodeControls.current = controls; }
      else { const media = await navigator.mediaDevices.getUserMedia(constraints); if (cancelled) media.getTracks().forEach(t => t.stop()); else { stream.current = media; video.current!.srcObject = media; await video.current!.play(); } }
    } catch { if (!cancelled) setCameraError("Camera access is off. Click the camera icon in your browser’s address bar, allow it, then try again."); } };
    open(); return () => { cancelled = true; stopCamera(); };
  }, [cameraOn, facing, mode, barcodeResult, stopCamera]);
  useEffect(() => () => stopCamera(), [stopCamera]);
  const analyze = async (image: string) => {
    setLoading(true); setError(""); setEnriching(false);
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setResult({ ...data, alternatives: normalizeAlternatives(data.alternatives) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The food scan did not finish.");
    } finally {
      setLoading(false);
    }
  };
  const takeFoodScan = () => { const source = video.current; if (!source || !source.videoWidth) return imageInput.current?.click(); const c = document.createElement("canvas"), ratio = Math.min(1, 1400 / source.videoWidth); c.width = Math.round(source.videoWidth * ratio); c.height = Math.round(source.videoHeight * ratio); c.getContext("2d")?.drawImage(source, 0, 0, c.width, c.height); analyze(c.toDataURL("image/jpeg", .8)); };
  const file = (f?: File) => { if (!f) return; const reader = new FileReader(); reader.onload = () => analyze(reader.result as string); reader.readAsDataURL(f); };
  const changeMode = (next: ScanMode) => { if (next !== mode) { stopCamera(); setCameraOn(false); setMode(next); setCameraError(""); requestAnimationFrame(() => setCameraOn(true)); } };
  const scanAgain = () => { setResult(null); setError(""); setCameraError(""); setEnriching(false); stopCamera(); setCameraOn(false); requestAnimationFrame(() => setCameraOn(true)); };
  const grade = result?.grade?.toLowerCase() || "a";
  const displayNumber = (value: number | undefined, suffix = "") => Number.isFinite(value) ? `${value}${suffix}` : "—";
  if (!entered) return <main className="home-screen"><header><div className="wordmark"><span><Leaf size={17} fill="currentColor" /></span>NutriLens</div><button className="help" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></button></header><div className="home-copy"><p><Sparkles size={13} /> SMART FOOD SCANNER</p><h1>Know your<br /><i>next bite.</i></h1><span>Food scores made simple.</span></div><div className="home-card"><div className="home-bowl">🥑<b>🥕</b><i>🍅</i></div><div><strong>Scan food</strong><span>Photo or barcode</span></div><em>01</em></div><button className="enter" onClick={() => { setEntered(true); setCameraOn(true); }}><span><Camera size={22} /></span> Swipe to scan <b>›</b></button>{helpOpen && <Help onClose={() => setHelpOpen(false)} />}</main>;
  return <main className="app-shell"><section className={`camera-screen mode-${mode} ${cameraOn ? "camera-active" : ""}`}><video ref={video} muted playsInline className="camera-feed" /><div className="camera-shade" />
    <header><div className="wordmark"><span><Leaf size={17} fill="currentColor" /></span>NutriLens</div><button className="help" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></button></header>
    <div className="top-copy"><h1>{mode === "food" ? "Tap to scan food" : "Hold barcode in frame"}</h1></div>
    <div className={`focus-frame ${mode === "barcode" ? "barcode-frame" : ""}`}><i /><i /><i /><i />{mode === "barcode" && <div className="scan-beam" />}</div>{!cameraOn && <div className="camera-empty"><div className="food-glow">🥗</div><p>Point, scan, understand.</p></div>}{cameraError && <div className="camera-error">{cameraError}</div>}
    <div className="bottom-panel"><div className="mode-switch"><button className={mode === "food" ? "selected" : ""} onClick={() => changeMode("food")}><Camera size={17} /> Food</button><button className={mode === "barcode" ? "selected" : ""} onClick={() => changeMode("barcode")}><Barcode size={18} /> Barcode</button></div><div className="scan-actions"><button className="gallery" onClick={() => imageInput.current?.click()} aria-label="Choose photo"><ImagePlus size={22} /></button><button className="shutter" onClick={() => mode === "food" && takeFoodScan()} aria-label="Scan"><span>{mode === "barcode" ? <ScanLine size={31} /> : <Camera size={30} />}</span></button><button className="flip" onClick={() => { setFacing(v => v === "environment" ? "user" : "environment"); }} aria-label="Switch camera"><SwitchCamera size={22} /></button></div></div>
  </section><input ref={imageInput} type="file" accept="image/*" capture="environment" hidden onChange={e => file(e.target.files?.[0])} />
  {(loading || result || error) && <div className="result-sheet"><div className="sheet-card"><button className="close-sheet" onClick={scanAgain}><X size={20} /></button>{loading && <div className="scan-state"><LoaderCircle className="spin" size={38} /><h2>Checking nutrition info</h2><p>Matching ingredients and nutrition facts…</p></div>}{error && !result && <div className="scan-state"><Info size={37} /><h2>That didn’t scan</h2><p>{error}</p><button className="retry" onClick={scanAgain}>Try again</button></div>}{result && !loading && <div className="result-content"><div className="result-heading"><div><p>{result.category || "FOOD"} · NUTRITION SCORE</p><h2>{result.name}</h2><span>{result.summary}</span></div><div className={`score-ring grade-${grade}`}><b>{Math.round(result.score)}</b><small>/ 100</small><em>{result.grade}</em></div></div><div className="nutrition-row"><div><b>{displayNumber(result.calories)}</b><span>Calories</span></div><div><b>{displayNumber(result.protein, "g")}</b><span>Protein</span></div><div><b>{displayNumber(result.carbs, "g")}</b><span>Carbs</span></div><div><b>{displayNumber(result.fat, "g")}</b><span>Fat</span></div></div>{result.facts?.length ? <div className="facts-grid">{result.facts.map((fact, i) => <div key={`${fact.label}-${i}`}><span>{fact.label}</span><b>{fact.value}</b></div>)}</div> : null}{enriching && <div className="ai-status"><LoaderCircle className="spin" size={16} /><span>Loading Gemini health insights…</span></div>}<div className={`insights section-reveal ${showHighlights ? "show" : ""}`}>{result.highlights?.map((item, i) => <p key={i}><i>✓</i>{item}</p>)}</div>{result.concerns?.length ? <div className={`concerns section-reveal ${showConcerns ? "show" : ""}`}><strong><AlertTriangle size={16} /> Watch for</strong>{result.concerns.map((item, i) => <p key={i}>{item}</p>)}</div> : null}{result.alternatives?.length ? <div className={`alternatives section-reveal ${showAlternatives ? "show" : ""}`}><strong>Better swaps</strong><div className="alternatives-grid">{result.alternatives.map((item, i) => <article key={`${item.name}-${i}`}><img src={item.image || fallbackFoodImage(item.name)} alt={item.name} loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).src = fallbackFoodImage(item.name); }} /><span>{item.name}</span></article>)}</div></div> : null}<p className="note">{result.caution}</p>{error && <p className="note">{error}</p>}<button className="retry wide" onClick={scanAgain}>Scan another food</button></div>}</div></div>}{helpOpen && <Help onClose={() => setHelpOpen(false)} />}</main>;
}

function Help({ onClose }: { onClose: () => void }) {
  return <div className="help-backdrop" onClick={onClose}><section className="help-card" onClick={event => event.stopPropagation()}><button onClick={onClose}><X size={19} /></button><Leaf size={24} fill="currentColor" /><h2>Quick scan guide</h2><p><b>Food:</b> center your meal, then tap the large scan button.</p><p><b>Barcode:</b> switch modes and hold the code inside the frame—it scans automatically.</p><p className="help-note">Scores are helpful estimates, not medical advice.</p></section></div>;
}
