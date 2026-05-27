import { NextRequest, NextResponse } from "next/server";

import { isLocalEndpoint, normalizeEndpoint } from "@/lib/server/local-endpoint";

type VoicevoxAudioRequest = {
  endpoint?: string;
  text?: string;
  speaker?: number;
  speedScale?: number;
  pitchScale?: number;
  intonationScale?: number;
  volumeScale?: number;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as VoicevoxAudioRequest;
  const endpoint = body.endpoint ?? "http://127.0.0.1:50021";
  const speaker = Number.isFinite(body.speaker) ? Number(body.speaker) : 1;
  const text = String(body.text ?? "").trim();

  if (!isLocalEndpoint(endpoint)) {
    return NextResponse.json({ error: "ローカルVOICEVOX EngineのURLのみ指定できます" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "読み上げテキストが空です" }, { status: 400 });
  }

  try {
    const baseUrl = normalizeEndpoint(endpoint);
    const queryResponse = await fetch(`${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!queryResponse.ok) {
      return NextResponse.json({ error: `audio_query が ${queryResponse.status} を返しました` }, { status: 502 });
    }

    const audioQuery = await queryResponse.json();
    audioQuery.speedScale = Number(body.speedScale) || audioQuery.speedScale;
    audioQuery.pitchScale = Number.isFinite(body.pitchScale) ? Number(body.pitchScale) : audioQuery.pitchScale;
    audioQuery.intonationScale = Number(body.intonationScale) || audioQuery.intonationScale;
    audioQuery.volumeScale = Number(body.volumeScale) || audioQuery.volumeScale;

    const synthesisResponse = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
      method: "POST",
      body: JSON.stringify(audioQuery),
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!synthesisResponse.ok) {
      return NextResponse.json({ error: `synthesis が ${synthesisResponse.status} を返しました` }, { status: 502 });
    }

    return new Response(await synthesisResponse.arrayBuffer(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": synthesisResponse.headers.get("content-type") ?? "audio/wav",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VOICEVOX Engineで音声生成できません" },
      { status: 502 },
    );
  }
}
