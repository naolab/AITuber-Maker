import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  defaultPresentationLiveState,
  type PresentationLiveState,
  type PresentationLiveStatus,
} from "@/lib/presentation";

const STATE_PATH = path.join(process.cwd(), ".aituber-presentation-live.json");
const LIVE_STATUSES: PresentationLiveStatus[] = ["idle", "ready", "presenting", "paused", "finished"];

const readState = async () => {
  try {
    const state = JSON.parse(await readFile(STATE_PATH, "utf8")) as Partial<PresentationLiveState>;
    return sanitizeState(state);
  } catch {
    return defaultPresentationLiveState();
  }
};

const text = (value: unknown, maxLength: number) => (typeof value === "string" ? value.slice(0, maxLength) : "");

const sanitizeState = (input: Partial<PresentationLiveState>): PresentationLiveState => ({
  enabled: Boolean(input.enabled),
  status: LIVE_STATUSES.includes(input.status as PresentationLiveStatus) ? input.status as PresentationLiveStatus : "idle",
  projectId: text(input.projectId, 100),
  projectTitle: text(input.projectTitle, 160),
  slideIndex: Math.max(0, Math.floor(Number(input.slideIndex) || 0)),
  slideCount: Math.max(0, Math.floor(Number(input.slideCount) || 0)),
  slideImageUrl: text(input.slideImageUrl, 500),
  caption: text(input.caption, 20_000),
  updatedAt: Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : 0,
});

export async function GET() {
  return NextResponse.json({ state: await readState() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await readState();
  const patch = (await request.json().catch(() => ({}))) as Partial<PresentationLiveState>;
  const state = sanitizeState({ ...current, ...patch, updatedAt: Date.now() });
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  return NextResponse.json({ state }, { headers: { "Cache-Control": "no-store" } });
}
