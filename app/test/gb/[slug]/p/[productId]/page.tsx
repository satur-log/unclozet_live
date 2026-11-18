import { Suspense } from "react";
import type { Metadata } from "next";
import { ProductPage } from "../../../../../group-buy/product-page";

export const generateStaticParams = () => [];

export async function generateMetadata({ params }: { params: Promise<{ slug: string; productId: string }> }): Promise<Metadata> {
  const { slug, productId } = await params;
  const isPants = decodeURIComponent(slug) === "pants" && decodeURIComponent(productId) === "p-pants";
  const title = isPants ? "마약 팬츠 공구" : "상품 상세";
  return {
    title,
    description: title,
    openGraph: { title, description: title, type: "website" },
    twitter: { card: "summary", title, description: title },
  };
}

export default async function LocalTestProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params;
  return <Suspense><ProductPage slug={decodeURIComponent(slug)} productId={decodeURIComponent(productId)} /></Suspense>;
}
