import { orderIssues } from "./model";
import type { Broadcast, OrderStatus } from "./types";

// 방송 목록 화면용 요약(브라우저·서버 공용). 방송 한 건은 주문·정산이 통째로 들어 있어 수십 KB지만,
// 목록은 제목·날짜·건수만 있으면 된다. 서버가 저장할 때 같이 계산해 dashboard_v2_broadcasts.summary에 둔다.

/** 계산 방식이 바뀌면 올린다. 다른 값으로 저장된 요약은 서버가 다시 계산한다. */
export const SUMMARY_KIND = 1;

export type BroadcastSummary = {
  k: number;
  id: string;
  title: string;
  createdAt: string;
  orders: number;
  waiting: number;
  ready: number;
  completed: number;
  review: number;
};

/** 주문서가 들어온 주문 중 고칠 게 남은 것만 "검토 필요"로 본다. (목록·상세 공통 기준) */
export const needsReview = (broadcast: Broadcast, order: Broadcast["orders"][number]) => Boolean(order.sourceText) && orderIssues(broadcast, order).length > 0;

export function broadcastSummary(broadcast: Broadcast): BroadcastSummary {
  const count = (status: OrderStatus) => broadcast.orders.filter((order) => order.status === status).length;
  return {
    k: SUMMARY_KIND,
    id: broadcast.id,
    title: broadcast.title,
    createdAt: broadcast.createdAt,
    orders: broadcast.orders.length,
    waiting: count("WAITING"),
    ready: count("READY"),
    completed: count("COMPLETED"),
    review: broadcast.orders.filter((order) => needsReview(broadcast, order)).length,
  };
}

export function isBroadcastSummary(value: unknown): value is BroadcastSummary {
  const item = value as Partial<BroadcastSummary> | null;
  return Boolean(item && typeof item === "object" && item.k === SUMMARY_KIND && typeof item.id === "string" && typeof item.title === "string" && typeof item.createdAt === "string"
    && [item.orders, item.waiting, item.ready, item.completed, item.review].every((n) => typeof n === "number"));
}
