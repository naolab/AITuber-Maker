import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

type LiveSpeech = {
  id: string;
  emotion: "normal" | "happy" | "angry" | "surprised" | "sad";
  text: string;
  audioBase64: string;
  contentType: string;
  sourceComment?: {
    id?: string;
    authorName: string;
    message: string;
  };
  createdAt: number;
};

const SPEECH_PATH = path.resolve(".aituber-live-speech.json");

const isLiveSpeech = (value: unknown): value is LiveSpeech => {
  if (!value || typeof value !== "object") return false;
  const speech = value as Partial<LiveSpeech>;
  return (
    typeof speech.id === "string" &&
    typeof speech.text === "string" &&
    typeof speech.audioBase64 === "string" &&
    typeof speech.contentType === "string" &&
    typeof speech.createdAt === "number" &&
    (speech.emotion === "normal" ||
      speech.emotion === "happy" ||
      speech.emotion === "angry" ||
      speech.emotion === "surprised" ||
      speech.emotion === "sad")
  );
};

const readSpeech = async () => {
  try {
    const value = JSON.parse(await readFile(SPEECH_PATH, "utf8")) as unknown;
    return isLiveSpeech(value) ? value : null;
  } catch {
    return null;
  }
};

const sanitizeSourceComment = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<NonNullable<LiveSpeech["sourceComment"]>>;
  if (typeof input.authorName !== "string" || typeof input.message !== "string") return undefined;
  if (!input.authorName.trim() || !input.message.trim()) return undefined;
  return {
    ...(typeof input.id === "string" && input.id.trim() ? { id: input.id.trim() } : {}),
    authorName: input.authorName.trim(),
    message: input.message.trim(),
  };
};

export async function GET() {
  const speech = await readSpeech();
  return NextResponse.json({ speech }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const input = (await request.json().catch(() => null)) as Partial<LiveSpeech> | null;
  const speech: LiveSpeech = {
    id: typeof input?.id === "string" && input.id ? input.id : `${Date.now()}`,
    emotion:
      input?.emotion === "happy" ||
      input?.emotion === "angry" ||
      input?.emotion === "surprised" ||
      input?.emotion === "sad"
        ? input.emotion
        : "normal",
    text: typeof input?.text === "string" ? input.text : "",
    audioBase64: typeof input?.audioBase64 === "string" ? input.audioBase64 : "",
    contentType: typeof input?.contentType === "string" && input.contentType ? input.contentType : "audio/wav",
    sourceComment: sanitizeSourceComment(input?.sourceComment),
    createdAt: Date.now(),
  };

  if (!speech.text || !speech.audioBase64) {
    return NextResponse.json({ error: "発話テキストと音声データが必要です" }, { status: 400 });
  }

  await mkdir(path.dirname(SPEECH_PATH), { recursive: true });
  await writeFile(SPEECH_PATH, `${JSON.stringify(speech, null, 2)}\n`);
  return NextResponse.json({ speech }, { headers: { "Cache-Control": "no-store" } });
}
