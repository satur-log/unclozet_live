import { Suspense } from "react";
import { OrderViewPage } from "../../../../group-buy/customer";

export default async function LocalTestOrderViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Suspense><OrderViewPage token={token} /></Suspense>;
}
