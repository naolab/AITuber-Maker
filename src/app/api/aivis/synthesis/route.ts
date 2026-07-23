import { NextRequest, NextResponse } from "next/server";

const AIVIS_CLOUD_SYNTHESIS_URL = "https://api.aivis-project.com/v1/tts/synthesize";

const readErrorText = async (response: Response) => {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText;

  try {
    const data = JSON.parse(text) as { detail?: string; error?: string; message?: string };
    return data.detail || data.error || data.message || text;
  } catch {
    return text;
  }
};

export async function POST(req: NextRequest) {
  try {
    const {
      text,
      speaker,
      aivisUrl,
      ttsType,
      aivisCloudApiKey,
      aivisCloudModelUuid,
      aivisCloudStyleId,
      aivisCloudStyleName,
      aivisCloudUserDictionaryUuid,
      aivisCloudOutputFormat,
      aivisCloudSpeakingRate,
      localSpeakingRate,
    } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (ttsType === "aivis-cloud") {
      if (!aivisCloudApiKey || !aivisCloudModelUuid) {
        return NextResponse.json({ error: "Aivis Cloud APIキーとモデルUUIDが必要です" }, { status: 400 });
      }

      const payload: Record<string, unknown> = {
        model_uuid: aivisCloudModelUuid,
        text,
        output_format: aivisCloudOutputFormat || "mp3",
        use_ssml: false,
      };
      const styleIdInput = String(aivisCloudStyleId ?? "").trim();
      const styleId = Number(styleIdInput);
      if (styleIdInput && Number.isFinite(styleId)) {
        payload.style_id = styleId;
      } else if (aivisCloudStyleName) {
        payload.style_name = aivisCloudStyleName;
      }
      if (aivisCloudUserDictionaryUuid) {
        payload.user_dictionary_uuid = aivisCloudUserDictionaryUuid;
      }
      const speakingRateInput = String(aivisCloudSpeakingRate ?? "").trim();
      const speakingRate = Number(speakingRateInput);
      if (speakingRateInput && Number.isFinite(speakingRate)) {
        payload.speaking_rate = speakingRate;
      }

      const cloudRes = await fetch(AIVIS_CLOUD_SYNTHESIS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aivisCloudApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!cloudRes.ok) {
        return NextResponse.json({ error: `Aivis Cloud synthesis failed: ${await readErrorText(cloudRes)}` }, { status: cloudRes.status });
      }

      const audioBuffer = await cloudRes.arrayBuffer();
      const contentType = cloudRes.headers.get("content-type") || `audio/${payload.output_format}`;
      return new NextResponse(audioBuffer, {
        headers: {
          "Content-Type": contentType,
        },
      });
    }

    if (!aivisUrl) {
      return NextResponse.json({ error: "Missing aivisUrl" }, { status: 400 });
    }

    // 1. Get audio query
    const queryUrl = new URL("/audio_query", aivisUrl);
    queryUrl.searchParams.set("text", text);
    queryUrl.searchParams.set("speaker", String(speaker ?? 2));

    const queryRes = await fetch(queryUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!queryRes.ok) {
      return NextResponse.json({ error: `Audio query failed: ${await readErrorText(queryRes)}` }, { status: queryRes.status });
    }

    const audioQuery = await queryRes.json();
    const speakingRate = Number(localSpeakingRate);
    if (Number.isFinite(speakingRate)) {
      audioQuery.speedScale = Math.min(2, Math.max(0.5, speakingRate));
    }

    // 2. Synthesize audio
    const synthUrl = new URL("/synthesis", aivisUrl);
    synthUrl.searchParams.set("speaker", String(speaker ?? 2));

    const synthRes = await fetch(synthUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(audioQuery),
    });

    if (!synthRes.ok) {
      return NextResponse.json({ error: `Synthesis failed: ${await readErrorText(synthRes)}` }, { status: synthRes.status });
    }

    const audioBuffer = await synthRes.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
      },
    });
  } catch (error) {
    console.error("Aivis synthesis route error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: `Aivis Speechに接続できませんでした: ${message}` }, { status: 500 });
  }
}
