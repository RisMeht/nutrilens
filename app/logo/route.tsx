import { ImageResponse } from "next/og";

const LEAF_PATH_1 = "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z";
const LEAF_PATH_2 = "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12";

// A dedicated high-resolution (512px) source for in-app UI use (header wordmark, home screen),
// decoupled from icon.tsx/apple-icon.tsx which stay sized for their specific favicon/home-screen
// icon roles. Displaying those small favicon sizes upscaled in the UI is what made the logo
// look grainy — a browser downscaling this instead always renders crisp regardless of display density.
export async function GET() {
  return new ImageResponse(
    (
      <div style={{ width: 512, height: 512, background: "#baff59", borderRadius: 128, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width="272" height="272" viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={LEAF_PATH_1} />
          <path d={LEAF_PATH_2} />
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
