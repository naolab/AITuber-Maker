import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import type { PresentationProject } from "@/lib/presentation";

const ROOT = path.join(process.cwd(), "public", "presentation-projects");
const isSafeProjectId = (value: string) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim() || "";
  if (!isSafeProjectId(id)) return NextResponse.json({ error: "発表プロジェクトIDが不正です" }, { status: 400 });
  try {
    const directory = path.join(ROOT, id);
    const [raw, knowledge, qa] = await Promise.all([
      readFile(path.join(directory, "presentation.json"), "utf8"),
      readFile(path.join(directory, "knowledge.md"), "utf8").catch(() => ""),
      readFile(path.join(directory, "qa.md"), "utf8").catch(() => ""),
    ]);
    const project = JSON.parse(raw) as PresentationProject;
    const slides = project.slides.map((slide) => `## スライド ${slide.page}\n原稿: ${slide.script}\nノート: ${slide.notes}`).join("\n\n");
    const context = [`# 発表: ${project.title}`, slides, `# 発表全体の知識\n${knowledge}`, `# 想定Q&A\n${qa}`].join("\n\n").slice(0, 160_000);
    return NextResponse.json({ projectId: id, context }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "発表プロジェクトが見つかりません" }, { status: 404 });
  }
}
