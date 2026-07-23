import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

type OverlayLayout = {
  x: number;
  y: number;
  scale: number;
};

type LiveSettings = {
  bgType: "color" | "image";
  bgColor: string;
  youtubeApiKey: string;
  youtubeVideoId: string;
  youtubeLiveChatId: string;
  youtubeChatEnabled: boolean;
  captionsEnabled: boolean;
  youtubeChatWidth: number;
  youtubeChatStatusVisible: boolean;
  youtubeChatVisibleCount: number;
  characterLayout: OverlayLayout;
  chatLayout: OverlayLayout;
};

const DEFAULT_SETTINGS: LiveSettings = {
  bgType: "color",
  bgColor: "#ffffff",
  youtubeApiKey: "",
  youtubeVideoId: "",
  youtubeLiveChatId: "",
  youtubeChatEnabled: false,
  captionsEnabled: true,
  youtubeChatWidth: 360,
  youtubeChatStatusVisible: true,
  youtubeChatVisibleCount: 10,
  characterLayout: { x: 0, y: 0, scale: 1 },
  chatLayout: { x: 0, y: 0, scale: 1 },
};

const SETTINGS_PATH = path.resolve(".aituber-live-settings.json");

const isLayout = (value: unknown): value is OverlayLayout => {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<OverlayLayout>;
  return Number.isFinite(layout.x) && Number.isFinite(layout.y) && Number.isFinite(layout.scale);
};

const sanitizeLayout = (value: unknown, fallback: OverlayLayout) => {
  if (!isLayout(value)) return fallback;
  return {
    x: value.x,
    y: value.y,
    scale: Math.min(Math.max(value.scale, 0.2), 5),
  };
};

const sanitizeSettings = (value: unknown): LiveSettings => {
  const input = value && typeof value === "object" ? (value as Partial<LiveSettings>) : {};
  return {
    bgType: input.bgType === "image" ? "image" : "color",
    bgColor: typeof input.bgColor === "string" && input.bgColor ? input.bgColor : DEFAULT_SETTINGS.bgColor,
    youtubeApiKey: typeof input.youtubeApiKey === "string" ? input.youtubeApiKey : "",
    youtubeVideoId: typeof input.youtubeVideoId === "string" ? input.youtubeVideoId : "",
    youtubeLiveChatId: typeof input.youtubeLiveChatId === "string" ? input.youtubeLiveChatId : "",
    youtubeChatEnabled: Boolean(input.youtubeChatEnabled),
    captionsEnabled: input.captionsEnabled !== false,
    youtubeChatWidth: Math.min(640, Math.max(240, Math.round(Number(input.youtubeChatWidth) || DEFAULT_SETTINGS.youtubeChatWidth))),
    youtubeChatStatusVisible: input.youtubeChatStatusVisible !== false,
    youtubeChatVisibleCount: Math.min(30, Math.max(1, Math.round(Number(input.youtubeChatVisibleCount) || DEFAULT_SETTINGS.youtubeChatVisibleCount))),
    characterLayout: sanitizeLayout(input.characterLayout, DEFAULT_SETTINGS.characterLayout),
    chatLayout: sanitizeLayout(input.chatLayout, DEFAULT_SETTINGS.chatLayout),
  };
};

const readSettings = async () => {
  try {
    return sanitizeSettings(JSON.parse(await readFile(SETTINGS_PATH, "utf8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const writeSettings = async (settings: LiveSettings) => {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
};

export async function GET() {
  return NextResponse.json(await readSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await readSettings();
  const patch = (await request.json().catch(() => ({}))) as Partial<LiveSettings>;
  const next = sanitizeSettings({ ...current, ...patch });
  await writeSettings(next);
  return NextResponse.json(next, { headers: { "Cache-Control": "no-store" } });
}
