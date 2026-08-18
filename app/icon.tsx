import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// A single bold circle + leaf (lucide's Citrus icon) reads far more cleanly at actual icon
// size than the previous Cherry glyph, whose two overlapping circles and crossing stems turned
// into visual noise once scaled down to a real home-screen icon.
const FOOD_PATH_1 = "M21.66 17.67a1.08 1.08 0 0 1-.04 1.6A12 12 0 0 1 4.73 2.38a1.1 1.1 0 0 1 1.61-.04z";
const FOOD_PATH_2 = "M19.65 15.66A8 8 0 0 1 8.35 4.34";
const FOOD_PATH_3 = "m14 10-5.5 5.5";
const FOOD_PATH_4 = "M14 17.85V10H6.15";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#baff59", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={FOOD_PATH_1} />
          <path d={FOOD_PATH_2} />
          <path d={FOOD_PATH_3} />
          <path d={FOOD_PATH_4} />
        </svg>
        <div style={{ position: "absolute", top: 3, left: 3, width: 9, height: 9, borderTop: "2.5px solid #153e20", borderLeft: "2.5px solid #153e20", borderRadius: "3px 0 0 0" }} />
        <div style={{ position: "absolute", top: 3, right: 3, width: 9, height: 9, borderTop: "2.5px solid #153e20", borderRight: "2.5px solid #153e20", borderRadius: "0 3px 0 0" }} />
        <div style={{ position: "absolute", bottom: 3, left: 3, width: 9, height: 9, borderBottom: "2.5px solid #153e20", borderLeft: "2.5px solid #153e20", borderRadius: "0 0 0 3px" }} />
        <div style={{ position: "absolute", bottom: 3, right: 3, width: 9, height: 9, borderBottom: "2.5px solid #153e20", borderRight: "2.5px solid #153e20", borderRadius: "0 0 3px 0" }} />
      </div>
    ),
    { ...size }
  );
}
