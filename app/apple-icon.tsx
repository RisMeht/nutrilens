import { ImageResponse } from "next/og";

// iOS displays this at 180x180 (the largest size it asks for, on @3x devices), but rendering
// the ImageResponse at exactly that size bakes in Satori/resvg's anti-aliasing at the final
// pixel grid — every diagonal edge (the leaf strokes, the corner-bracket rounds) comes out
// visibly soft. Rendering at 3x (540x540) and letting iOS downsample supersamples those same
// edges instead, which is what actually reads as "crisp" rather than "blurry" on a Retina
// screen. The `size` export (used for the metadata `sizes` attribute) stays at the real
// 180x180 target; only the ImageResponse's own render dimensions are scaled up.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const RENDER = 3;
const FOOD_PATH_1 = "M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46";
const FOOD_PATH_2 = "M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z";
const FOOD_PATH_3 = "M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#baff59", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width={96 * RENDER} height={96 * RENDER} viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={FOOD_PATH_1} />
          <path d={FOOD_PATH_2} />
          <path d={FOOD_PATH_3} />
        </svg>
        <div style={{ position: "absolute", top: 22 * RENDER, left: 22 * RENDER, width: 40 * RENDER, height: 40 * RENDER, borderTop: `${9 * RENDER}px solid #153e20`, borderLeft: `${9 * RENDER}px solid #153e20`, borderRadius: `${12 * RENDER}px 0 0 0` }} />
        <div style={{ position: "absolute", top: 22 * RENDER, right: 22 * RENDER, width: 40 * RENDER, height: 40 * RENDER, borderTop: `${9 * RENDER}px solid #153e20`, borderRight: `${9 * RENDER}px solid #153e20`, borderRadius: `0 ${12 * RENDER}px 0 0` }} />
        <div style={{ position: "absolute", bottom: 22 * RENDER, left: 22 * RENDER, width: 40 * RENDER, height: 40 * RENDER, borderBottom: `${9 * RENDER}px solid #153e20`, borderLeft: `${9 * RENDER}px solid #153e20`, borderRadius: `0 0 0 ${12 * RENDER}px` }} />
        <div style={{ position: "absolute", bottom: 22 * RENDER, right: 22 * RENDER, width: 40 * RENDER, height: 40 * RENDER, borderBottom: `${9 * RENDER}px solid #153e20`, borderRight: `${9 * RENDER}px solid #153e20`, borderRadius: `0 0 ${12 * RENDER}px 0` }} />
      </div>
    ),
    { width: size.width * RENDER, height: size.height * RENDER }
  );
}
