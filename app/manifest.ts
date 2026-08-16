import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Viva",
    short_name: "Viva",
    description: "Scan food photos or barcodes and get instant nutrition and health-score insights.",
    start_url: "/",
    display: "standalone",
    background_color: "#07150d",
    theme_color: "#07150d",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" }
    ]
  };
}
