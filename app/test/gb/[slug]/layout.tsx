import { PublicGroupBuySeed } from "../../../group-buy/public-store";
import { cachedPublicGroupBuy } from "../../../group-buy/server/public-cache";

// 고객 화면은 공구 정보를 담은 HTML을 CDN에서 바로 내려준다. 값은 public-cache의 주기와 맞춘다.
export const revalidate = 300;
export const generateStaticParams = () => [];

export default async function PublicGroupBuyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug);
  const state = await cachedPublicGroupBuy(slug).catch(() => null);
  return <PublicGroupBuySeed slug={slug} state={state}>{children}</PublicGroupBuySeed>;
}
