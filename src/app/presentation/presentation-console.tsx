"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, FileUp, LoaderCircle, Pause, Play, Radio, Save, Volume2 } from "lucide-react";
import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  PresentationProject,
  PresentationProjectListResponse,
  PresentationProjectSummary,
  PresentationLiveState,
  PreparedSpeechManifest,
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
  localSpeakingRate: string;
  openaiApiKey: string;
  openaiModel: string;
};

const LIVE_OUTPUT_CHANNEL = "aituber-maker-live-output";
type Emotion = "normal" | "happy" | "angry" | "surprised" | "sad";
type PreparedParagraph = { text: string; emotion: Emotion; audioBuffer: ArrayBuffer; contentType: string; durationMs: number };

type QueuedPresentationSpeech = {
  id: string;
  slideIndex: number;
  autoAdvance: boolean;
  durationMs: number;
  project: PresentationProject;
  presentationState: PresentationLiveState;
  paragraphs: PreparedParagraph[];
  paragraphIndex: number;
};

type LiveSpeechProgress = {
  id: string;
  status?: "queued" | "started" | "ended";
};

type PresentationPlaybackProgress = {
  state?: { status?: "idle" | "queued" | "playing" | "finished" | "stopped" };
  segment?: { slideIndex?: number } | null;
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
  localSpeakingRate: localStorage.getItem("local_speaking_rate") || "1.0",
  openaiApiKey: localStorage.getItem("openai_api_key") || "",
  openaiModel: localStorage.getItem("openai_model") || "gpt-4o-mini",
});

