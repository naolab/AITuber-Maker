import { NextRequest, NextResponse } from "next/server";

import { isLocalEndpoint, normalizeEndpoint } from "@/lib/server/local-endpoint";

export async function GET(request: NextRequest) {
  const endpoint = request.nextUrl.searchParams.get("endpoint") ?? "http://127.0.0.1:50021";

  if (!isLocalEndpoint(endpoint)) {
    return NextResponse.json({ error: "ローカルVOICEVOX EngineのURLのみ指定できます" }, { status: 400 });
  }

  try {
    const response = await fetch(`${normalizeEndpoint(endpoint)}/speakers`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `VOICEVOX Engine が ${response.status} を返しました` }, { status: 502 });
    }
    const speakers = await response.json();
    return NextResponse.json({ speakers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VOICEVOX Engineへ接続できません" },
      { status: 502 },
    );
  }
}
