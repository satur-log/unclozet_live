import GroupBuyAdminV2 from "../../../group-buy/admin-v2";

export default async function LocalTestGroupBuyPage({ params, searchParams }: { params: Promise<{ groupBuyId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ groupBuyId }, { tab }] = await Promise.all([params, searchParams]);
  return <GroupBuyAdminV2 groupBuyId={decodeURIComponent(groupBuyId)} tab={tab} />;
}
