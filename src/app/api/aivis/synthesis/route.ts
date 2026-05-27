import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { text, speaker, aivisUrl } = await req.json();

    if (!text || !aivisUrl) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
      const errText = await queryRes.text();
      return NextResponse.json({ error: `Audio query failed: ${errText}` }, { status: queryRes.status });
    }

    const audioQuery = await queryRes.json();

    // 2. Synthesize audio
    const synthUrl = new URL("/synthesis", aivisUrl);
    synthUrl.searchParams.set("speaker", String(speaker ?? 2));

    const synthRes = await fetch(synthUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(audioQuery),
    });

    if (!synthRes.ok) {
      const errText = await synthRes.text();
      return NextResponse.json({ error: `Synthesis failed: ${errText}` }, { status: synthRes.status });
    }

    const audioBuffer = await synthRes.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
      },
    });
  } catch (error) {
    console.error("Aivis synthesis route error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
