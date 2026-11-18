import { Suspense } from "react";
import type { Metadata } from "next";
import { groupBuyBySlug } from "../../../../../group-buy/model";
import { cachedPublicGroupBuy } from "../../../../../group-buy/server/public-cache";
import { ProductPage } from "../../../../../group-buy/product-page";

export const generateStaticParams = () => [];

export async function generateMetadata({ params }: { params: Promise<{ slug: string; productId: string }> }): Promise<Metadata> {
  const { slug, productId } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const decodedProductId = decodeURIComponent(productId);
  const isPants = decodedSlug === "pants" && decodedProductId === "p-pants";
  const state = isPants ? await cachedPublicGroupBuy(decodedSlug).catch(() => null) : null;
  const groupBuy = state ? groupBuyBySlug(state, decodedSlug) : null;
  const product = groupBuy?.products.find((item) => item.id === decodedProductId);
  const title = isPants ? "마약팬츠 공구" : "상품 상세";
  const description = isPants ? "마약팬츠 공구 상품과 옵션을 확인하세요." : title;
  const image = product?.images.find((url) => url.startsWith("https://"));
  return {
    metadataBase: new URL("https://gb.uncloset.co.kr"),
    title,
    description,
    alternates: isPants ? { canonical: "https://gb.uncloset.co.kr/pants" } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "마약팬츠 공구",
      url: isPants ? "https://gb.uncloset.co.kr/pants" : undefined,
      images: image ? [{ url: image, width: 900, height: 900, alt: title }] : undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: image ? [image] : undefined },
  };
}

export default async function LocalTestProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params;
  return <Suspense><ProductPage slug={decodeURIComponent(slug)} productId={decodeURIComponent(productId)} /></Suspense>;
}
