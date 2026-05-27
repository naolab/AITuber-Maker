"use client";

import {
  Activity,
  Bot,
  CircleStop,
  Download,
  FileJson,
  Mic2,
  Play,
  Settings,
  Sparkles,
  Upload,
  Video,
  Wand2,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactElement, useEffect, useRef, useState } from "react";

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

export default function Home() {
  const [mode, setMode] = useState<Mode>("materials");
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    trackRef.current = track;
  }, [track]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(videoUrlRef.current);
      revokeObjectUrl(downloadUrlRef.current);
      mouthSpriteUrlsRef.current.forEach(revokeObjectUrl);
      revokeObjectUrl(mouthlessUrlRef.current);
      workerRef.current?.terminate();
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
      setCurrentFrame(normalizedTrack.frames.find((frame) => frame.valid) ?? normalizedTrack.frames[0] ?? null);
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
      const blob = new Blob([JSON.stringify(nextTrack, null, 2)], { type: "application/json" });
      setManagedDownloadUrl(URL.createObjectURL(blob));
      setProgress(1);
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
      setVoicevoxStatus(`接続OK: ${data.speakers?.length ?? 0} speakers`);
    } catch (error) {
      setVoicevoxStatus(error instanceof Error ? error.message : "接続に失敗しました");
    }
  };

  const currentQuad = currentFrame?.quad;
  const overlaySize = track
    ? { width: track.width, height: track.height }
    : { width: videoMeta.width, height: videoMeta.height };

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-[#1d2430]">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1560px] items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-md border border-slate-200 bg-slate-50">
                <Sparkles className="size-5 text-teal-600" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">AITuber Maker</p>
                <h1 className="text-lg font-semibold">素材生成ワークスペース</h1>
              </div>
            </div>
            <nav className="flex rounded-md border border-slate-200 bg-slate-50 p-1">
              <ModeButton active={mode === "materials"} icon={<Wand2 />} label="素材生成" onClick={() => setMode("materials")} />
              <ModeButton active={mode === "runtime"} icon={<Bot />} label="AITuber実行" onClick={() => setMode("runtime")} />
              <ModeButton active={mode === "settings"} icon={<Settings />} label="設定" onClick={() => setMode("settings")} />
            </nav>
          </div>
        </header>

        {mode === "materials" && (
          <section className="mx-auto grid w-full max-w-[1560px] flex-1 grid-cols-[minmax(0,1fr)_390px] gap-4 px-5 py-4 max-lg:grid-cols-1">
            <div className="min-w-0">
              <div className={`relative grid min-h-[calc(100vh-132px)] overflow-auto rounded-md border border-slate-200 bg-white ${mouthlessUrl ? "place-items-start" : "place-items-center"}`}>
                {videoUrl ? (
                  <div className="mx-auto grid w-full max-w-4xl gap-4 p-4">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">元動画</p>
                      <div className="relative">
                        <video
                          ref={videoRef}
                          className="aspect-video w-full bg-black object-contain"
                          src={videoUrl}
                          controls
                          playsInline
                          onLoadedMetadata={onMetadataLoaded}
                          onTimeUpdate={() => updateFrameForCurrentTime()}
                          onSeeked={() => updateFrameForCurrentTime()}
                          onPlay={startTrackPlaybackSync}
                          onPause={stopTrackPlaybackSync}
                          onEnded={stopTrackPlaybackSync}
                        />
                        {currentQuad && overlaySize.width > 0 && (
                          <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`} preserveAspectRatio="xMidYMid meet">
                            <polygon points={currentQuad.map(([x, y]) => `${x},${y}`).join(" ")} className="fill-amber-300/20 stroke-amber-500" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                            <circle cx={currentQuad.reduce((sum, [x]) => sum + x, 0) / 4} cy={currentQuad.reduce((sum, [, y]) => sum + y, 0) / 4} r="5" className="fill-rose-500 stroke-white" vectorEffect="non-scaling-stroke" />
                          </svg>
                        )}
                      </div>
                    </div>
                    {mouthlessUrl && (
                      <div className="min-w-0">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">口無し動画</p>
                      <video
                        className="aspect-video w-full bg-black object-contain"
                        src={mouthlessUrl}
                        controls
                        playsInline
                        loop
                      />
                      </div>
                    )}
                  </div>
                ) : (
                  <label
                    className={`m-5 grid min-h-[520px] w-[calc(100%-40px)] cursor-pointer place-items-center rounded-md border border-dashed text-center transition ${isDragging ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50"}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                  >
                    <input className="sr-only" type="file" accept="video/*" onChange={handleFileInput} />
                    <span className="grid justify-items-center gap-3">
                      <span className="grid size-14 place-items-center rounded-md bg-teal-600 text-white">
                        <Upload className="size-7" />
                      </span>
                      <span className="text-3xl font-semibold">動画をアップロード</span>
                      <span className="text-sm text-slate-500">MP4、WebM、MOV などを選択またはドラッグ</span>
                    </span>
                  </label>
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
            </div>

            <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-md border border-slate-200 bg-white p-4">
              <PanelTitle icon={<Video />} title="入力動画" badge={status} />
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                <Upload className="size-4" />
                動画を選ぶ
                <input className="sr-only" type="file" accept="video/*" onChange={handleFileInput} />
              </label>
              <InfoGrid
                items={[
                  ["ファイル", file?.name ?? "未選択"],
                  ["サイズ", videoMeta.width ? `${videoMeta.width} x ${videoMeta.height}` : "-"],
                  ["長さ", videoMeta.duration ? formatTime(videoMeta.duration) : "-"],
                ]}
              />

              <div className="h-px bg-slate-200" />
              <PanelTitle icon={<Activity />} title="口追跡JSON生成" badge={isAnalyzing ? "実行中" : track ? "完了" : "待機"} />
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!file || !videoMeta.width || isRunningAll || isAnalyzing || isExtractingMouth || isGeneratingMouthless}
                onClick={runFullPipeline}
              >
                <Wand2 className="size-4" />
                解析から成果物生成まで実行
              </button>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">解析FPS</span>
                <input className="rounded-md border border-slate-200 px-3 py-2" type="number" min="1" max="60" value={analysisFps} onChange={(event) => setAnalysisFps(Number(event.target.value) || 1)} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">速度モード</span>
                <select className="rounded-md border border-slate-200 px-3 py-2" value={speedMode} onChange={(event) => setSpeedMode(event.target.value as SpeedMode)}>
                  {Object.entries(speedPresets).map(([value, preset]) => (
                    <option key={value} value={value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!file || !videoMeta.width || isAnalyzing || isRunningAll} onClick={() => void analyzeVideo()}>
                  <Play className="size-4" />
                  解析開始
                </button>
                <button className="flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:text-slate-400" disabled={!isAnalyzing} onClick={stopAnalysis}>
                  <CircleStop className="size-4" />
                  停止
                </button>
              </div>

              <a
                className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${downloadUrl ? "bg-slate-900 text-white" : "pointer-events-none bg-slate-100 text-slate-400"}`}
                href={downloadUrl || undefined}
                download="mouth_track.json"
              >
                <Download className="size-4" />
                mouth_track.json 保存
              </a>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold">
                <FileJson className="size-4" />
                mouth_track.json 読込
                <input className="sr-only" type="file" accept="application/json,.json" onChange={loadTrackJson} />
              </label>
              {loadedTrackName && <p className="truncate text-xs text-slate-500">読込中: {loadedTrackName}</p>}

              <div className="h-px bg-slate-200" />
              <PanelTitle icon={<FileJson />} title="口PNG差分" badge={mouthStatus} />
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!track || !videoUrl || isExtractingMouth || isRunningAll}
                onClick={() => void extractMouthSprites()}
              >
                <Play className="size-4" />
                5種を自動抽出
              </button>
              {mouthSprites.length > 0 && (
                <div className="grid grid-cols-5 gap-2">
                  {mouthSprites.map((sprite) => (
                    <a
                      className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-center text-xs font-medium"
                      download={`${sprite.name}.png`}
                      href={sprite.url}
                      key={sprite.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="aspect-square w-full rounded bg-white object-contain" src={sprite.url} alt={`${sprite.name} mouth`} />
                      <span>{sprite.name}</span>
                    </a>
                  ))}
                </div>
              )}

              <div className="h-px bg-slate-200" />
              <PanelTitle icon={<Video />} title="口無し動画" badge={mouthlessStatus} />
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!track || !videoUrl || isGeneratingMouthless || isRunningAll}
                onClick={() => void generateMouthlessVideo()}
              >
                <Play className="size-4" />
                口無しWebM生成
              </button>
              {mouthlessUrl && (
                <a className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white" href={mouthlessUrl} download="mouthless.webm">
                  <Download className="size-4" />
                  mouthless.webm 保存
                </a>
              )}
            </aside>
          </section>
        )}

        {mode === "runtime" && (
          <section className="mx-auto grid w-full max-w-[1560px] flex-1 grid-cols-[minmax(0,1fr)_420px] gap-4 px-5 py-4 max-lg:grid-cols-1">
            <div className="grid min-h-[calc(100vh-132px)] place-items-center rounded-md border border-slate-200 bg-white">
              <div className="text-center text-slate-500">
                <Bot className="mx-auto mb-3 size-10 text-teal-600" />
                <p className="font-semibold text-slate-800">PNGTuber表示エリア</p>
                <p className="text-sm">口無し動画と口PNG合成は素材生成後に接続します</p>
              </div>
            </div>
            <aside className="rounded-md border border-slate-200 bg-white p-4">
              <PanelTitle icon={<Mic2 />} title="VOICEVOX連携" badge={voicevoxStatus} />
              <label className="mt-4 grid gap-1 text-sm">
                <span className="font-medium">接続先URL</span>
                <input className="rounded-md border border-slate-200 px-3 py-2" value={voicevoxUrl} onChange={(event) => setVoicevoxUrl(event.target.value)} />
              </label>
              <button className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={testVoicevox}>
                接続テスト
              </button>
            </aside>
          </section>
        )}

        {mode === "settings" && (
          <section className="mx-auto w-full max-w-5xl flex-1 px-5 py-4">
            <div className="rounded-md border border-slate-200 bg-white p-5">
              <PanelTitle icon={<Settings />} title="設定" badge="初期項目" />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <SettingBlock title="OpenAI API" copy="Route Handler経由で接続する前提で、キー保存方針を次工程で実装します。" />
                <SettingBlock title="VOICEVOX" copy="接続テストと話者取得は /api/voicevox/speakers を経由します。" />
                <SettingBlock title="素材生成" copy="YOLO + HRNet worker、解析FPS、backend、速度モードを素材生成画面から操作できます。" />
                <SettingBlock title="保存" copy="初期版はブラウザから直接ダウンロードします。" />
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <button className={`flex items-center gap-2 rounded px-3 py-2 text-sm font-medium ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function PanelTitle({ icon, title, badge }: { icon: ReactElement; title: string; badge: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-slate-100 text-slate-700">{icon}</span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <span className="max-w-44 truncate rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{badge}</span>
    </div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      {items.map(([label, value]) => (
        <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2" key={label}>
          <dt className="text-slate-500">{label}</dt>
          <dd className="truncate font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SettingBlock({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
    </section>
  );
}
