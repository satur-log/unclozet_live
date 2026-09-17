import type { Metadata, Viewport } from "next";
import Script from "next/script";
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
      <body>
        <DashboardProvider>{children}</DashboardProvider>
        <Script id="microsoft-clarity" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","y8qgzpocyx");`}
        </Script>
      </body>
    </html>
  );
}
