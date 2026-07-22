import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import type { PreparedSpeechManifest } from "@/lib/presentation";

const ROOT = path.join(process.cwd(), "public", "presentation-projects");
const safeId = (value: string) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const manifestPath = (id: string) => path.join(ROOT, id, "speech-manifest.json");
const emotions = new Set<PreparedSpeechManifest["entries"][number]["emotion"]>(["normal", "happy", "angry", "surprised", "sad"]);

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!safeId(id)) return NextResponse.json({ error: "発表プロジェクトIDが不正です" }, { status: 400 });
  try {
    const manifest = JSON.parse(await readFile(manifestPath(id), "utf8")) as PreparedSpeechManifest;
    return NextResponse.json({ manifest }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ manifest: { projectId: id, preparedAt: "", entries: [] } satisfies PreparedSpeechManifest });
  }
}

export async function POST(request: Request) {
  const data = await request.formData();
  const id = String(data.get("projectId") || "");
  const audio = data.get("audio");
  const slideIndex = Number(data.get("slideIndex"));
  const paragraphIndex = Number(data.get("paragraphIndex"));
  const text = String(data.get("text") || "");
  const emotion = String(data.get("emotion") || "normal") as PreparedSpeechManifest["entries"][number]["emotion"];
  const durationMs = Number(data.get("durationMs"));
  if (!safeId(id) || !(audio instanceof File) || !Number.isInteger(slideIndex) || !Number.isInteger(paragraphIndex) || !text || !emotions.has(emotion)) return NextResponse.json({ error: "準備済み音声の情報が不正です" }, { status: 400 });
  const dir = path.join(ROOT, id, "audio");
  await mkdir(dir, { recursive: true });
  const extension = audio.type.includes("mpeg") ? "mp3" : "wav";
  const fileName = `${String(slideIndex + 1).padStart(3, "0")}-${String(paragraphIndex + 1).padStart(2, "0")}.${extension}`;
  await writeFile(path.join(dir, fileName), Buffer.from(await audio.arrayBuffer()));
  let manifest: PreparedSpeechManifest = { projectId: id, preparedAt: new Date().toISOString(), entries: [] };
  try { manifest = JSON.parse(await readFile(manifestPath(id), "utf8")) as PreparedSpeechManifest; } catch {}
  const entry = { slideIndex, paragraphIndex, text, emotion, audioUrl: `/presentation-projects/${id}/audio/${fileName}`, contentType: audio.type || "audio/wav", durationMs: Math.max(1, Math.round(durationMs) || 1000) };
  manifest.entries = [...manifest.entries.filter((item) => item.slideIndex !== slideIndex || item.paragraphIndex !== paragraphIndex), entry];
  manifest.preparedAt = new Date().toISOString();
  await writeFile(manifestPath(id), `${JSON.stringify(manifest, null, 2)}\n`);
  return NextResponse.json({ manifest });
}
