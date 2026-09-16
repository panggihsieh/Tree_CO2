import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TreeCarbon EDU | 校園樹木碳匯調查",
  description: "適合 iPad 與手機使用的校園樹木清冊上傳、AI 模擬辨識、胸徑量測與碳匯估算 webapp。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
