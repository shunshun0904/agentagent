import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "エージェントエージェント",
    template: "%s | エージェントエージェント",
  },
  description: "フリーランスエンジニアのための、フリーランスエージェント対応 AI エージェント",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
