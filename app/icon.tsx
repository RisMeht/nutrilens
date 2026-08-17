import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const FOOD_PATH_1 = "M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46";
const FOOD_PATH_2 = "M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z";
const FOOD_PATH_3 = "M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#baff59", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#153e20" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={FOOD_PATH_1} />
          <path d={FOOD_PATH_2} />
          <path d={FOOD_PATH_3} />
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
