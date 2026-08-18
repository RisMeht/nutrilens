import { ImageResponse } from "next/og";

// A single bold circle + leaf (lucide's Citrus icon) reads far more cleanly at actual icon
// size than the previous Cherry glyph, whose two overlapping circles and crossing stems turned
// into visual noise once scaled down to a real home-screen icon.
const FOOD_PATH_1 = "M21.66 17.67a1.08 1.08 0 0 1-.04 1.6A12 12 0 0 1 4.73 2.38a1.1 1.1 0 0 1 1.61-.04z";
const FOOD_PATH_2 = "M19.65 15.66A8 8 0 0 1 8.35 4.34";
const FOOD_PATH_3 = "m14 10-5.5 5.5";
const FOOD_PATH_4 = "M14 17.85V10H6.15";

// A dedicated high-resolution (512px) source for in-app UI use (header wordmark, home screen),
// decoupled from icon.tsx/apple-icon.tsx which stay sized for their specific favicon/home-screen
// icon roles. Displaying those small favicon sizes upscaled in the UI is what made the logo
// look grainy — a browser downscaling this instead always renders crisp regardless of display density.
export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: 512, height: 512, background: "#baff59", borderRadius: 128, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width="272" height="272" viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={FOOD_PATH_1} />
          <path d={FOOD_PATH_2} />
          <path d={FOOD_PATH_3} />
          <path d={FOOD_PATH_4} />
        </svg>
        <div style={{ position: "absolute", top: 62, left: 62, width: 114, height: 114, borderTop: "26px solid #153e20", borderLeft: "26px solid #153e20", borderRadius: "34px 0 0 0" }} />
        <div style={{ position: "absolute", top: 62, right: 62, width: 114, height: 114, borderTop: "26px solid #153e20", borderRight: "26px solid #153e20", borderRadius: "0 34px 0 0" }} />
        <div style={{ position: "absolute", bottom: 62, left: 62, width: 114, height: 114, borderBottom: "26px solid #153e20", borderLeft: "26px solid #153e20", borderRadius: "0 0 0 34px" }} />
        <div style={{ position: "absolute", bottom: 62, right: 62, width: 114, height: 114, borderBottom: "26px solid #153e20", borderRight: "26px solid #153e20", borderRadius: "0 0 34px 0" }} />
      </div>
    ),
    { width: 512, height: 512 }
  );
}
