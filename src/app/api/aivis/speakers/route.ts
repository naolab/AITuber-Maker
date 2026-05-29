import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { aivisUrl } = await req.json();

    if (!aivisUrl) {
      return NextResponse.json({ error: "Missing aivisUrl" }, { status: 400 });
    }

    const speakersUrl = new URL("/speakers", aivisUrl);
    const res = await fetch(speakersUrl.toString(), {
      method: "GET",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch speakers" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Aivis speakers route error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
