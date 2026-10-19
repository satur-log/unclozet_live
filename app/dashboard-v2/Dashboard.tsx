"use client";

import { usePathname } from "next/navigation";
import BroadcastsV2 from "./broadcasts-v2";
import CustomersV2 from "./customers-v2";

// 방송 내역·고객 관리 라우터. 화면은 v2(broadcasts-v2 · customers-v2)를 쓴다.
export default function Dashboard({ basePath = "" }: { basePath?: string }) {
  const path = usePathname();
  const route = basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
  const detail = route.match(/^\/broadcasts\/([^/]+)$/);
  if (route === "/customers") return <CustomersV2 basePath={basePath} />;
  if (detail) return <BroadcastsV2 basePath={basePath} broadcastId={decodeURIComponent(detail[1])} />;
  return <BroadcastsV2 basePath={basePath} />;
}
