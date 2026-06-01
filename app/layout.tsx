import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "公益 AI 站",
  description: "一个轻量、可部署到 Vercel 的公益 AI 聊天站"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
