import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const LEAF_PATH_1 = "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z";
const LEAF_PATH_2 = "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#baff59", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={LEAF_PATH_1} />
          <path d={LEAF_PATH_2} />
        </svg>
        <div style={{ position: "absolute", top: 22, left: 22, width: 40, height: 40, borderTop: "9px solid #153e20", borderLeft: "9px solid #153e20", borderRadius: "12px 0 0 0" }} />
        <div style={{ position: "absolute", top: 22, right: 22, width: 40, height: 40, borderTop: "9px solid #153e20", borderRight: "9px solid #153e20", borderRadius: "0 12px 0 0" }} />
        <div style={{ position: "absolute", bottom: 22, left: 22, width: 40, height: 40, borderBottom: "9px solid #153e20", borderLeft: "9px solid #153e20", borderRadius: "0 0 0 12px" }} />
        <div style={{ position: "absolute", bottom: 22, right: 22, width: 40, height: 40, borderBottom: "9px solid #153e20", borderRight: "9px solid #153e20", borderRadius: "0 0 12px 0" }} />
      </div>
    ),
    { ...size }
  );
}
