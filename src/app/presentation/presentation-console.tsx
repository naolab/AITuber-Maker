"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, FileUp, LoaderCircle, Pause, Play, Radio, Save } from "lucide-react";
import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  PresentationProject,
  PresentationProjectListResponse,
  PresentationProjectSummary,
  PresentationLiveState,
} from "@/lib/presentation";

type ProjectResponse = {
  project?: PresentationProject;
  error?: string;
};

type SpeechSettings = {
  ttsType: string;
  aivisUrl: string;
  selectedSpeaker: string;
  aivisCloudApiKey: string;
  aivisCloudModelUuid: string;
  aivisCloudStyleId: string;
  aivisCloudStyleName: string;
  aivisCloudUserDictionaryUuid: string;
  aivisCloudOutputFormat: string;
  aivisCloudSpeakingRate: string;
};

const LIVE_OUTPUT_CHANNEL = "aituber-maker-live-output";

type QueuedPresentationSpeech = {
  id: string;
  slideIndex: number;
  autoAdvance: boolean;
  durationMs: number;
  project: PresentationProject;
  presentationState: PresentationLiveState;
};

const canvasToPng = (canvas: HTMLCanvasElement, fileName: string) =>
  new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("スライド画像の生成に失敗しました"));
        return;
      }
      resolve(new File([blob], fileName, { type: "image/png" }));
    }, "image/png");
  });

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const getSpeechSettings = (): SpeechSettings => ({
  ttsType: localStorage.getItem("tts_type") || "aivis",
  aivisUrl: localStorage.getItem("aivis_url") || "http://127.0.0.1:10101",
  selectedSpeaker: localStorage.getItem("aivis_speaker") || "2",
  aivisCloudApiKey: localStorage.getItem("aivis_cloud_api_key") || "",
  aivisCloudModelUuid: localStorage.getItem("aivis_cloud_model_uuid") || "",
  aivisCloudStyleId: localStorage.getItem("aivis_cloud_style_id") || "0",
  aivisCloudStyleName: localStorage.getItem("aivis_cloud_style_name") || "",
  aivisCloudUserDictionaryUuid: localStorage.getItem("aivis_cloud_user_dictionary_uuid") || "",
  aivisCloudOutputFormat: localStorage.getItem("aivis_cloud_output_format") || "mp3",
  aivisCloudSpeakingRate: localStorage.getItem("aivis_cloud_speaking_rate") || "1.0",
});

const getAudioDurationMs = async (audioBuffer: ArrayBuffer, fallbackSeconds: number) => {
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return fallbackSeconds * 1000;
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(audioBuffer.slice(0));
    return Math.max(500, Math.ceil(decoded.duration * 1000));
  } catch {
    return fallbackSeconds * 1000;
  } finally {
    await context.close();
  }
};

type PresentationConsoleProps = {
  embedded?: boolean;
};

