import { ImageResponse } from "next/og";

const FOOD_PATH_1 = "M2 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z";
const FOOD_PATH_2 = "M12 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z";
const FOOD_PATH_3 = "M7 14c3.22-2.91 4.29-8.75 5-12 1.66 2.38 4.94 9 5 12";
const FOOD_PATH_4 = "M22 9c-4.29 0-7.14-2.33-10-7 5.71 0 10 4.67 10 7Z";

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
