"use client";

import { CSSProperties, ChangeEvent, DragEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";

import AppHeader from "@/app/components/AppHeader";
import MaterialsMode from "@/app/components/MaterialsMode";
import StreamingMode from "@/app/components/StreamingMode";

import type { GeneratedSprite, Mode, MouthFrame, MouthlessCleanPlate, MouthlessMask, MouthTrack, Quad, SpeedMode, WorkerMessage } from "@/lib/materials";
import {
  analyzeMouthPatchFeatures,
  applyEllipseFeatherAlpha,
  canvasToVp8Frame,
  clampQuad,
  collectLabRingStats,
  collectPlaneSamples,
  createMouthlessMask,
  createVp8WebM,
  drawMouthPatchToCanvas,
  drawWarpedPatch,
  ensureEven,
  expandQuad,
  formatTime,
  getAutoMouthCandidates,
  getAutoMouthNormSize,
  getQuadSize,
  getTrackSpriteFrames,
  grayVarianceAndEdge,
  imageDataToLabData,
  inpaintCleanPatch,
  makeMouthlessPatchFromCleanPlate,
  materialGenerationConfig,
  modelUrls,
  mouthSpriteNames,
  percentile,
  postProcessTrackFrames,
  resampleTrackFrames,
  selectAutoMouthSpriteFramesByFeatures,
  sleep,
  speedPresets,
  waitForEvent,
} from "@/lib/materials";

type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type MouthState = "closed" | "half" | "open" | "e" | "u";

type VoicevoxSpeaker = {
  name: string;
  styles: Array<{ id: number; name: string }>;
};

const revokeObjectUrl = (url: string) => {
  if (url) URL.revokeObjectURL(url);
};

const isImportableQuad = (value: unknown): value is Quad =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      point.every((coordinate) => Number.isFinite(coordinate)),
  );

