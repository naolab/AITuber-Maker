import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import type { PresentationLiveState } from "@/lib/presentation";

type LiveSpeechStatus = "queued" | "started" | "ended";

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
  presentationState?: PresentationLiveState;
  status: LiveSpeechStatus;
  startedAt: number;
  endedAt: number;
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
    (speech.status === "queued" || speech.status === "started" || speech.status === "ended") &&
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

const sanitizePresentationState = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<PresentationLiveState>;
  if (typeof state.projectId !== "string" || typeof state.slideImageUrl !== "string") return undefined;
  return state as PresentationLiveState;
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
    presentationState: sanitizePresentationState(input?.presentationState),
    status: "queued",
    startedAt: 0,
    endedAt: 0,
    createdAt: Date.now(),
  };

  if (!speech.text || !speech.audioBase64) {
    return NextResponse.json({ error: "発話テキストと音声データが必要です" }, { status: 400 });
  }

  await mkdir(path.dirname(SPEECH_PATH), { recursive: true });
  await writeFile(SPEECH_PATH, `${JSON.stringify(speech, null, 2)}\n`);
  return NextResponse.json({ speech }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const input = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = typeof input?.id === "string" ? input.id : "";
  const status = input?.status;
  if (!id || (status !== "started" && status !== "ended")) {
    return NextResponse.json({ error: "発話状態の情報が不正です" }, { status: 400 });
  }
  const speech = await readSpeech();
  if (!speech || speech.id !== id) return NextResponse.json({ error: "対象の発話が見つかりません" }, { status: 404 });
  if (speech.status === "ended" && status === "started") {
    return NextResponse.json({ speech }, { headers: { "Cache-Control": "no-store" } });
  }
  const now = Date.now();
  const updated: LiveSpeech = {
    ...speech,
    status,
    startedAt: status === "started" ? now : speech.startedAt,
    endedAt: status === "ended" ? now : speech.endedAt,
  };
  await writeFile(SPEECH_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  return NextResponse.json({ speech: updated }, { headers: { "Cache-Control": "no-store" } });
}
