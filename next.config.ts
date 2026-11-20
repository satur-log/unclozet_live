import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // 고객 공구 화면의 짧은 주소. 실제 화면 파일은 app/test/gb/ 아래에 있다(예전 /test/gb/… 주소도 계속 열린다).
  // afterFiles라서 같은 이름의 관리 화면(/customers, /login 등)이 있으면 그쪽이 먼저다.
  async rewrites() {
    const slug = ":slug([a-z0-9][a-z0-9-]*)";
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/pants", destination: "/test/gb/pants/p/p-pants" },
        { source: "/lookup", destination: "/test/gb/lookup" },
        { source: "/order/:token", destination: "/test/gb/order/:token" },
        { source: `/${slug}`, destination: "/test/gb/:slug" },
        { source: `/${slug}/checkout`, destination: "/test/gb/:slug/checkout" },
        { source: `/${slug}/p/:productId`, destination: "/test/gb/:slug/p/:productId" },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
