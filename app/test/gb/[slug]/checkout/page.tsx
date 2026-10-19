import { Suspense } from "react";
import { CheckoutPage } from "../../../../group-buy/customer";

export default async function LocalTestCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Suspense><CheckoutPage slug={decodeURIComponent(slug)} /></Suspense>;
}