const resolvePresentationEmotion = async (script: string, settings: SpeechSettings): Promise<Emotion> => {
  if (!settings.openaiApiKey) return "normal";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.openaiApiKey}` },
      body: JSON.stringify({
        model: settings.openaiModel,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "次の発表原稿に最も合う感情を1つ選び、JSONで返してください。emotionの値は「通常」「嬉しい」「怒り」「驚き」「悲しい」のいずれかだけにしてください。ゼミ発表では落ち着いた説明は通常を優先し、明確な強調や驚きがある場合のみ他の感情を選んでください。返答本文は不要です。",
          },
          { role: "user", content: script },
        ],
      }),
    });
    if (!response.ok) return "normal";
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const emotion = JSON.parse(data.choices?.[0]?.message?.content || "{}").emotion;
    if (emotion === "嬉しい") return "happy";
    if (emotion === "怒り") return "angry";
    if (emotion === "驚き") return "surprised";
    if (emotion === "悲しい") return "sad";
  } catch {
    // 感情判定に失敗しても、発表は通常モーションで続行する。
  }
  return "normal";
};

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

const splitIntoParagraphs = (script: string) => script.split(/\r?\n\s*\r?\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
const normalizeScriptText = (text: string) => text.replace(/\r\n?/g, "\n").trim();

const synthesizeSpeech = async (text: string, settings: SpeechSettings) => {
  const response = await fetch("/api/aivis/synthesis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      ttsType: settings.ttsType,
      speaker: Number(settings.selectedSpeaker),
      aivisUrl: settings.aivisUrl,
      aivisCloudApiKey: settings.aivisCloudApiKey,
      aivisCloudModelUuid: settings.aivisCloudModelUuid,
      aivisCloudStyleId: settings.aivisCloudStyleId,
      aivisCloudStyleName: settings.aivisCloudStyleName,
      aivisCloudUserDictionaryUuid: settings.aivisCloudUserDictionaryUuid,
      aivisCloudOutputFormat: settings.aivisCloudOutputFormat,
      aivisCloudSpeakingRate: settings.aivisCloudSpeakingRate,
      localSpeakingRate: settings.localSpeakingRate,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error || "音声合成に失敗しました");
  }
  return {
    audioBuffer: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || "audio/wav",
  };
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
  const [replacementPdfFile, setReplacementPdfFile] = useState<File | null>(null);
  const [status, setStatus] = useState("PDFを選択して発表プロジェクトを作成してください");
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [preparedSpeech, setPreparedSpeech] = useState<PreparedSpeechManifest | null>(null);
  const autoAdvanceTimerRef = useRef(0);
  const queuedPresentationSpeechRef = useRef<QueuedPresentationSpeech | null>(null);
  const activePresentationSpeechRef = useRef<QueuedPresentationSpeech | null>(null);
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
    const audioResponse = await fetch(`/api/presentation-audio?id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const audioData = (await audioResponse.json()) as { manifest?: PreparedSpeechManifest };
    setPreparedSpeech(audioData.manifest ?? null);
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
      setPreparedSpeech({ projectId: data.project.id, preparedAt: "", entries: [] });
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

  const replaceProjectPdf = async () => {
    if (!project || !replacementPdfFile || isImporting) return;
    setIsImporting(true);
    setStatus("更新用PDFを読み込み中...");
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await replacementPdfFile.arrayBuffer()) });
      const document = await loadingTask.promise;
      if (document.numPages > 100) throw new Error("PDFは100ページ以内にしてください");
      const slideFiles: File[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        setStatus(`更新PDF変換中 ${pageNumber}/${document.numPages}ページ`);
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
      const formData = new FormData();
      formData.set("id", project.id);
      formData.set("sourcePdf", replacementPdfFile);
      slideFiles.forEach((slide) => formData.append("slides", slide));
      const response = await fetch("/api/presentations", { method: "PATCH", body: formData });
      const data = (await response.json()) as ProjectResponse;
      if (!response.ok || !data.project) throw new Error(data.error || "PDFを更新できませんでした");
      setProject(data.project);
      setPreparedSpeech(null);
      setCurrentSlideIndex((index) => Math.min(index, data.project!.slides.length - 1));
      setReplacementPdfFile(null);
      setStatus(`PDFを更新しました。${data.project.slides.length}ページです（同じページ番号の原稿・ノートは保持）。`);
      await loadProjects();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDFの更新に失敗しました");
    } finally {
      setIsImporting(false);
    }
  };

  const deleteProject = async () => {
    if (!project) return;
    const response = await fetch(`/api/presentations?id=${encodeURIComponent(project.id)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error || "プロジェクトを削除できませんでした");
    }
    setProject(null);
    setPreparedSpeech(null);
    setCurrentSlideIndex(0);
    setIsDeleteConfirming(false);
    setStatus("プロジェクトを削除しました");
    await loadProjects();
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

  const loadPreparedParagraphs = useCallback(async (activeProject: PresentationProject, slideIndex: number, texts: string[]) => {
    const entries = preparedSpeech?.projectId === activeProject.id ? preparedSpeech.entries : [];
    const matchingEntries = texts.map((text, paragraphIndex) => entries.find((entry) =>
      entry.slideIndex === slideIndex && entry.paragraphIndex === paragraphIndex && normalizeScriptText(entry.text) === normalizeScriptText(text),
    ));
    if (matchingEntries.some((entry) => !entry)) return null;

    return Promise.all(matchingEntries.map(async (entry) => {
      const response = await fetch(entry!.audioUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("準備済み音声を読み込めませんでした。発表を準備し直してください");
      return {
        text: entry!.text,
        emotion: entry!.emotion,
        audioBuffer: await response.arrayBuffer(),
        contentType: entry!.contentType,
        durationMs: entry!.durationMs,
      } satisfies PreparedParagraph;
    }));
  }, [preparedSpeech]);

  const prepareProjectSpeech = async () => {
    const activeProject = project;
    if (!activeProject || isPreparingSpeech) return;
    const targets = activeProject.slides.flatMap((slide, slideIndex) =>
      splitIntoParagraphs(slide.script).map((text, paragraphIndex) => ({ slide, slideIndex, text, paragraphIndex })),
    );
    if (targets.length === 0) {
      setStatus("読み上げ原稿を入力してから発表を準備してください");
      return;
    }

    setIsPreparingSpeech(true);
    try {
      const settings = getSpeechSettings();
      for (const [index, target] of targets.entries()) {
        setStatus(`発表を準備中 ${index + 1}/${targets.length}（${target.slide.page}ページ目・段落 ${target.paragraphIndex + 1}）`);
        const emotion = await resolvePresentationEmotion(target.text, settings);
        const { audioBuffer, contentType } = await synthesizeSpeech(target.text, settings);
        const durationMs = await getAudioDurationMs(audioBuffer, Math.max(1, Math.round(target.slide.expectedDurationSeconds / splitIntoParagraphs(target.slide.script).length)));
        const formData = new FormData();
        formData.set("projectId", activeProject.id);
        formData.set("slideIndex", String(target.slideIndex));
        formData.set("paragraphIndex", String(target.paragraphIndex));
        formData.set("text", target.text);
        formData.set("emotion", emotion);
        formData.set("durationMs", String(durationMs));
        formData.set("audio", new File([audioBuffer], "speech", { type: contentType }));
        const response = await fetch("/api/presentation-audio", { method: "POST", body: formData });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(detail.error || "準備済み音声を保存できませんでした");
        }
      }
      const response = await fetch(`/api/presentation-audio?id=${encodeURIComponent(activeProject.id)}`, { cache: "no-store" });
      const data = (await response.json()) as { manifest?: PreparedSpeechManifest };
      setPreparedSpeech(data.manifest ?? null);
      setStatus(`${targets.length}段落の音声を準備しました。本番ではOpenAI・音声合成を呼び出さずに再生します。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "発表準備に失敗しました");
    } finally {
      setIsPreparingSpeech(false);
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

  const queueParagraph = useCallback(async (queued: Omit<QueuedPresentationSpeech, "id" | "durationMs"> & { paragraphIndex: number }) => {
    const paragraph = queued.paragraphs[queued.paragraphIndex];
    if (!paragraph) return;
    const id = crypto.randomUUID();
    const presentationState = { ...queued.presentationState, caption: paragraph.text, updatedAt: Date.now() };
    queuedPresentationSpeechRef.current = { ...queued, presentationState, id, durationMs: paragraph.durationMs };
    const liveAudioBuffer = paragraph.audioBuffer.slice(0);
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(LIVE_OUTPUT_CHANNEL);
      channel.postMessage({ type: "speech", id, emotion: paragraph.emotion, text: paragraph.text, audioBuffer: liveAudioBuffer, presentationState });
      channel.close();
    }
    const response = await fetch("/api/live-speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, emotion: paragraph.emotion, text: paragraph.text, audioBase64: arrayBufferToBase64(liveAudioBuffer), contentType: paragraph.contentType, presentationState }) });
    if (!response.ok) throw new Error("OBS出力へ読み上げを送信できませんでした");
  }, []);

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
      if (preparedSpeech?.projectId === activeProject.id) {
        const playbackResponse = await fetch("/api/presentation-playback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.id, startSlideIndex: slideIndex, mode: autoAdvance ? "from-slide" : "slide" }),
        });
        if (playbackResponse.ok) {
          setStatus(autoAdvance ? `${slide.page}ページ目から発表キューを開始しました` : `${slide.page}ページ目の発表キューを開始しました`);
          return;
        }
        if (playbackResponse.status !== 409) {
          const detail = await playbackResponse.json().catch(() => ({})) as { error?: string };
          throw new Error(detail.error || "発表キューを開始できませんでした");
        }
      }
      const texts = splitIntoParagraphs(slide.script);
      let paragraphs = await loadPreparedParagraphs(activeProject, slideIndex, texts);
      if (paragraphs) {
        setStatus(`${slide.page}ページ目の準備済み音声を再生します`);
      } else {
        const speechSettings = getSpeechSettings();
        paragraphs = [];
        for (const [index, text] of texts.entries()) {
          setStatus(`${slide.page}ページ目・段落 ${index + 1}/${texts.length} をその場で準備中...`);
          const emotion = await resolvePresentationEmotion(text, speechSettings);
          const { audioBuffer, contentType } = await synthesizeSpeech(text, speechSettings);
          paragraphs.push({ text, emotion, audioBuffer, contentType, durationMs: await getAudioDurationMs(audioBuffer, Math.max(1, Math.round(slide.expectedDurationSeconds / texts.length))) });
        }
      }
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
      await queueParagraph({ slideIndex, autoAdvance, project: activeProject, presentationState, paragraphs, paragraphIndex: 0 });

      setStatus(`${slide.page}ページ目の読み上げ開始を待っています`);
    } catch (error) {
      queuedPresentationSpeechRef.current = null;
      activePresentationSpeechRef.current = null;
      setIsSpeaking(false);
      await updateLiveState({ status: "paused" }).catch(() => {});
      setStatus(error instanceof Error ? error.message : "読み上げを開始できませんでした");
    }
  }, [loadPreparedParagraphs, preparedSpeech, project, queueParagraph, updateLiveState]);

  const stopAutoAdvance = async () => {
    if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceTimerRef.current = 0;
    autoAdvanceEnabledRef.current = false;
    queuedPresentationSpeechRef.current = null;
    activePresentationSpeechRef.current = null;
    setIsSpeaking(false);
    await fetch("/api/presentation-playback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(() => {});
    await updateLiveState({ status: "paused" });
    setStatus("自動進行を停止しました。再生中の音声はOBS側で最後まで再生されます。");
  };

  const advanceAfterSpeechEnded = useCallback((speechId: string) => {
    const activeSpeech = activePresentationSpeechRef.current;
    if (!activeSpeech || activeSpeech.id !== speechId) return;
    activePresentationSpeechRef.current = null;
    if (autoAdvanceTimerRef.current) window.clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceTimerRef.current = 0;

    const { project: activeProject, slideIndex, autoAdvance, presentationState, paragraphs, paragraphIndex } = activeSpeech;
    const slide = activeProject.slides[slideIndex];
    if (!slide) return;
    if (paragraphIndex + 1 < paragraphs.length) {
      void queueParagraph({ project: activeProject, slideIndex, autoAdvance, presentationState, paragraphs, paragraphIndex: paragraphIndex + 1 })
        .then(() => setStatus(`${slide.page}ページ目・段落 ${paragraphIndex + 2}/${paragraphs.length} の読み上げ開始を待っています`))
        .catch((error) => setStatus(error instanceof Error ? error.message : "次の段落を送信できませんでした"));
      return;
    }
    const nextSlideIndex = slideIndex + 1;
    setIsSpeaking(false);
    if (autoAdvance && autoAdvanceEnabledRef.current && nextSlideIndex < activeProject.slides.length) {
      void speakSlide(nextSlideIndex, true);
      return;
    }
    void updateLiveState({ status: nextSlideIndex >= activeProject.slides.length ? "finished" : "paused" });
    setStatus(nextSlideIndex >= activeProject.slides.length ? "発表が終了しました。質疑応答を開始できます。" : "読み上げが完了しました");
  }, [queueParagraph, speakSlide, updateLiveState]);

  const handleSpeechStarted = useCallback((speechId: string) => {
    const queuedSpeech = queuedPresentationSpeechRef.current;
    if (!queuedSpeech || queuedSpeech.id !== speechId) return;

    queuedPresentationSpeechRef.current = null;
    activePresentationSpeechRef.current = queuedSpeech;
    const { project: activeProject, slideIndex, durationMs, presentationState, paragraphs, paragraphIndex } = queuedSpeech;
    const slide = activeProject.slides[slideIndex];
    if (!slide) return;

    setCurrentSlideIndex(slideIndex);
    setStatus(`${slide.page}ページ目・段落 ${paragraphIndex + 1}/${paragraphs.length} を読み上げ中`);
    void updateLiveState(presentationState);

    // ライブ画面からの終了通知が届かない場合だけ、保存済み音声尺で進める安全弁。
    autoAdvanceTimerRef.current = window.setTimeout(() => advanceAfterSpeechEnded(speechId), durationMs + 3_000);
  }, [advanceAfterSpeechEnded, updateLiveState]);

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

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch("/api/live-speech", { cache: "no-store" });
        const data = (await response.json()) as { speech?: LiveSpeechProgress | null };
        if (!disposed && data.speech?.status === "started") handleSpeechStarted(data.speech.id);
        if (!disposed && data.speech?.status === "ended") {
          // 開始通知だけが一時的に失われても、終了通知から進行を復帰する。
          if (queuedPresentationSpeechRef.current?.id === data.speech.id) handleSpeechStarted(data.speech.id);
          advanceAfterSpeechEnded(data.speech.id);
        }
      } catch {
        // 一時的な通信失敗は次回の監視で回復する。
      } finally {
        if (!disposed) timer = window.setTimeout(poll, 400);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [advanceAfterSpeechEnded, handleSpeechStarted]);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch("/api/presentation-playback", { cache: "no-store" });
        const data = (await response.json()) as PresentationPlaybackProgress;
        if (disposed) return;
        if (typeof data.segment?.slideIndex === "number") setCurrentSlideIndex(data.segment.slideIndex);
        if (isSpeaking && data.state?.status === "finished") {
          setIsSpeaking(false);
          setStatus("発表が終了しました。質疑応答を開始できます。");
        }
        if (isSpeaking && data.state?.status === "stopped") setIsSpeaking(false);
      } catch {
        // サーバーキューは保持されるため、次回の監視で状態を回復できる。
      } finally {
        if (!disposed) timer = window.setTimeout(poll, 800);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isSpeaking]);

  const currentSlide = project?.slides[currentSlideIndex] ?? null;
  const completedScripts = useMemo(
    () => project?.slides.filter((slide) => slide.script.trim()).length ?? 0,
    [project],
  );
  const preparedParagraphCount = useMemo(() => {
    if (!project || preparedSpeech?.projectId !== project.id) return 0;
    return project.slides.reduce((count, slide, slideIndex) => count + splitIntoParagraphs(slide.script)
      .filter((text, paragraphIndex) => preparedSpeech.entries.some((entry) => entry.slideIndex === slideIndex && entry.paragraphIndex === paragraphIndex && normalizeScriptText(entry.text) === normalizeScriptText(text))).length, 0);
  }, [preparedSpeech, project]);
  const totalParagraphCount = useMemo(
    () => project?.slides.reduce((count, slide) => count + splitIntoParagraphs(slide.script).length, 0) ?? 0,
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

          {project && <div className="mt-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">選択中PDFを更新</p>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50">
              <FileUp className="size-4" />
              {replacementPdfFile?.name || "更新用PDFを選択"}
              <input className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => setReplacementPdfFile(event.target.files?.[0] ?? null)} />
            </label>
            <button type="button" disabled={!replacementPdfFile || isImporting} onClick={() => void replaceProjectPdf()} className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 disabled:opacity-50">PDFを更新</button>
            <button type="button" onClick={() => setIsDeleteConfirming(true)} className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">このプロジェクトを削除</button>
          </div>}

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
                  <p className="text-xs text-slate-500">原稿入力済み {completedScripts}/{project?.slides.length}ページ · 音声準備済み {preparedParagraphCount}/{totalParagraphCount}段落 · 想定 {project?.slides.reduce((sum, slide) => sum + slide.expectedDurationSeconds, 0)}秒</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => void prepareProjectSpeech()} disabled={isPreparingSpeech || isSpeaking || totalParagraphCount === 0} className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800 disabled:opacity-50">
                    {isPreparingSpeech ? <LoaderCircle className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
                    発表を準備
                  </button>
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
                発表全体の知識
                <textarea value={project?.knowledge ?? ""} onChange={(event) => setProject((current) => current ? { ...current, knowledge: event.target.value } : current)} className="min-h-36 resize-y rounded-md border border-slate-200 p-3 font-normal leading-relaxed" placeholder="ゼミで取り組んだこと、アプリ仕様、技術的な補足を入力" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                想定Q&A
                <textarea value={project?.qa ?? ""} onChange={(event) => setProject((current) => current ? { ...current, qa: event.target.value } : current)} className="min-h-36 resize-y rounded-md border border-slate-200 p-3 font-normal leading-relaxed" placeholder="質問と回答例を入力" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                想定時間（秒）
                <input type="number" min="1" max="3600" value={currentSlide.expectedDurationSeconds} onChange={(event) => updateCurrentSlide({ expectedDurationSeconds: Number(event.target.value) || 30 })} className="rounded-md border border-slate-200 px-3 py-2 font-normal" />
              </label>
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">「発表を準備」で段落ごとの感情判定と音声合成を先に保存します。原稿を変更した段落は準備し直してください。本番は準備済みの段落を優先し、未準備分だけその場で合成します。</p>
              <label className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold">
                自動で次へ進む
                <input type="checkbox" checked={project?.settings.autoAdvance ?? false} onChange={(event) => setProject((current) => current ? { ...current, settings: { ...current.settings, autoAdvance: event.target.checked } } : current)} className="size-4 accent-teal-600" />
              </label>
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">プロジェクトを選択すると編集できます。</p>}
        </aside>
      </div>
      {isDeleteConfirming && project && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-5" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <p className="text-sm font-bold text-rose-700">プロジェクトを削除</p>
            <h2 id="delete-project-title" className="mt-2 text-lg font-bold text-slate-900">「{project.title}」を削除しますか？</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">PDF、スライド画像、原稿、ノート、発表知識、想定Q&Aがすべて削除されます。この操作は元に戻せません。</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setIsDeleteConfirming(false)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">キャンセル</button>
              <button type="button" onClick={() => void deleteProject().catch((error) => setStatus(error instanceof Error ? error.message : "削除できませんでした"))} className="rounded-md bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700">削除する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
