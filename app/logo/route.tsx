import { ImageResponse } from "next/og";

const FOOD_PATH_1 = "M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46";
const FOOD_PATH_2 = "M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z";
const FOOD_PATH_3 = "M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z";

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