const fitMediaBox = (width: number, height: number, aspectRatio: number): CSSProperties => {
  if (width <= 0 || height <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { aspectRatio: "16 / 9", width: "100%" };
  }

  const fittedWidth = Math.max(1, Math.min(width, height * aspectRatio));
  const fittedHeight = Math.max(1, Math.min(height, fittedWidth / aspectRatio));
  return {
    aspectRatio: String(aspectRatio),
    height: `${Math.floor(fittedHeight)}px`,
    width: `${Math.floor(fittedWidth)}px`,
  };
};

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export default function Home() {
  const [mode, setMode] = useState<Mode>("materials");
  const [materialPreviewTab, setMaterialPreviewTab] = useState<"original" | "mouthless">("original");
  const [isStreamingMenuOpen, setIsStreamingMenuOpen] = useState(true);
  const [streamingVideoLayout, setStreamingVideoLayout] = useState({ x: 0, y: 0, width: 0, isPlaced: false });
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoMeta, setVideoMeta] = useState({ width: 0, height: 0, duration: 0 });
  const [analysisFps, setAnalysisFps] = useState(24);
  const [speedMode, setSpeedMode] = useState<SpeedMode>("balanced");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [status, setStatus] = useState("動画を選択してください");
  const [progress, setProgress] = useState(0);
  const [track, setTrack] = useState<MouthTrack | null>(null);
  const [currentFrame, setCurrentFrame] = useState<MouthFrame | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [loadedTrackName, setLoadedTrackName] = useState("");
  const [mouthSprites, setMouthSprites] = useState<GeneratedSprite[]>([]);
  const [mouthStatus, setMouthStatus] = useState("未生成");
  const [isExtractingMouth, setIsExtractingMouth] = useState(false);
  const [mouthlessUrl, setMouthlessUrl] = useState("");
  const [mouthlessStatus, setMouthlessStatus] = useState("未生成");
  const [isGeneratingMouthless, setIsGeneratingMouthless] = useState(false);
  const [voicevoxUrl, setVoicevoxUrl] = useState("http://127.0.0.1:50021");
  const [voicevoxStatus, setVoicevoxStatus] = useState("未接続");
  const [voicevoxSpeakers, setVoicevoxSpeakers] = useState<VoicevoxSpeaker[]>([]);
  const [voicevoxSpeakerId, setVoicevoxSpeakerId] = useState(1);
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiModel, setOpenAiModel] = useState("gpt-5");
  const [systemPrompt, setSystemPrompt] = useState("あなたは明るく自然に会話するAITuberです。返答は短めにしてください。");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [, setRuntimeStatus] = useState("待機中");
  const [isChatRunning, setIsChatRunning] = useState(false);
  const [mouthState, setMouthState] = useState<MouthState>("closed");
  const [runtimeFrame, setRuntimeFrame] = useState<MouthFrame | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [materialPreviewSize, setMaterialPreviewSize] = useState({ width: 0, height: 0 });
  const [runtimePreviewSize, setRuntimePreviewSize] = useState({ width: 0, height: 0 });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runtimeVideoRef = useRef<HTMLVideoElement | null>(null);
  const runtimeCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const materialPreviewRef = useRef<HTMLDivElement | null>(null);
  const runtimePreviewRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouthImagesRef = useRef<Partial<Record<MouthState, HTMLImageElement>>>({});
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef(false);
  const framesRef = useRef<MouthFrame[]>([]);
  const trackRef = useRef<MouthTrack | null>(null);
  const frameCallbackRef = useRef(0);
  const animationFrameRef = useRef(0);
  const videoUrlRef = useRef("");
  const downloadUrlRef = useRef("");
  const mouthSpriteUrlsRef = useRef<string[]>([]);
  const mouthlessUrlRef = useRef("");
  const audioUrlRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lipSyncFrameRef = useRef(0);
  const runtimeCompositeFrameRef = useRef(0);
  const mouthStateRef = useRef<MouthState>("closed");
  const streamingDragRef = useRef<null | { type: "move" | "resize"; startX: number; startY: number; originX: number; originY: number; originWidth: number }>(null);

  const setManagedVideoUrl = (nextUrl: string) => {
    revokeObjectUrl(videoUrlRef.current);
    videoUrlRef.current = nextUrl;
    setVideoUrl(nextUrl);
  };

  const setManagedDownloadUrl = (nextUrl: string) => {
    revokeObjectUrl(downloadUrlRef.current);
    downloadUrlRef.current = nextUrl;
    setDownloadUrl(nextUrl);
  };

  const setManagedMouthSprites = (nextSprites: GeneratedSprite[]) => {
    mouthSpriteUrlsRef.current.forEach(revokeObjectUrl);
    mouthSpriteUrlsRef.current = nextSprites.map((sprite) => sprite.url);
    setMouthSprites(nextSprites);
  };

  const setManagedMouthlessUrl = (nextUrl: string) => {
    revokeObjectUrl(mouthlessUrlRef.current);
    mouthlessUrlRef.current = nextUrl;
    setMouthlessUrl(nextUrl);
  };

  const setManagedAudioUrl = (nextUrl: string) => {
    revokeObjectUrl(audioUrlRef.current);
    audioUrlRef.current = nextUrl;
    setAudioUrl(nextUrl);
  };

  const cancelScheduledFrameSync = () => {
    const videoWithCallback = videoRef.current as VideoElementWithFrameCallback | null;
    if (frameCallbackRef.current) {
      videoWithCallback?.cancelVideoFrameCallback?.(frameCallbackRef.current);
      frameCallbackRef.current = 0;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
  };

  const getRuntimeTrackFrame = useCallback(() => {
    const video = runtimeVideoRef.current;
    const currentTrack = trackRef.current;
    if (!video || !currentTrack?.frames.length) return null;
    const frameIndex = Math.max(
      0,
      Math.min(currentTrack.frames.length - 1, Math.round(video.currentTime * currentTrack.fps)),
    );
    return currentTrack.frames[frameIndex] ?? null;
  }, []);

  const drawRuntimeMouthComposite = useCallback(() => {
    const canvas = runtimeCompositeCanvasRef.current;
    const context = canvas?.getContext("2d");
    const currentTrack = trackRef.current;
    if (!canvas || !context || !currentTrack) return;

    if (canvas.width !== currentTrack.width || canvas.height !== currentTrack.height) {
      canvas.width = currentTrack.width;
      canvas.height = currentTrack.height;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    const frame = getRuntimeTrackFrame();
    const image =
      mouthImagesRef.current[mouthStateRef.current] ??
      mouthImagesRef.current.closed ??
      mouthImagesRef.current.half ??
      mouthImagesRef.current.open;
    if (!frame?.valid || !frame.quad || !image?.complete) return;

    context.imageSmoothingEnabled = true;
    drawWarpedPatch(context, image, frame.quad, image.naturalWidth || image.width, image.naturalHeight || image.height);
  }, [getRuntimeTrackFrame]);

  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  useEffect(() => {
    mouthSpriteUrlsRef.current = mouthSprites.map((sprite) => sprite.url);
  }, [mouthSprites]);

  useEffect(() => {
    mouthlessUrlRef.current = mouthlessUrl;
  }, [mouthlessUrl]);

  useEffect(() => {
    audioUrlRef.current = audioUrl;
  }, [audioUrl]);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  useEffect(() => {
    const observe = (element: HTMLElement | null, setSize: (size: { width: number; height: number }) => void) => {
      if (!element) return null;
      const update = () => {
        const rect = element.getBoundingClientRect();
        setSize({ width: rect.width, height: rect.height });
      };
      const observer = new ResizeObserver(update);
      observer.observe(element);
      update();
      return observer;
    };

    const materialObserver = observe(materialPreviewRef.current, setMaterialPreviewSize);
    const runtimeObserver = observe(runtimePreviewRef.current, setRuntimePreviewSize);
    return () => {
      materialObserver?.disconnect();
      runtimeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    mouthStateRef.current = mouthState;
    drawRuntimeMouthComposite();
  }, [drawRuntimeMouthComposite, mouthState]);

  useEffect(() => {
    const video = runtimeVideoRef.current;
    if (!video || !mouthlessUrl) return;
    video.load();
    video.play().catch(() => {});
  }, [mouthlessUrl]);

  useEffect(() => {
    const nextImages: Partial<Record<MouthState, HTMLImageElement>> = {};
    mouthSprites.forEach((sprite) => {
      const image = new Image();
      image.onload = drawRuntimeMouthComposite;
      image.src = sprite.url;
      nextImages[sprite.name] = image;
    });
    mouthImagesRef.current = nextImages;
    drawRuntimeMouthComposite();
  }, [drawRuntimeMouthComposite, mouthSprites]);

  useEffect(() => {
    if (mode !== "streaming" || !track || !mouthlessUrl || !mouthSprites.length) return;
    const tick = () => {
      drawRuntimeMouthComposite();
      runtimeCompositeFrameRef.current = requestAnimationFrame(tick);
    };
    runtimeCompositeFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (runtimeCompositeFrameRef.current) {
        cancelAnimationFrame(runtimeCompositeFrameRef.current);
        runtimeCompositeFrameRef.current = 0;
      }
    };
  }, [drawRuntimeMouthComposite, mode, mouthSprites.length, mouthlessUrl, track]);


  useEffect(() => {
    return () => {
      revokeObjectUrl(videoUrlRef.current);
      revokeObjectUrl(downloadUrlRef.current);
      mouthSpriteUrlsRef.current.forEach(revokeObjectUrl);
      revokeObjectUrl(mouthlessUrlRef.current);
      revokeObjectUrl(audioUrlRef.current);
      workerRef.current?.terminate();
      audioSourceRef.current?.stop();
      audioContextRef.current?.close();
      if (lipSyncFrameRef.current) cancelAnimationFrame(lipSyncFrameRef.current);
      if (runtimeCompositeFrameRef.current) cancelAnimationFrame(runtimeCompositeFrameRef.current);
      cancelScheduledFrameSync();
    };
  }, []);

  const loadVideoFile = (nextFile: File) => {
    cancelScheduledFrameSync();
    workerRef.current?.terminate();
    workerRef.current = null;
    cancelRef.current = false;
    framesRef.current = [];
    setFile(nextFile);
    setManagedVideoUrl(URL.createObjectURL(nextFile));
    setVideoMeta({ width: 0, height: 0, duration: 0 });
    setTrack(null);
    setCurrentFrame(null);
    setManagedDownloadUrl("");
    setManagedMouthSprites([]);
    setMouthStatus("未生成");
    setManagedMouthlessUrl("");
    setMouthlessStatus("未生成");
    setManagedAudioUrl("");
    setRuntimeFrame(null);
    setMouthState("closed");
    setRuntimeStatus("待機中");
    setProgress(0);
    setStatus("動画メタデータを読み込み中");
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (nextFile) loadVideoFile(nextFile);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile?.type.startsWith("video/")) loadVideoFile(nextFile);
  };

  const onMetadataLoaded = () => {
    const video = videoRef.current;
    if (!video) return;
    setVideoMeta({
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    });
    setStatus("解析できます");
  };

  const updateFrameForCurrentTime = (nextTrack = trackRef.current) => {
    const video = videoRef.current;
    if (!video || !nextTrack?.frames.length) return;
    const frameIndex = Math.max(
      0,
      Math.min(nextTrack.frames.length - 1, Math.round(video.currentTime * nextTrack.fps)),
    );
    setCurrentFrame(nextTrack.frames[frameIndex]);
  };

  const startTrackPlaybackSync = () => {
    const video = videoRef.current;
    if (!video) return;
    cancelScheduledFrameSync();

    const videoWithCallback = video as VideoElementWithFrameCallback;

    if (videoWithCallback.requestVideoFrameCallback) {
      const handleFrame: VideoFrameRequestCallback = () => {
        updateFrameForCurrentTime();
        if (!video.paused && !video.ended) {
          frameCallbackRef.current = videoWithCallback.requestVideoFrameCallback?.(handleFrame) ?? 0;
        }
      };
      frameCallbackRef.current = videoWithCallback.requestVideoFrameCallback(handleFrame);
      return;
    }

    const handleAnimationFrame = () => {
      updateFrameForCurrentTime();
      if (!video.paused && !video.ended) {
        animationFrameRef.current = requestAnimationFrame(handleAnimationFrame);
      }
    };
    animationFrameRef.current = requestAnimationFrame(handleAnimationFrame);
  };

  const stopTrackPlaybackSync = () => {
    cancelScheduledFrameSync();
    updateFrameForCurrentTime();
  };

  const loadTrackJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const jsonFile = event.target.files?.[0];
    if (!jsonFile) return;

    try {
      const parsed = JSON.parse(await jsonFile.text()) as MouthTrack;
      if (
        !Number.isFinite(parsed.fps) ||
        !Number.isFinite(parsed.width) ||
        !Number.isFinite(parsed.height) ||
        !Array.isArray(parsed.frames)
      ) {
        throw new Error("mouth_track.json の形式が違います");
      }

      const normalizedTrack: MouthTrack = {
        fps: parsed.fps,
        width: parsed.width,
        height: parsed.height,
        detector: parsed.detector ?? {
          name: "imported mouth_track.json",
          runtime: "unknown",
          backend: "unknown",
          processor: "import",
          analysisFps: parsed.fps,
          speedMode: "balanced",
        },
        frames: parsed.frames.map((frame, index) => {
          if (!isImportableQuad(frame.quad)) {
            throw new Error(`mouth_track.json の ${index} 番目のquadが不正です`);
          }

          return {
            index: Number.isFinite(frame.index) ? frame.index : index,
            quad: clampQuad(frame.quad, parsed.width, parsed.height),
            valid: Boolean(frame.valid),
            confidence: Number(frame.confidence) || 0,
            source: frame.source || "import",
            processor: frame.processor || "import",
          };
        }),
      };

      const blob = new Blob([JSON.stringify(normalizedTrack, null, 2)], { type: "application/json" });
      setTrack(normalizedTrack);
      setManagedDownloadUrl(URL.createObjectURL(blob));
      setLoadedTrackName(jsonFile.name);
      setProgress(1);
      setStatus(`JSON読込完了: ${normalizedTrack.frames.length} frames`);
      setRuntimeStatus("素材生成のJSONを引き継ぎ済み");
      setCurrentFrame(normalizedTrack.frames.find((frame) => frame.valid) ?? normalizedTrack.frames[0] ?? null);
      setRuntimeFrame(normalizedTrack.frames.find((frame) => frame.valid) ?? normalizedTrack.frames[0] ?? null);
      window.requestAnimationFrame(() => updateFrameForCurrentTime(normalizedTrack));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "mouth_track.json の読み込みに失敗しました");
    } finally {
      event.target.value = "";
    }
  };

  const seekVideo = async (time: number) => {
    const video = videoRef.current;
    if (!video) throw new Error("動画が読み込まれていません");
    const nextTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
    if (Math.abs(video.currentTime - nextTime) < 0.001) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    } else {
      video.currentTime = nextTime;
      await waitForEvent(video, "seeked");
    }
  };

  const captureBitmap = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) throw new Error("動画キャプチャを初期化できません");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvasを初期化できません");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return createImageBitmap(canvas);
  };

  const initWorker = async () => {
    workerRef.current?.terminate();
    const worker = new Worker("/workers/anime-onnx-worker.js", { type: "module" });
    workerRef.current = worker;

    const ready = new Promise<{ backend: string; backendLabel: string }>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "progress") setStatus(message.message);
        if (message.type === "ready") resolve(message);
        if (message.type === "error") reject(new Error(message.message));
      };
      worker.onerror = () => reject(new Error("ONNX worker の起動に失敗しました"));
    });

    worker.postMessage({
      type: "init",
      config: {
        backendCandidates: ["wasm"],
        modelUrls,
        hrnetBatchSize: materialGenerationConfig.analysis.hrnetBatchSize,
      },
    });

    return ready;
  };

  const analyzeVideo = async () => {
    const video = videoRef.current;
    if (!video || !file || !videoMeta.width || !videoMeta.duration) return;

    setIsAnalyzing(true);
    setTrack(null);
    setCurrentFrame(null);
    setManagedDownloadUrl("");
    setProgress(0);
    cancelRef.current = false;
    framesRef.current = [];

    try {
      video.pause();
      const ready = await initWorker();
      const preset = speedPresets[speedMode];
      const targetFps = Math.max(1, Math.min(60, Math.round(analysisFps)));
      const effectiveFps = Math.max(1, Math.min(targetFps, Math.round(targetFps * preset.fpsScale)));
      const totalFrames = Math.max(1, Math.ceil(videoMeta.duration * effectiveFps));
      const worker = workerRef.current;
      if (!worker) throw new Error("ONNX worker を開始できません");

      setStatus(`${ready.backendLabel}で解析中`);

      const framesByIndex = new Map<number, MouthFrame>();
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "progress") setStatus(message.message);
        if (message.type === "error") {
          setStatus(`解析エラー: ${message.message}`);
        }
        if (message.type === "frame") {
          const frame: MouthFrame = {
            index: message.index,
            quad: clampQuad(message.frame.quad, videoMeta.width, videoMeta.height),
            valid: message.frame.valid,
            confidence: message.frame.confidence,
            source: message.frame.source,
            processor: message.frame.processor,
          };
          framesByIndex.set(message.index, frame);
          framesRef.current = Array.from(framesByIndex.values()).sort((a, b) => a.index - b.index);
          setCurrentFrame(frame);
          setProgress(framesByIndex.size / totalFrames);
          setStatus(
            `解析中 ${framesByIndex.size}/${totalFrames} frames / valid ${Array.from(framesByIndex.values()).filter((item) => item.valid).length}`,
          );
        }
      };

      for (let index = 0; index < totalFrames; index += 1) {
        if (cancelRef.current) break;
        await seekVideo(index / effectiveFps);
        const bitmap = await captureBitmap();
        worker.postMessage(
          {
            type: "frame",
            index,
            bitmap,
            width: videoMeta.width,
            height: videoMeta.height,
            detectorInterval: preset.detectorInterval,
            options: {
              pad: materialGenerationConfig.analysis.pad,
              minWidthRatio: materialGenerationConfig.analysis.minWidthRatio,
              spriteAspect: materialGenerationConfig.analysis.spriteAspect,
            },
          },
          [bitmap],
        );

        while (!cancelRef.current && framesByIndex.size <= index) {
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
      }

      if (cancelRef.current) {
        setStatus("解析を停止しました");
        return;
      }

      const rawFrames = Array.from({ length: totalFrames }, (_, index) => {
        const fallback: MouthFrame = {
          index,
          quad: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          valid: false,
          confidence: 0,
          source: "anime-onnx",
          processor: "worker",
        };
        return framesByIndex.get(index) ?? fallback;
      });
      const processed = postProcessTrackFrames(rawFrames, effectiveFps, 0);
      const resampled = resampleTrackFrames(processed.frames, effectiveFps, targetFps, videoMeta.duration);
      const frames = resampled.frames.map((frame, index) => ({
        ...frame,
        index,
        quad: clampQuad(frame.quad, videoMeta.width, videoMeta.height),
      }));
      const nextTrack: MouthTrack = {
        fps: targetFps,
        width: videoMeta.width,
        height: videoMeta.height,
        detector: {
          name: "anime-face-detector ONNX",
          runtime: "onnxruntime-web",
          backend: ready.backend,
          processor: "worker",
          analysisFps: effectiveFps,
          speedMode,
        },
        frames,
      };
      setTrack(nextTrack);
      setLoadedTrackName("");
      setCurrentFrame(frames.find((frame) => frame.valid) ?? frames[0] ?? null);
      setRuntimeFrame(frames.find((frame) => frame.valid) ?? frames[0] ?? null);
      const blob = new Blob([JSON.stringify(nextTrack, null, 2)], { type: "application/json" });
      setManagedDownloadUrl(URL.createObjectURL(blob));
      setProgress(1);
      setRuntimeStatus("素材生成のJSONを引き継ぎ済み");
      setStatus(
        `解析完了: ${rawFrames.filter((frame) => frame.valid).length}/${rawFrames.length} raw valid / 補間${
          processed.interpolatedCount + resampled.interpolatedCount
        }f`,
      );
      return nextTrack;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "解析に失敗しました");
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const stopAnalysis = () => {
    cancelRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsAnalyzing(false);
    setStatus("停止しました");
  };

  const canvasToPngUrl = (canvas: HTMLCanvasElement) =>
    new Promise<string>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PNG生成に失敗しました"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, "image/png");
    });

  const extractMouthSprites = async (sourceTrack = trackRef.current) => {
    const video = videoRef.current;
    const currentTrack = sourceTrack;
    if (!video || !currentTrack) {
      setMouthStatus("動画とtrackが必要");
      return;
    }
    if (isExtractingMouth) return;

    const restore = { time: video.currentTime, wasPaused: video.paused, loop: video.loop };
    const mouthCanvas = document.createElement("canvas");
    const mouthContext = mouthCanvas.getContext("2d");
    const nextSprites: GeneratedSprite[] = [];
    if (!mouthContext) {
      setMouthStatus("Canvas初期化失敗");
      return;
    }

    try {
      setIsExtractingMouth(true);
      setMouthStatus("候補選別中");
      video.pause();
      video.loop = false;

      const candidates = getAutoMouthCandidates(currentTrack);
      const { normWidth, normHeight, outputWidth, outputHeight } = getAutoMouthNormSize(candidates);

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (index === 0 || index % 12 === 0) setMouthStatus(`特徴解析 ${index + 1}/${candidates.length}`);
        await seekVideo(candidate.index / currentTrack.fps);
        drawMouthPatchToCanvas(mouthContext, video, candidate.quad, normWidth, normHeight);
        candidate.features = analyzeMouthPatchFeatures(mouthContext.getImageData(0, 0, normWidth, normHeight), normWidth, normHeight);
        if (index % 12 === 0) await sleep(0);
      }

      const selection = selectAutoMouthSpriteFramesByFeatures(candidates);
      const selectedFrames = Object.values(selection);
      const unifiedWidth = ensureEven(
        Math.max(outputWidth, Math.round(Math.max(...selectedFrames.map((frame) => frame.width)) * 1.1)),
      );
      const unifiedHeight = ensureEven(
        Math.max(outputHeight, Math.round(Math.max(...selectedFrames.map((frame) => frame.height)) * 1.1)),
      );
      for (const name of mouthSpriteNames) {
        const frame = selection[name];
        setMouthStatus(`${name} 抽出中`);
        await seekVideo(frame.index / currentTrack.fps);
        drawMouthPatchToCanvas(mouthContext, video, frame.quad, unifiedWidth, unifiedHeight);
        applyEllipseFeatherAlpha(mouthContext, unifiedWidth, unifiedHeight, 15, 0.85);
        nextSprites.push({
          name,
          url: await canvasToPngUrl(mouthCanvas),
          frameIndex: frame.index,
          width: unifiedWidth,
          height: unifiedHeight,
        });
      }

      setManagedMouthSprites(nextSprites);
      setMouthStatus(`完了 ${unifiedWidth}x${unifiedHeight}`);
      setMouthState("closed");
      setRuntimeStatus("素材生成の口PNGを引き継ぎ済み");
      return nextSprites;
    } catch (error) {
      nextSprites.forEach((sprite) => revokeObjectUrl(sprite.url));
      setMouthStatus(error instanceof Error ? error.message : "口PNG抽出に失敗しました");
      return null;
    } finally {
      video.loop = restore.loop;
      await seekVideo(restore.time).catch(() => {});
      if (!restore.wasPaused) video.play().catch(() => {});
      setIsExtractingMouth(false);
    }
  };

  const createMouthlessFrame = (
    outputContext: CanvasRenderingContext2D,
    patchContext: CanvasRenderingContext2D,
    patchCanvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    currentTrack: MouthTrack,
    cleanPlate: MouthlessCleanPlate,
    mask: MouthlessMask,
    frameIndex: number,
    patchWidth: number,
    patchHeight: number,
  ) => {
    outputContext.setTransform(1, 0, 0, 1, 0, 0);
    outputContext.drawImage(video, 0, 0, currentTrack.width, currentTrack.height);
    const frame = currentTrack.frames[Math.min(currentTrack.frames.length - 1, frameIndex)];
    if (!frame?.valid || !frame.quad) return;

    const eraseQuad = expandQuad(
      frame.quad,
      materialGenerationConfig.mouthless.quadScaleX,
      materialGenerationConfig.mouthless.quadScaleY,
    );
    drawMouthPatchToCanvas(patchContext, video, eraseQuad, patchWidth, patchHeight);
    const patch = makeMouthlessPatchFromCleanPlate(
      patchContext.getImageData(0, 0, patchWidth, patchHeight),
      cleanPlate,
      mask,
    );
    patchContext.putImageData(patch, 0, 0);
    drawWarpedPatch(outputContext, patchCanvas, eraseQuad, patchWidth, patchHeight);
  };

  const generateMouthlessVideo = async (sourceTrack = trackRef.current) => {
    const video = videoRef.current;
    const currentTrack = sourceTrack;
    if (!video || !currentTrack) {
      setMouthlessStatus("動画とtrackが必要");
      return;
    }
    if (isGeneratingMouthless) return;

    const restore = { time: video.currentTime, wasPaused: video.paused, loop: video.loop };
    const outputCanvas = document.createElement("canvas");
    const outputContext = outputCanvas.getContext("2d", { alpha: false });
    const patchCanvas = document.createElement("canvas");
    const patchContext = patchCanvas.getContext("2d");
    if (!outputContext || !patchContext) {
      setMouthlessStatus("Canvas初期化失敗");
      return;
    }

    const candidates = getTrackSpriteFrames(currentTrack);
    if (!candidates.length) {
      setMouthlessStatus("有効な口枠がありません");
      return;
    }
    const expandedSizes = candidates.map((frame) =>
      getQuadSize(
        expandQuad(
          frame.quad,
          materialGenerationConfig.mouthless.quadScaleX,
          materialGenerationConfig.mouthless.quadScaleY,
        ),
      ),
    );
    const patchWidth = ensureEven(Math.max(96, Math.round(percentile(expandedSizes.map((size) => size.width), 0.95) * 1.2)));
    const patchHeight = ensureEven(Math.max(64, Math.round(percentile(expandedSizes.map((size) => size.height), 0.95) * 1.2)));
    const fps = Math.max(1, Math.min(60, Math.round(currentTrack.fps || 24)));
    const totalFrames = Math.max(1, Math.min(currentTrack.frames.length, Math.round((video.duration || currentTrack.frames.length / fps) * fps)));
    const encodedFrames: Uint8Array[] = [];

    outputCanvas.width = currentTrack.width;
    outputCanvas.height = currentTrack.height;
    patchCanvas.width = patchWidth;
    patchCanvas.height = patchHeight;

    try {
      setIsGeneratingMouthless(true);
      setMouthlessStatus("生成準備中");
      video.pause();
      video.loop = false;
      setManagedMouthlessUrl("");

      setMouthlessStatus("参照フレーム選択中");
      const mask = createMouthlessMask(patchWidth, patchHeight, materialGenerationConfig.mouthless.maskCoverage);
      const ranked = candidates
        .slice()
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, Math.min(materialGenerationConfig.mouthless.maxReferenceFrames, candidates.length));
      let refFrame = ranked[0] || candidates[0];
      let bestScore = Infinity;
      for (let index = 0; index < ranked.length; index += 1) {
        const frame = ranked[index];
        if (index === 0 || index % 12 === 0) setMouthlessStatus(`参照選択 ${index + 1}/${ranked.length}`);
        await seekVideo(frame.index / currentTrack.fps);
        drawMouthPatchToCanvas(
          patchContext,
          video,
          expandQuad(
            frame.quad,
            materialGenerationConfig.mouthless.quadScaleX,
            materialGenerationConfig.mouthless.quadScaleY,
          ),
          patchWidth,
          patchHeight,
        );
        const imageData = patchContext.getImageData(0, 0, patchWidth, patchHeight);
        const score = grayVarianceAndEdge(imageData, patchWidth, patchHeight, mask.hard);
        if (score < bestScore) {
          refFrame = frame;
          bestScore = score;
        }
        if (index % 12 === 0) await sleep(0);
      }

      setMouthlessStatus(`clean作成 F:${refFrame.index}`);
      await seekVideo(refFrame.index / currentTrack.fps);
      drawMouthPatchToCanvas(
        patchContext,
        video,
        expandQuad(
          refFrame.quad,
          materialGenerationConfig.mouthless.quadScaleX,
          materialGenerationConfig.mouthless.quadScaleY,
        ),
        patchWidth,
        patchHeight,
      );
      const refPatch = patchContext.getImageData(0, 0, patchWidth, patchHeight);
      const refLab = imageDataToLabData(refPatch, patchWidth, patchHeight);
      const refRing = collectPlaneSamples(refPatch, patchWidth, patchHeight, mask.ring);
      const cleanPatch = inpaintCleanPatch(refPatch, patchWidth, patchHeight, mask.hard, refRing.avg);
      const cleanLabData = imageDataToLabData(cleanPatch, patchWidth, patchHeight);
      const refStats = collectLabRingStats(refLab, patchWidth, patchHeight, mask.colorRing || mask.ring, refPatch);
      const cleanPlate: MouthlessCleanPlate = {
        width: patchWidth,
        height: patchHeight,
        cleanLabData,
        refStats,
      };

      for (let index = 0; index < totalFrames; index += 1) {
        if (index === 0 || index % 10 === 0 || index === totalFrames - 1) {
          setMouthlessStatus(`動画生成 ${index + 1}/${totalFrames}`);
        }
        await seekVideo(index / fps);
        createMouthlessFrame(
          outputContext,
          patchContext,
          patchCanvas,
          video,
          currentTrack,
          cleanPlate,
          mask,
          index,
          patchWidth,
          patchHeight,
        );
        encodedFrames.push(await canvasToVp8Frame(outputCanvas));
        if (index % 4 === 0) await sleep(0);
      }

      setMouthlessStatus("WebM作成中");
      setManagedMouthlessUrl(
        URL.createObjectURL(
          createVp8WebM({
            frames: encodedFrames,
            width: currentTrack.width,
            height: currentTrack.height,
            fps,
            durationMs: (encodedFrames.length / fps) * 1000,
          }),
        ),
      );
      setMouthlessStatus("WebM生成完了");
      setRuntimeStatus("素材生成の口無し動画と口PNGを引き継ぎ済み");
      return true;
    } catch (error) {
      setMouthlessStatus(error instanceof Error ? error.message : "口無し動画生成に失敗しました");
      return false;
    } finally {
      video.loop = restore.loop;
      await seekVideo(restore.time).catch(() => {});
      if (!restore.wasPaused) video.play().catch(() => {});
      setIsGeneratingMouthless(false);
    }
  };

  const runFullPipeline = async () => {
    if (isRunningAll || isAnalyzing || isExtractingMouth || isGeneratingMouthless) return;
    setIsRunningAll(true);
    try {
      setStatus("一括生成: 解析開始");
      const nextTrack = await analyzeVideo();
      if (!nextTrack) return;
      setMouthStatus("一括生成: 口PNG抽出開始");
      const sprites = await extractMouthSprites(nextTrack);
      if (!sprites) return;
      setMouthlessStatus("一括生成: 口無し動画生成開始");
      await generateMouthlessVideo(nextTrack);
    } finally {
      setIsRunningAll(false);
    }
  };

  const testVoicevox = async () => {
    setVoicevoxStatus("接続確認中");
    try {
      const response = await fetch(`/api/voicevox/speakers?endpoint=${encodeURIComponent(voicevoxUrl)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "VOICEVOXへ接続できません");
      const speakers = Array.isArray(data.speakers) ? (data.speakers as VoicevoxSpeaker[]) : [];
      setVoicevoxSpeakers(speakers);
      const firstStyle = speakers[0]?.styles?.[0];
      if (firstStyle) setVoicevoxSpeakerId(firstStyle.id);
      setVoicevoxStatus(`接続OK: ${data.speakers?.length ?? 0} speakers`);
    } catch (error) {
      setVoicevoxStatus(error instanceof Error ? error.message : "接続に失敗しました");
    }
  };

  const updateRuntimeFrameForCurrentTime = () => {
    const frame = getRuntimeTrackFrame();
    if (frame) setRuntimeFrame(frame);
    drawRuntimeMouthComposite();
  };

  const loadRuntimeMouthlessFile = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (nextFile) {
      setManagedMouthlessUrl(URL.createObjectURL(nextFile));
      setMouthlessStatus("外部動画を読込済み");
      setRuntimeStatus("外部動画を引き継ぎ済み");
    }
    event.target.value = "";
  };

  const loadRuntimeMouthSprite = (name: MouthState) => (event: ChangeEvent<HTMLInputElement>) => {
    const pngFile = event.target.files?.[0];
    if (!pngFile) return;

    const nextSprite: GeneratedSprite = {
      name,
      url: URL.createObjectURL(pngFile),
      frameIndex: 0,
      width: 0,
      height: 0,
    };
    const nextSprites = [...mouthSprites.filter((sprite) => sprite.name !== name), nextSprite].sort(
      (a, b) => mouthSpriteNames.indexOf(a.name) - mouthSpriteNames.indexOf(b.name),
    );
    setManagedMouthSprites(nextSprites);
    setMouthStatus(`${name}.png 読込済み`);
    setMouthState("closed");
    setRuntimeStatus(`${name}.pngを読み込みました`);
    event.target.value = "";
  };

  function clampStreamingLayout(x: number, y: number, width: number) {
    const stageWidth = Math.max(1, runtimePreviewSize.width);
    const stageHeight = Math.max(1, runtimePreviewSize.height);
    const chatReserve = 88;
    const maxWidth = Math.max(160, Math.min(stageWidth - 24, (stageHeight - chatReserve - 24) * runtimeAspectRatio));
    const nextWidth = clampNumber(width || stageWidth * 0.42, 160, maxWidth);
    const nextHeight = nextWidth / runtimeAspectRatio;
    return {
      width: nextWidth,
      x: clampNumber(x, 12, stageWidth - nextWidth - 12),
      y: clampNumber(y, 12, stageHeight - chatReserve - nextHeight - 12),
    };
  }

  const startStreamingVideoMove = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-resize-handle]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    streamingDragRef.current = {
      type: "move",
      startX: event.clientX,
      startY: event.clientY,
      originX: streamingVideoX,
      originY: streamingVideoY,
      originWidth: streamingVideoWidth,
    };
  };

  const startStreamingVideoResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    streamingDragRef.current = {
      type: "resize",
      startX: event.clientX,
      startY: event.clientY,
      originX: streamingVideoX,
      originY: streamingVideoY,
      originWidth: streamingVideoWidth,
    };
  };

  const updateStreamingVideoDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = streamingDragRef.current;
    if (!drag) return;
    if (drag.type === "move") {
      const next = clampStreamingLayout(
        drag.originX + event.clientX - drag.startX,
        drag.originY + event.clientY - drag.startY,
        drag.originWidth,
      );
      setStreamingVideoLayout((current) => ({ ...current, ...next, isPlaced: true }));
      return;
    }
    const next = clampStreamingLayout(drag.originX, drag.originY, drag.originWidth + event.clientX - drag.startX);
    setStreamingVideoLayout((current) => ({ ...current, ...next, isPlaced: true }));
  };

  const stopStreamingVideoDrag = () => {
    streamingDragRef.current = null;
  };

  const stopSpeech = () => {
    audioSourceRef.current?.stop();
    audioSourceRef.current = null;
    if (lipSyncFrameRef.current) cancelAnimationFrame(lipSyncFrameRef.current);
    lipSyncFrameRef.current = 0;
    setMouthState("closed");
    setRuntimeStatus("停止しました");
  };

  const playAudioWithLipSync = async (arrayBuffer: ArrayBuffer) => {
    stopSpeech();
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("このブラウザはWeb Audio APIに対応していません");
    const audioContext = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = audioContext;
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const source = audioContext.createBufferSource();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.buffer = decoded;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    audioSourceRef.current = source;

    const samples = new Uint8Array(analyser.fftSize);
    let smoothedRms = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      smoothedRms = smoothedRms * 0.72 + rms * 0.28;
      setMouthState(smoothedRms > 0.09 ? "open" : smoothedRms > 0.035 ? "half" : "closed");
      lipSyncFrameRef.current = requestAnimationFrame(tick);
    };

    source.onended = () => {
      if (lipSyncFrameRef.current) cancelAnimationFrame(lipSyncFrameRef.current);
      lipSyncFrameRef.current = 0;
      audioSourceRef.current = null;
      setMouthState("closed");
      setRuntimeStatus("発話完了");
    };

    setRuntimeStatus("発話中");
    source.start();
    tick();
  };

  const synthesizeAndSpeak = async (text: string) => {
    setRuntimeStatus("VOICEVOX音声生成中");
    const response = await fetch("/api/voicevox/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: voicevoxUrl,
        text,
        speaker: voicevoxSpeakerId,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "VOICEVOX音声生成に失敗しました");
    }
    const audioBuffer = await response.arrayBuffer();
    setManagedAudioUrl(URL.createObjectURL(new Blob([audioBuffer], { type: "audio/wav" })));
    await playAudioWithLipSync(audioBuffer);
  };

  const sendChat = async () => {
    const userText = chatInput.trim();
    if (!userText || isChatRunning) return;
    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content: userText }];
    setChatInput("");
    setChatMessages(nextMessages);
    setIsChatRunning(true);
    setRuntimeStatus("OpenAI応答生成中");

    try {
      const response = await fetch("/api/openai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: openAiKey,
          model: openAiModel,
          systemPrompt,
          messages: nextMessages,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "OpenAI応答生成に失敗しました");
      const assistantMessage: ChatMessage = { role: "assistant", content: data.text };
      setChatMessages([...nextMessages, assistantMessage]);
      await synthesizeAndSpeak(assistantMessage.content);
    } catch (error) {
      setRuntimeStatus(error instanceof Error ? error.message : "実行に失敗しました");
    } finally {
      setIsChatRunning(false);
    }
  };

  const currentQuad = currentFrame?.quad;
  const runtimeMouthSprite = mouthSprites.find((sprite) => sprite.name === mouthState) ?? mouthSprites.find((sprite) => sprite.name === "closed") ?? mouthSprites[0];
  const runtimeQuad = runtimeFrame?.quad ?? track?.frames.find((frame) => frame.valid)?.quad ?? null;
  const runtimeAssetReady = Boolean(mouthlessUrl && mouthSprites.length && track);
  const materialAspectRatio =
    videoMeta.width && videoMeta.height ? videoMeta.width / videoMeta.height : track?.width && track.height ? track.width / track.height : 16 / 9;
  const runtimeAspectRatio = track?.width && track?.height ? track.width / track.height : 16 / 9;
  const defaultStreamingWidth = runtimePreviewSize.width > 0 ? runtimePreviewSize.width * 0.42 : 320;
  const placedStreamingWidth = streamingVideoLayout.isPlaced ? streamingVideoLayout.width : defaultStreamingWidth;
  const defaultStreamingX = runtimePreviewSize.width / 2 - placedStreamingWidth / 2;
  const defaultStreamingY = (runtimePreviewSize.height - 88) / 2 - placedStreamingWidth / runtimeAspectRatio / 2;
  const streamingDisplayLayout = clampStreamingLayout(
    streamingVideoLayout.isPlaced ? streamingVideoLayout.x : defaultStreamingX,
    streamingVideoLayout.isPlaced ? streamingVideoLayout.y : defaultStreamingY,
    placedStreamingWidth,
  );
  const streamingVideoWidth = streamingDisplayLayout.width;
  const streamingVideoX = streamingDisplayLayout.x;
  const streamingVideoY = streamingDisplayLayout.y;
  const materialVideoFrameStyle = fitMediaBox(
    Math.max(0, materialPreviewSize.width - 32),
    Math.max(0, materialPreviewSize.height - 80),
    materialAspectRatio,
  );
  const overlaySize = track
    ? { width: track.width, height: track.height }
    : { width: videoMeta.width, height: videoMeta.height };

  return (
    <main className="h-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="grid h-full grid-rows-[56px_minmax(0,1fr)]">
        <AppHeader mode={mode} onModeChange={setMode} />

        {mode === "materials" && (
          <MaterialsMode
            videoRef={videoRef}
            canvasRef={canvasRef}
            materialPreviewRef={materialPreviewRef}
            file={file}
            videoUrl={videoUrl}
            videoMeta={videoMeta}
            materialPreviewTab={materialPreviewTab}
            onPreviewTabChange={setMaterialPreviewTab}
            isDragging={isDragging}
            onDragStateChange={setIsDragging}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
            onMetadataLoaded={onMetadataLoaded}
            onTimeUpdate={() => updateFrameForCurrentTime()}
            onSeeked={() => updateFrameForCurrentTime()}
            onPlay={startTrackPlaybackSync}
            onPause={stopTrackPlaybackSync}
            onEnded={stopTrackPlaybackSync}
            currentQuad={currentQuad}
            overlaySize={overlaySize}
            videoFrameStyle={materialVideoFrameStyle}
            status={status}
            progress={progress}
            track={track}
            downloadUrl={downloadUrl}
            loadedTrackName={loadedTrackName}
            mouthSprites={mouthSprites}
            mouthStatus={mouthStatus}
            mouthlessUrl={mouthlessUrl}
            mouthlessStatus={mouthlessStatus}
            analysisFps={analysisFps}
            speedMode={speedMode}
            isAnalyzing={isAnalyzing}
            isRunningAll={isRunningAll}
            isExtractingMouth={isExtractingMouth}
            isGeneratingMouthless={isGeneratingMouthless}
            onAnalysisFpsChange={setAnalysisFps}
            onSpeedModeChange={setSpeedMode}
            onRunFullPipeline={runFullPipeline}
            onAnalyze={() => void analyzeVideo()}
            onStopAnalysis={stopAnalysis}
            onExtractMouth={() => void extractMouthSprites()}
            onGenerateMouthless={() => void generateMouthlessVideo()}
            onLoadTrackJson={loadTrackJson}
          />
        )}

        {mode === "streaming" && (
          <StreamingMode
            runtimePreviewRef={runtimePreviewRef}
            runtimeVideoRef={runtimeVideoRef}
            runtimeCompositeCanvasRef={runtimeCompositeCanvasRef}
            mouthlessUrl={mouthlessUrl}
            runtimeAspectRatio={runtimeAspectRatio}
            streamingVideoX={streamingVideoX}
            streamingVideoY={streamingVideoY}
            streamingVideoWidth={streamingVideoWidth}
            track={track}
            mouthState={mouthState}
            mouthSprites={mouthSprites}
            runtimeQuad={runtimeQuad}
            runtimeMouthSprite={runtimeMouthSprite}
            onPointerDown={startStreamingVideoMove}
            onPointerMove={updateStreamingVideoDrag}
            onPointerUp={stopStreamingVideoDrag}
            onResizeDown={startStreamingVideoResize}
            onRuntimeMetadataLoaded={updateRuntimeFrameForCurrentTime}
            onRuntimeTimeUpdate={updateRuntimeFrameForCurrentTime}
            isStreamingMenuOpen={isStreamingMenuOpen}
            onToggleMenu={() => setIsStreamingMenuOpen((c) => !c)}
            runtimeAssetReady={runtimeAssetReady}
            onLoadMouthlessFile={loadRuntimeMouthlessFile}
            onLoadTrackJson={loadTrackJson}
            onLoadMouthSprite={loadRuntimeMouthSprite}
            voicevoxUrl={voicevoxUrl}
            voicevoxStatus={voicevoxStatus}
            voicevoxSpeakers={voicevoxSpeakers}
            voicevoxSpeakerId={voicevoxSpeakerId}
            onVoicevoxUrlChange={setVoicevoxUrl}
            onVoicevoxSpeakerChange={setVoicevoxSpeakerId}
            onTestVoicevox={testVoicevox}
            openAiKey={openAiKey}
            openAiModel={openAiModel}
            systemPrompt={systemPrompt}
            chatInput={chatInput}
            chatMessages={chatMessages}
            isChatRunning={isChatRunning}
            audioUrl={audioUrl}
            onOpenAiKeyChange={setOpenAiKey}
            onOpenAiModelChange={setOpenAiModel}
            onSystemPromptChange={setSystemPrompt}
            onChatInputChange={setChatInput}
            onSendChat={() => void sendChat()}
            onStopSpeech={stopSpeech}
            onClearChat={() => setChatMessages([])}
          />
        )}
      </div>
    </main>
  );
}

