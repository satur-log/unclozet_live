import { Suspense } from "react";
import { StoreHomePage } from "../../../group-buy/storefront";

export default async function LocalTestStoreHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Suspense><StoreHomePage slug={decodeURIComponent(slug)} /></Suspense>;
}
