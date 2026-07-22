import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import type { PreparedSpeechManifest, PresentationProject } from "@/lib/presentation";

type PlaybackStatus = "idle" | "queued" | "playing" | "finished" | "stopped";
type PlaybackSegment = {
  id: string;
  slideIndex: number;
  paragraphIndex: number;
  text: string;
  emotion: "normal" | "happy" | "angry" | "surprised" | "sad";
  audioUrl: string;
  contentType: string;
  projectId: string;
  projectTitle: string;
  slideCount: number;
  slideImageUrl: string;
};
type PlaybackState = {
  status: PlaybackStatus;
  currentIndex: number;
  segments: PlaybackSegment[];
  updatedAt: number;
};

const ROOT = path.join(process.cwd(), "public", "presentation-projects");
const STATE_PATH = path.join(process.cwd(), ".aituber-presentation-playback.json");
const safeId = (value: string) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").trim();
const paragraphs = (script: string) => script.split(/\r?\n\s*\r?\n+/).map((item) => item.trim()).filter(Boolean);
const emptyState = (): PlaybackState => ({ status: "idle", currentIndex: 0, segments: [], updatedAt: Date.now() });

const readState = async () => {
  try {
    const state = JSON.parse(await readFile(STATE_PATH, "utf8")) as PlaybackState;
    if (!Array.isArray(state.segments) || !Number.isInteger(state.currentIndex)) return emptyState();
    return state;
  } catch {
    return emptyState();
  }
};

const writeState = async (state: PlaybackState) => {
  const updated = { ...state, updatedAt: Date.now() };
  await writeFile(STATE_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
};

const response = (state: PlaybackState) => NextResponse.json({
  state,
  segment: state.status === "queued" || state.status === "playing" ? state.segments[state.currentIndex] ?? null : null,
}, { headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return response(await readState());
}

export async function POST(request: Request) {
  const input = (await request.json().catch(() => null)) as { projectId?: unknown; startSlideIndex?: unknown; mode?: unknown } | null;
  const projectId = typeof input?.projectId === "string" ? input.projectId : "";
  const startSlideIndex = Number(input?.startSlideIndex);
  const mode = input?.mode === "slide" ? "slide" : "from-slide";
  if (!safeId(projectId) || !Number.isInteger(startSlideIndex) || startSlideIndex < 0) {
    return NextResponse.json({ error: "発表開始情報が不正です" }, { status: 400 });
  }
  try {
    const projectPath = path.join(ROOT, projectId, "presentation.json");
    const manifestPath = path.join(ROOT, projectId, "speech-manifest.json");
    const project = JSON.parse(await readFile(projectPath, "utf8")) as PresentationProject;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PreparedSpeechManifest;
    const endSlideIndex = mode === "slide" ? startSlideIndex : project.slides.length - 1;
    const segments: PlaybackSegment[] = [];
    for (let slideIndex = startSlideIndex; slideIndex <= endSlideIndex; slideIndex += 1) {
      const slide = project.slides[slideIndex];
      if (!slide) continue;
      for (const [paragraphIndex, text] of paragraphs(slide.script).entries()) {
        const prepared = manifest.entries.find((entry) => entry.slideIndex === slideIndex && entry.paragraphIndex === paragraphIndex && normalizeText(entry.text) === normalizeText(text));
        if (!prepared) return NextResponse.json({ error: `${slide.page}ページ目・段落 ${paragraphIndex + 1} の音声が未準備です。「発表を準備」を実行してください。` }, { status: 409 });
        segments.push({
          id: `${project.id}:${slideIndex}:${paragraphIndex}:${Date.now()}`,
          slideIndex,
          paragraphIndex,
          text,
          emotion: prepared.emotion,
          audioUrl: prepared.audioUrl,
          contentType: prepared.contentType,
          projectId: project.id,
          projectTitle: project.title,
          slideCount: project.slides.length,
          slideImageUrl: slide.imageUrl,
        });
      }
    }
    if (!segments.length) return NextResponse.json({ error: "読み上げ原稿がありません" }, { status: 409 });
    return response(await writeState({ status: "queued", currentIndex: 0, segments, updatedAt: Date.now() }));
  } catch {
    return NextResponse.json({ error: "発表準備データを読み込めませんでした" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const input = (await request.json().catch(() => null)) as { action?: unknown; segmentId?: unknown } | null;
  const action = input?.action;
  const segmentId = typeof input?.segmentId === "string" ? input.segmentId : "";
  const state = await readState();
  if (action === "stop") return response(await writeState({ ...state, status: "stopped" }));
  const current = state.segments[state.currentIndex];
  if (!current || current.id !== segmentId) return response(state);
  if (action === "started" && state.status === "queued") return response(await writeState({ ...state, status: "playing" }));
  if (action === "ended" && (state.status === "queued" || state.status === "playing")) {
    const nextIndex = state.currentIndex + 1;
    return response(await writeState({ ...state, currentIndex: nextIndex, status: nextIndex >= state.segments.length ? "finished" : "queued" }));
  }
  return response(state);
}
