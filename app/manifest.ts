import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TreeCarbon EDU 校園樹木碳匯調查",
    short_name: "TreeCarbon EDU",
    description: "iPad 與手機適用的校園樹木清冊上傳、AI 模擬辨識與碳匯估算工具。",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f2",
    theme_color: "#245b45",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
