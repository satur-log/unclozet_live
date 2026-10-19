import { Suspense } from "react";
import { ProductPage } from "../../../../../group-buy/product-page";

export default async function LocalTestProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params;
  return <Suspense><ProductPage slug={decodeURIComponent(slug)} productId={decodeURIComponent(productId)} /></Suspense>;
}
