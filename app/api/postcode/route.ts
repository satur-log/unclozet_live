import { NextResponse } from "next/server";

type JusoResult = {
  roadAddr?: string;
  roadAddrPart1?: string;
  jibunAddr?: string;
  zipNo?: string;
};

type JusoResponse = {
  results?: {
    common?: {
      errorCode?: string;
      errorMessage?: string;
    };
    juso?: JusoResult[];
  };
};

export async function POST(request: Request) {
  const apiKey = process.env.JUSO_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "도로명주소 API 승인키가 설정되지 않았습니다.", code: "NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  let address = "";

  try {
    const body = (await request.json()) as { address?: unknown };
    address = typeof body.address === "string" ? body.address.trim() : "";
  } catch {
    return NextResponse.json({ error: "주소 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (address.length < 2 || address.length > 80) {
    return NextResponse.json({ error: "조회할 주소를 2자 이상 80자 이하로 입력해주세요." }, { status: 400 });
  }

  const params = new URLSearchParams({
    confmKey: apiKey,
    currentPage: "1",
    countPerPage: "10",
    keyword: address,
    resultType: "json",
  });

  try {
    const response = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?${params.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ error: "우편번호 조회 서비스에 연결하지 못했습니다." }, { status: 502 });
    }

    const data = (await response.json()) as JusoResponse;
    const errorCode = data.results?.common?.errorCode;

    if (errorCode && errorCode !== "0") {
      return NextResponse.json(
        { error: data.results?.common?.errorMessage || "주소를 검색하지 못했습니다." },
        { status: 502 },
      );
    }

    const seen = new Set<string>();
    const candidates = (data.results?.juso ?? []).flatMap((result) => {
      const zipCode = result.zipNo?.trim() ?? "";
      const roadAddress = (result.roadAddrPart1 || result.roadAddr || "").trim();

      if (!zipCode || !roadAddress) {
        return [];
      }

      const key = `${zipCode}|${roadAddress}`;
      if (seen.has(key)) {
        return [];
      }

      seen.add(key);
      return [{ zipCode, roadAddress, jibunAddress: result.jibunAddr?.trim() ?? "" }];
    });

    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ error: "우편번호 조회 중 오류가 발생했습니다." }, { status: 502 });
  }
}
