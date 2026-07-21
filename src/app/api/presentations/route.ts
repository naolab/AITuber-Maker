import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import type { PresentationProject, PresentationProjectSummary } from "@/lib/presentation";

const PRESENTATION_ROOT = path.join(process.cwd(), "public", "presentation-projects");
const MAX_SLIDES = 100;
const MAX_SLIDE_BYTES = 12 * 1024 * 1024;

const isSafeProjectId = (value: string) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);

const sanitizeTitle = (value: unknown) => {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, 120) || "名称未設定の発表";
};

const createProjectId = (title: string) => {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "presentation"}-${randomUUID().slice(0, 8)}`;
};

const readProject = async (projectId: string) => {
  if (!isSafeProjectId(projectId)) return null;
  try {
    const projectDir = path.join(PRESENTATION_ROOT, projectId);
    const [raw, knowledge, qa] = await Promise.all([
      readFile(path.join(projectDir, "presentation.json"), "utf8"),
      readFile(path.join(projectDir, "knowledge.md"), "utf8").catch(() => ""),
      readFile(path.join(projectDir, "qa.md"), "utf8").catch(() => ""),
    ]);
    return { ...(JSON.parse(raw) as PresentationProject), knowledge, qa };
  } catch {
    return null;
  }
};

const toSummary = (project: PresentationProject): PresentationProjectSummary => ({
  id: project.id,
  title: project.title,
  sourcePdfName: project.sourcePdfName,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  slideCount: project.slides.length,
});

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("id")?.trim();
  if (projectId) {
    const project = await readProject(projectId);
    if (!project) return NextResponse.json({ error: "発表プロジェクトが見つかりません" }, { status: 404 });
    return NextResponse.json({ project }, { headers: { "Cache-Control": "no-store" } });
  }

  await mkdir(PRESENTATION_ROOT, { recursive: true });
  const entries = await readdir(PRESENTATION_ROOT, { withFileTypes: true });
  const projects = (
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readProject(entry.name)))
  )
    .filter((project): project is PresentationProject => Boolean(project))
    .map(toSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json({ projects }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const title = sanitizeTitle(formData.get("title"));
  const sourcePdf = formData.get("sourcePdf");
  const slides = formData.getAll("slides").filter((value): value is File => value instanceof File);

  if (!(sourcePdf instanceof File) || sourcePdf.type !== "application/pdf") {
    return NextResponse.json({ error: "PDFファイルが必要です" }, { status: 400 });
  }
  if (slides.length === 0 || slides.length > MAX_SLIDES) {
    return NextResponse.json({ error: `スライドは1〜${MAX_SLIDES}ページにしてください` }, { status: 400 });
  }
  if (slides.some((slide) => slide.type !== "image/png" || slide.size > MAX_SLIDE_BYTES)) {
    return NextResponse.json({ error: "変換済みスライドの形式またはサイズが不正です" }, { status: 400 });
  }

  const projectId = createProjectId(title);
  const projectDir = path.join(PRESENTATION_ROOT, projectId);
  const slideDir = path.join(projectDir, "slides");
  await mkdir(slideDir, { recursive: true });
  await writeFile(path.join(projectDir, "source.pdf"), Buffer.from(await sourcePdf.arrayBuffer()));

  const createdAt = new Date().toISOString();
  const project: PresentationProject = {
    id: projectId,
    title,
    sourcePdfName: sourcePdf.name,
    createdAt,
    updatedAt: createdAt,
    settings: {
      autoAdvance: false,
      showCaptions: true,
      questionPolicy: "manual",
    },
    slides: [],
    knowledge: "# 発表全体の補足知識\n",
    qa: "# 想定質問と回答\n",
  };

  for (let index = 0; index < slides.length; index += 1) {
    const fileName = `${String(index + 1).padStart(3, "0")}.png`;
    await writeFile(path.join(slideDir, fileName), Buffer.from(await slides[index].arrayBuffer()));
    project.slides.push({
      id: `slide-${index + 1}`,
      page: index + 1,
      imageUrl: `/presentation-projects/${projectId}/slides/${fileName}`,
      script: "",
      notes: "",
      expectedDurationSeconds: 30,
    });
  }

  await writeFile(path.join(projectDir, "knowledge.md"), project.knowledge);
  await writeFile(path.join(projectDir, "qa.md"), project.qa);
  await writeFile(path.join(projectDir, "presentation.json"), `${JSON.stringify(project, null, 2)}\n`);

  return NextResponse.json({ project }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const input = (await request.json().catch(() => null)) as { project?: PresentationProject } | null;
  const project = input?.project;
  if (!project || !isSafeProjectId(project.id)) {
    return NextResponse.json({ error: "発表プロジェクトが不正です" }, { status: 400 });
  }

  const current = await readProject(project.id);
  if (!current) return NextResponse.json({ error: "発表プロジェクトが見つかりません" }, { status: 404 });
  if (!Array.isArray(project.slides) || project.slides.length !== current.slides.length) {
    return NextResponse.json({ error: "スライド構成が不正です" }, { status: 400 });
  }

  const updated: PresentationProject = {
    ...current,
    title: sanitizeTitle(project.title),
    updatedAt: new Date().toISOString(),
    settings: {
      autoAdvance: Boolean(project.settings?.autoAdvance),
      showCaptions: project.settings?.showCaptions !== false,
      questionPolicy: "manual",
    },
    slides: current.slides.map((slide, index) => ({
      ...slide,
      script: typeof project.slides[index]?.script === "string" ? project.slides[index].script.slice(0, 20_000) : "",
      notes: typeof project.slides[index]?.notes === "string" ? project.slides[index].notes.slice(0, 40_000) : "",
      expectedDurationSeconds: Math.min(
        3600,
        Math.max(1, Math.round(Number(project.slides[index]?.expectedDurationSeconds) || 30)),
      ),
    })),
    knowledge: typeof project.knowledge === "string" ? project.knowledge.slice(0, 100_000) : "",
    qa: typeof project.qa === "string" ? project.qa.slice(0, 100_000) : "",
  };

  await writeFile(path.join(PRESENTATION_ROOT, updated.id, "presentation.json"), `${JSON.stringify(updated, null, 2)}\n`);
  await writeFile(path.join(PRESENTATION_ROOT, updated.id, "knowledge.md"), updated.knowledge);
  await writeFile(path.join(PRESENTATION_ROOT, updated.id, "qa.md"), updated.qa);
  return NextResponse.json({ project: updated }, { headers: { "Cache-Control": "no-store" } });
}
