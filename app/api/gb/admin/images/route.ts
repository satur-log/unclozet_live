import { adminRoute, json } from "../../../../group-buy/server/http";
import { uploadImage } from "../../../../group-buy/server/service";

export const dynamic = "force-dynamic";

/** 상품 이미지 올리기(본문 = 이미지 파일). 돌려주는 url을 공구 데이터에 저장한다. */
export const POST = adminRoute(async (request) => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  return json({ url: await uploadImage(bytes, request.headers.get("content-type") ?? "") });
});
