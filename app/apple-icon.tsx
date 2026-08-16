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
const LEAF_PATH_1 = "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z";
const LEAF_PATH_2 = "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#baff59", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width={96 * RENDER} height={96 * RENDER} viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={LEAF_PATH_1} />
          <path d={LEAF_PATH_2} />
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
