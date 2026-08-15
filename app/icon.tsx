import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const LEAF_PATH_1 = "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z";
const LEAF_PATH_2 = "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#baff59", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={LEAF_PATH_1} />
          <path d={LEAF_PATH_2} />
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
