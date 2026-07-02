import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

const EMOTIONS = ["normal", "happy", "angry", "surprised", "sad"] as const;
const MOUTH_SPRITE_NAMES = ["closed", "half", "open", "e", "u"] as const;
const VIDEO_EXTENSIONS = [".webm", ".mp4"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const LIVE_ASSET_ROOT = path.resolve("public/live-assets/default");

type Emotion = (typeof EMOTIONS)[number];
type MouthSpriteName = (typeof MOUTH_SPRITE_NAMES)[number];

const isEmotion = (value: unknown): value is Emotion => EMOTIONS.includes(value as Emotion);
const isMouthSpriteName = (value: unknown): value is MouthSpriteName => MOUTH_SPRITE_NAMES.includes(value as MouthSpriteName);

const getSafeExtension = (name: string, fallback: string) => {
  const extension = path.extname(name).toLowerCase();
  return /^[a-z0-9.]+$/.test(extension) ? extension : fallback;
};

const getLatestFileUrl = async (dir: string, baseName: string, extensions: string[], publicPath: string) => {
  try {
    const files = await readdir(dir);
    for (const extension of extensions) {
      const fileName = `${baseName}${extension}`;
      if (!files.includes(fileName)) continue;
      const filePath = path.join(dir, fileName);
      const fileStat = await stat(filePath);
      return `${publicPath}/${fileName}?v=${Math.round(fileStat.mtimeMs)}`;
    }
  } catch {
    return "";
  }

  return "";
};

const removeExistingVariants = async (dir: string, baseName: string, extensions: string[]) => {
  await Promise.all(
    extensions.map(async (extension) => {
      try {
        await unlink(path.join(dir, `${baseName}${extension}`));
      } catch {
        // File may not exist yet.
      }
    }),
  );
};

export async function GET() {
  const assets: Record<string, unknown> = {};

  for (const emotion of EMOTIONS) {
    const emotionDir = path.join(LIVE_ASSET_ROOT, emotion);
    const publicEmotionPath = `/live-assets/default/${emotion}`;
    const videoUrl = await getLatestFileUrl(emotionDir, "video", VIDEO_EXTENSIONS, publicEmotionPath);
    const trackUrl = await getLatestFileUrl(emotionDir, "mouth_track", [".json"], publicEmotionPath);
    const mouthSprites = [];

    for (const name of MOUTH_SPRITE_NAMES) {
      const url = await getLatestFileUrl(path.join(emotionDir, "mouth"), name, IMAGE_EXTENSIONS, `${publicEmotionPath}/mouth`);
      if (url) mouthSprites.push({ name, url });
    }

    assets[emotion] = {
      videoUrl,
      trackUrl,
      mouthSprites,
    };
  }

  return NextResponse.json({ assets }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const emotion = formData.get("emotion");
  const type = formData.get("type");
  const spriteName = formData.get("spriteName");
  const file = formData.get("file");

  if (!isEmotion(emotion)) {
    return NextResponse.json({ error: "invalid emotion" }, { status: 400 });
  }
  if (type !== "video" && type !== "track" && type !== "mouthSprite") {
    return NextResponse.json({ error: "invalid asset type" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  let targetDir = path.join(LIVE_ASSET_ROOT, emotion);
  let targetName = "";

  if (type === "video") {
    const extension = getSafeExtension(file.name, ".webm");
    if (!VIDEO_EXTENSIONS.includes(extension)) {
      return NextResponse.json({ error: "invalid video extension" }, { status: 400 });
    }
    await removeExistingVariants(targetDir, "video", VIDEO_EXTENSIONS);
    targetName = `video${extension}`;
  } else if (type === "track") {
    targetName = "mouth_track.json";
  } else {
    if (!isMouthSpriteName(spriteName)) {
      return NextResponse.json({ error: "invalid sprite name" }, { status: 400 });
    }
    const extension = getSafeExtension(file.name, ".png");
    if (!IMAGE_EXTENSIONS.includes(extension)) {
      return NextResponse.json({ error: "invalid image extension" }, { status: 400 });
    }
    targetDir = path.join(targetDir, "mouth");
    await removeExistingVariants(targetDir, spriteName, IMAGE_EXTENSIONS);
    targetName = `${spriteName}${extension}`;
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, targetName), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
