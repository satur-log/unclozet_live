"use client";

import Link from "next/link";
import { ChartNoAxesCombined, ShoppingBag, UsersRound } from "lucide-react";

export type ShellSection = "broadcasts" | "customers" | "group-buys";

function Icon({ name }: { name: "live" | "customer" | "group-buy" }) {
  return <span className="v2-icon" aria-hidden="true">{name === "live" ? <ChartNoAxesCombined /> : name === "group-buy" ? <ShoppingBag /> : <UsersRound />}</span>;
}

export function Shell({ children, section, basePath = "" }: { children: React.ReactNode; section: ShellSection; basePath?: string }) {
  const broadcastsHref = basePath || "/";
  const customersHref = `${basePath}/customers`;
  // 공구는 아직 프로토타입(브라우저 저장)이라 테스트 모드(/test)에서만 노출한다.
  const groupBuysHref = basePath === "/test" ? `${basePath}/group-buys` : null;
  return <div className="v2-app">
    <aside className="v2-sidebar">
      <Link href={broadcastsHref} className="v2-brand"><span>UC</span><div><strong>언클로젯</strong></div></Link>
      <nav aria-label="주 메뉴">
        <Link href={broadcastsHref} className={section === "broadcasts" ? "active" : ""}><Icon name="live" />방송 내역</Link>
        <Link href={customersHref} className={section === "customers" ? "active" : ""}><Icon name="customer" />고객 관리</Link>
        {groupBuysHref ? <Link href={groupBuysHref} className={section === "group-buys" ? "active" : ""}><Icon name="group-buy" />공구</Link> : null}
      </nav>
    </aside>
    <div className="v2-mobile-head"><Link href={broadcastsHref} className="v2-brand"><span>UC</span><strong>언클로젯</strong></Link><nav><Link href={broadcastsHref}>방송 내역</Link><Link href={customersHref}>고객 관리</Link>{groupBuysHref ? <Link href={groupBuysHref}>공구</Link> : null}</nav></div>
    <main className="v2-main">{children}</main>
  </div>;
}