export default function PresentationConsole({ embedded = false }: PresentationConsoleProps) {
  const [projects, setProjects] = useState<PresentationProjectSummary[]>([]);
  const [project, setProject] = useState<PresentationProject | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [status, setStatus] = useState("PDFを選択して発表プロジェクトを作成してください");
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const autoAdvanceTimerRef = useRef(0);
  const queuedPresentationSpeechRef = useRef<QueuedPresentationSpeech | null>(null);
  const autoAdvanceEnabledRef = useRef(false);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/presentations", { cache: "no-store" });
    if (!response.ok) throw new Error("発表プロジェクト一覧を取得できませんでした");
    const data = (await response.json()) as PresentationProjectListResponse;
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadProjects().catch((error) => {
        setStatus(error instanceof Error ? error.message : "発表プロジェクト一覧を取得できませんでした");
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadProjects]);

  useEffect(() => () => {
    if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
  }, []);

  const selectProject = async (projectId: string) => {
    setStatus("発表プロジェクトを読み込み中...");
    const response = await fetch(`/api/presentations?id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const data = (await response.json()) as ProjectResponse;
    if (!response.ok || !data.project) throw new Error(data.error || "発表プロジェクトを読み込めませんでした");
    setProject(data.project);
    setCurrentSlideIndex(0);
    setStatus(`${data.project.slides.length}ページを読み込みました`);
  };

  const handlePdfChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPdfFile(file);
    if (file && !title.trim()) setTitle(file.name.replace(/\.pdf$/i, ""));
  };

  const importPdf = async () => {
    if (!pdfFile || !title.trim() || isImporting) return;
    setIsImporting(true);
    setStatus("PDFを読み込み中...");

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await pdfFile.arrayBuffer()) });
      const document = await loadingTask.promise;
      if (document.numPages > 100) throw new Error("PDFは100ページ以内にしてください");

      const slideFiles: File[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        setStatus(`PDF変換中 ${pageNumber}/${document.numPages}ページ`);
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: "#ffffff" }).promise;
        slideFiles.push(await canvasToPng(canvas, `${String(pageNumber).padStart(3, "0")}.png`));
        page.cleanup();
      }
      await loadingTask.destroy();

      setStatus("発表プロジェクトを保存中...");
      const formData = new FormData();
      formData.set("title", title.trim());
      formData.set("sourcePdf", pdfFile);
      slideFiles.forEach((slide) => formData.append("slides", slide));
      const response = await fetch("/api/presentations", { method: "POST", body: formData });
      const data = (await response.json()) as ProjectResponse;
      if (!response.ok || !data.project) throw new Error(data.error || "発表プロジェクトを保存できませんでした");

      setProject(data.project);
      setCurrentSlideIndex(0);
      setPdfFile(null);
      setTitle("");
      setStatus(`${data.project.slides.length}ページの発表プロジェクトを作成しました`);
      await loadProjects();
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "PDFの取り込みに失敗しました");
    } finally {
      setIsImporting(false);
    }
  };

  const updateCurrentSlide = (patch: Partial<PresentationProject["slides"][number]>) => {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        slides: current.slides.map((slide, index) =>
          index === currentSlideIndex ? { ...slide, ...patch } : slide,
        ),
      };
    });
  };

  const saveProject = async () => {
    if (!project || isSaving) return;
    setIsSaving(true);
    setStatus("原稿とノートを保存中...");
    try {
      const response = await fetch("/api/presentations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const data = (await response.json()) as ProjectResponse;
      if (!response.ok || !data.project) throw new Error(data.error || "保存できませんでした");
      setProject(data.project);
      setStatus("保存しました");
      await loadProjects();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存できませんでした");
    } finally {
      setIsSaving(false);
    }
  };

  const updateLiveState = useCallback(async (patch: Partial<PresentationLiveState>) => {
    const response = await fetch("/api/presentation-live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("OBS用の発表状態を保存できませんでした");
  }, []);

  const showCurrentSlideInLive = async (nextStatus: PresentationLiveState["status"] = "ready") => {
    const activeProject = project;
    const slide = activeProject?.slides[currentSlideIndex];
    if (!activeProject || !slide) throw new Error("発表プロジェクトとスライドを選択してください");
    await updateLiveState({
      enabled: true,
      status: nextStatus,
      projectId: activeProject.id,
      projectTitle: activeProject.title,
      slideIndex: currentSlideIndex,
      slideCount: activeProject.slides.length,
      slideImageUrl: slide.imageUrl,
      caption: slide.script,
    });
  };

  const speakSlide = useCallback(async (slideIndex: number, autoAdvance: boolean) => {
    const activeProject = project;
    const slide = activeProject?.slides[slideIndex];
    if (!activeProject || !slide) return;
    if (!slide.script.trim()) {
      setStatus(`${slide.page}ページ目に読み上げ原稿を入力してください`);
      return;
    }

    if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceEnabledRef.current = autoAdvance;
    setIsSpeaking(true);
    setStatus(`${slide.page}ページ目は、キャラクターの次のループ開始で読み上げます`);

    try {
      const speechSettings = getSpeechSettings();
      const synthResponse = await fetch("/api/aivis/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: slide.script,
          ttsType: speechSettings.ttsType,
          speaker: Number(speechSettings.selectedSpeaker),
          aivisUrl: speechSettings.aivisUrl,
          aivisCloudApiKey: speechSettings.aivisCloudApiKey,
          aivisCloudModelUuid: speechSettings.aivisCloudModelUuid,
          aivisCloudStyleId: speechSettings.aivisCloudStyleId,
          aivisCloudStyleName: speechSettings.aivisCloudStyleName,
          aivisCloudUserDictionaryUuid: speechSettings.aivisCloudUserDictionaryUuid,
          aivisCloudOutputFormat: speechSettings.aivisCloudOutputFormat,
          aivisCloudSpeakingRate: speechSettings.aivisCloudSpeakingRate,
        }),
      });
      if (!synthResponse.ok) {
        const detail = await synthResponse.json().catch(() => ({})) as { error?: string };
        throw new Error(detail.error || "音声合成に失敗しました");
      }

      const contentType = synthResponse.headers.get("content-type") || "audio/wav";
      const audioBuffer = await synthResponse.arrayBuffer();
      const speechId = crypto.randomUUID();
      const liveAudioBuffer = audioBuffer.slice(0);
      const durationMs = await getAudioDurationMs(audioBuffer, slide.expectedDurationSeconds);
      const presentationState: PresentationLiveState = {
        enabled: true,
        status: "presenting",
        projectId: activeProject.id,
        projectTitle: activeProject.title,
        slideIndex,
        slideCount: activeProject.slides.length,
        slideImageUrl: slide.imageUrl,
        caption: slide.script,
        updatedAt: Date.now(),
      };
      queuedPresentationSpeechRef.current = { id: speechId, slideIndex, autoAdvance, durationMs, project: activeProject, presentationState };
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel(LIVE_OUTPUT_CHANNEL);
        channel.postMessage({ type: "speech", id: speechId, emotion: "normal", text: slide.script, audioBuffer: liveAudioBuffer, presentationState });
        channel.close();
      }

      const liveResponse = await fetch("/api/live-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: speechId,
          emotion: "normal",
          text: slide.script,
          audioBase64: arrayBufferToBase64(liveAudioBuffer),
          contentType,
        }),
      });
      if (!liveResponse.ok) throw new Error("OBS出力へ読み上げを送信できませんでした");

      setStatus(`${slide.page}ページ目の読み上げ開始を待っています`);
    } catch (error) {
      queuedPresentationSpeechRef.current = null;
      setIsSpeaking(false);
      await updateLiveState({ status: "paused" }).catch(() => {});
      setStatus(error instanceof Error ? error.message : "読み上げを開始できませんでした");
    }
  }, [project, updateLiveState]);

  const stopAutoAdvance = async () => {
    if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceTimerRef.current = 0;
    autoAdvanceEnabledRef.current = false;
    setIsSpeaking(false);
    await updateLiveState({ status: "paused" });
    setStatus("自動進行を停止しました。再生中の音声はOBS側で最後まで再生されます。");
  };

  const handleSpeechStarted = useCallback((speechId: string) => {
    const queuedSpeech = queuedPresentationSpeechRef.current;
    if (!queuedSpeech || queuedSpeech.id !== speechId) return;

    queuedPresentationSpeechRef.current = null;
    const { project: activeProject, slideIndex, autoAdvance, durationMs, presentationState } = queuedSpeech;
    const slide = activeProject.slides[slideIndex];
    if (!slide) return;

    setCurrentSlideIndex(slideIndex);
    setStatus(`${slide.page}ページ目を読み上げ中`);
    void updateLiveState(presentationState);

    autoAdvanceTimerRef.current = window.setTimeout(() => {
      const nextSlideIndex = slideIndex + 1;
      setIsSpeaking(false);
      if (autoAdvance && autoAdvanceEnabledRef.current && nextSlideIndex < activeProject.slides.length) {
        void speakSlide(nextSlideIndex, true);
        return;
      }
      void updateLiveState({ status: nextSlideIndex >= activeProject.slides.length ? "finished" : "paused" });
      setStatus(nextSlideIndex >= activeProject.slides.length ? "発表が終了しました。質疑応答を開始できます。" : "読み上げが完了しました");
    }, durationMs + 250);
  }, [speakSlide, updateLiveState]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(LIVE_OUTPUT_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ type?: string; id?: string }>) => {
      if (event.data?.type === "speech-started" && event.data.id) {
        handleSpeechStarted(event.data.id);
      }
    };
    return () => channel.close();
  }, [handleSpeechStarted]);

  const currentSlide = project?.slides[currentSlideIndex] ?? null;
  const completedScripts = useMemo(
    () => project?.slides.filter((slide) => slide.script.trim()).length ?? 0,
    [project],
  );

  return (
    <div className={embedded ? "text-slate-900" : "min-h-screen bg-[#f7f8fb] text-slate-900"}>
      {!embedded && <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="grid size-9 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="AITuber Makerへ戻る">
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <h1 className="text-lg font-bold">ゼミ発表コンソール</h1>
              <p className="text-xs text-slate-500">PDF・原稿・発表進行を管理</p>
            </div>
          </div>
          <div className="text-sm text-slate-500">{status}</div>
        </div>
      </header>}

      <div className={`grid grid-cols-[300px_minmax(0,1fr)_420px] gap-4 max-xl:grid-cols-[260px_minmax(0,1fr)] max-xl:[&>aside:last-child]:col-span-2 ${embedded ? "w-full" : "mx-auto max-w-[1600px] p-4"}`}>
        <aside className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-bold">発表プロジェクト</h2>
          <div className="mt-3 grid gap-2">
            {projects.length === 0 && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">まだプロジェクトがありません。</p>}
            {projects.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectProject(item.id).catch((error) => setStatus(error instanceof Error ? error.message : "読み込みに失敗しました"))}
                className={`rounded-md border p-3 text-left ${project?.id === item.id ? "border-teal-500 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <span className="block truncate text-sm font-semibold">{item.title}</span>
                <span className="mt-1 block text-xs text-slate-500">{item.slideCount}ページ · {item.sourcePdfName}</span>
              </button>
            ))}
          </div>

          <div className="my-5 h-px bg-slate-200" />
          <h2 className="font-bold">PDFから作成</h2>
          <div className="mt-3 grid gap-3">
            <input className="rounded-md border border-slate-200 px-3 py-2 text-sm" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="発表タイトル" />
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm font-semibold hover:bg-slate-50">
              <FileUp className="size-4" />
              {pdfFile?.name || "PDFを選択"}
              <input className="sr-only" type="file" accept="application/pdf,.pdf" onChange={handlePdfChange} />
            </label>
            <button type="button" disabled={!pdfFile || !title.trim() || isImporting} onClick={() => void importPdf()} className="flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">
              {isImporting ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              プロジェクト作成
            </button>
          </div>
        </aside>

        <section className="min-h-[calc(100vh-112px)] rounded-lg border border-slate-200 bg-white p-4">
          {currentSlide ? (
            <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold">{project?.title}</h2>
                  <p className="text-xs text-slate-500">原稿入力済み {completedScripts}/{project?.slides.length}ページ · 想定 {project?.slides.reduce((sum, slide) => sum + slide.expectedDurationSeconds, 0)}秒</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => void showCurrentSlideInLive().then(() => setStatus("OBS出力に現在のスライドを表示しました")).catch((error) => setStatus(error instanceof Error ? error.message : "OBS出力へ表示できませんでした"))} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50">
                    <Radio className="size-4" />
                    OBSに表示
                  </button>
                  <button type="button" onClick={() => void speakSlide(currentSlideIndex, false)} disabled={isSpeaking || !currentSlide.script.trim()} className="flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 disabled:opacity-50">
                    <Play className="size-4" />
                    このページを話す
                  </button>
                  <button type="button" onClick={() => void speakSlide(currentSlideIndex, project?.settings.autoAdvance ?? false)} disabled={isSpeaking || !currentSlide.script.trim()} className="flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300">
                    <Play className="size-4" />
                    発表開始
                  </button>
                  {isSpeaking && <button type="button" onClick={() => void stopAutoAdvance().catch((error) => setStatus(error instanceof Error ? error.message : "停止できませんでした"))} className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                    <Pause className="size-4" />
                    自動進行を停止
                  </button>}
                  <button type="button" onClick={() => void saveProject()} disabled={isSaving} className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400">
                    {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                    保存
                  </button>
                </div>
              </div>
              <div className="grid place-items-center overflow-hidden rounded-md bg-slate-950 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={currentSlide.imageUrl} alt={`スライド ${currentSlide.page}`} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex items-center justify-center gap-4">
                <button type="button" disabled={currentSlideIndex === 0} onClick={() => setCurrentSlideIndex((index) => Math.max(0, index - 1))} className="grid size-10 place-items-center rounded-md border border-slate-200 disabled:text-slate-300">
                  <ChevronLeft className="size-5" />
                </button>
                <span className="min-w-28 text-center text-sm font-bold">{currentSlideIndex + 1} / {project?.slides.length}</span>
                <button type="button" disabled={!project || currentSlideIndex >= project.slides.length - 1} onClick={() => setCurrentSlideIndex((index) => Math.min((project?.slides.length ?? 1) - 1, index + 1))} className="grid size-10 place-items-center rounded-md border border-slate-200 disabled:text-slate-300">
                  <ChevronRight className="size-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center text-center text-slate-500">
              <div><FileUp className="mx-auto mb-3 size-10" /><p className="font-semibold">既存プロジェクトを選ぶか、PDFから作成してください</p></div>
            </div>
          )}
        </section>

        <aside className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-bold">スライド原稿</h2>
          {currentSlide ? (
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold">
                読み上げ原稿
                <textarea value={currentSlide.script} onChange={(event) => updateCurrentSlide({ script: event.target.value })} className="min-h-48 resize-y rounded-md border border-slate-200 p-3 font-normal leading-relaxed" placeholder="AITuberが読み上げる原稿を入力" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                質疑応答用ノート
                <textarea value={currentSlide.notes} onChange={(event) => updateCurrentSlide({ notes: event.target.value })} className="min-h-36 resize-y rounded-md border border-slate-200 p-3 font-normal leading-relaxed" placeholder="回答の根拠になる補足情報を入力" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                想定時間（秒）
                <input type="number" min="1" max="3600" value={currentSlide.expectedDurationSeconds} onChange={(event) => updateCurrentSlide({ expectedDurationSeconds: Number(event.target.value) || 30 })} className="rounded-md border border-slate-200 px-3 py-2 font-normal" />
              </label>
              <label className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold">
                自動で次へ進む
                <input type="checkbox" checked={project?.settings.autoAdvance ?? false} onChange={(event) => setProject((current) => current ? { ...current, settings: { ...current.settings, autoAdvance: event.target.checked } } : current)} className="size-4 accent-teal-600" />
              </label>
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">プロジェクトを選択すると編集できます。</p>}
        </aside>
      </div>
    </div>
  );
}
