import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const FOOD_PATH_1 = "M2 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z";
const FOOD_PATH_2 = "M12 17a5 5 0 0 0 10 0c0-2.76-2.5-5-5-3-2.5-2-5 .24-5 3Z";
const FOOD_PATH_3 = "M7 14c3.22-2.91 4.29-8.75 5-12 1.66 2.38 4.94 9 5 12";
const FOOD_PATH_4 = "M22 9c-4.29 0-7.14-2.33-10-7 5.71 0 10 4.67 10 7Z";

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
