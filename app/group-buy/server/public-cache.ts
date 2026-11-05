import { revalidateTag, unstable_cache } from "next/cache";
import { publicGroupBuyState } from "./service";

// 고객 화면용 공구 정보 캐시. 판매자가 공구를 바꾸면 바로 비운다. 주문 접수는 캐시를 쓰지 않고 서버에서 최신 값으로 다시 검사한다.

const GB_PUBLIC_TAG = "gb-public";
export const GB_PUBLIC_REVALIDATE_SECONDS = 300;

export const cachedPublicGroupBuy = unstable_cache((slug: string) => publicGroupBuyState(slug), ["gb-public-group-buy"], { tags: [GB_PUBLIC_TAG], revalidate: GB_PUBLIC_REVALIDATE_SECONDS });

export function refreshPublicGroupBuys() {
  revalidateTag(GB_PUBLIC_TAG, { expire: 0 });
}
