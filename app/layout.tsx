import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DashboardProvider } from "./dashboard-v2/provider";

export const metadata: Metadata = {
  title: "언클로젯 운영 대시보드 V2",
  description: "라이브커머스 주문 정산 및 출고 운영 대시보드 V2",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="font-sans">
      <body><DashboardProvider>{children}</DashboardProvider></body>
    </html>
  );
}
