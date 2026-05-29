"use client";

import {
  Activity,
  Bot,
  CircleStop,
  Download,
  FileJson,
  Image,
  Mic2,
  Minus,
  Play,
  Plus,
  Radio,
  Send,
  Settings,
  Sparkles,
  Upload,
  Video,
  Wand2,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactElement, useEffect, useRef, useState } from "react";

import type { GeneratedSprite, Mode, MouthFrame, MouthlessCleanPlate, MouthlessMask, MouthSpriteName, MouthTrack, Quad, SpeedMode, WorkerMessage } from "@/lib/materials";
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

type OpenAiModelsResponse = {
  data?: Array<{ id: string }>;
};

type AivisSpeakerStyle = {
  id: number;
  name: string;
};

type AivisSpeaker = {
  name: string;
  speaker_uuid?: string;
  styles: AivisSpeakerStyle[];
};

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
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
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
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

  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
  ]);
  const [ttsType, setTtsType] = useState<"aivis" | "voicevox" | "custom">("aivis");
  const [aivisUrl, setAivisUrl] = useState("http://127.0.0.1:10101");
  const [selectedSpeaker, setSelectedSpeaker] = useState("2");
  const [speakers, setSpeakers] = useState<AivisSpeaker[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [lastReply, setLastReply] = useState("");

  const [runtimeBgType, setRuntimeBgType] = useState<"color" | "image">("color");
  const [runtimeBgColor, setRuntimeBgColor] = useState("#f7f8fb");
  const [runtimeBgImageUrl, setRuntimeBgImageUrl] = useState("");
  const runtimeBgImageUrlRef = useRef("");

  const fetchOpenaiModels = async (key: string) => {
    if (!key) return;
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });
      if (res.ok) {
        const data = (await res.json()) as OpenAiModelsResponse;
        // Filter chat models (starts with gpt-) and exclude vision/instruct specific variants for simplicity
        const chatModels = (data.data ?? [])
          .map((model) => model.id)
          .filter((id: string) => id.startsWith("gpt-") && !id.includes("vision") && !id.includes("instruct"))
          .sort();
        if (chatModels.length > 0) {
          setAvailableModels(chatModels);
        }
      }
    } catch (err) {
      console.error("Failed to fetch OpenAI models:", err);
    }
  };

  const fetchSpeakers = async (url: string) => {
    try {
      const res = await fetch("/api/aivis/speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aivisUrl: url }),
      });
      if (res.ok) {
        const data = (await res.json()) as AivisSpeaker[];
        setSpeakers(data);
      }
    } catch (err) {
      console.error("Failed to fetch speakers:", err);
    }
  };

  useEffect(() => {
    window.requestAnimationFrame(() => {
      const key = localStorage.getItem("openai_api_key") || "";
      const model = localStorage.getItem("openai_model") || "gpt-4o-mini";
      const tts = (localStorage.getItem("tts_type") as "aivis" | "voicevox" | "custom") || "aivis";
      const url = localStorage.getItem("aivis_url") || "http://127.0.0.1:10101";
      const speaker = localStorage.getItem("aivis_speaker") || "2";
      const bgType = (localStorage.getItem("runtime_bg_type") as "color" | "image") || "color";
      const bgColor = localStorage.getItem("runtime_bg_color") || "#f7f8fb";

      setOpenaiApiKey(key);
      setOpenaiModel(model);
      setTtsType(tts);
      setAivisUrl(url);
      setSelectedSpeaker(speaker);
      setRuntimeBgType(bgType === "image" ? "color" : bgType);
      setRuntimeBgColor(bgColor);

      if (url) {
        void fetchSpeakers(url);
      }
      if (key) {
        void fetchOpenaiModels(key);
      }
    });
  }, []);

  const handleOpenaiKeyChange = (key: string) => {
    setOpenaiApiKey(key);
    localStorage.setItem("openai_api_key", key);
    void fetchOpenaiModels(key);
  };

  const handleOpenaiModelChange = (model: string) => {
    setOpenaiModel(model);
    localStorage.setItem("openai_model", model);
  };

  const handleTtsTypeChange = (type: "aivis" | "voicevox" | "custom") => {
    setTtsType(type);
    localStorage.setItem("tts_type", type);
    
    let targetUrl = aivisUrl;
    if (type === "aivis") {
      targetUrl = "http://127.0.0.1:10101";
    } else if (type === "voicevox") {
      targetUrl = "http://127.0.0.1:50021";
    }
    
    if (type !== "custom") {
      setAivisUrl(targetUrl);
      localStorage.setItem("aivis_url", targetUrl);
      void fetchSpeakers(targetUrl);
    }
  };

  const handleAivisUrlChange = (url: string) => {
    setAivisUrl(url);
    localStorage.setItem("aivis_url", url);
    void fetchSpeakers(url);
  };

  const handleSpeakerChange = (speaker: string) => {
    setSelectedSpeaker(speaker);
    localStorage.setItem("aivis_speaker", speaker);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !openaiApiKey || isChatSending) return;
    setIsChatSending(true);

    try {
      // 1. OpenAI Chat Completion
      const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          messages: [{ role: "user", content: chatInput }],
        }),
      });

      if (!chatRes.ok) {
        let errMsg = chatRes.statusText;
        try {
          const errData = await chatRes.json();
          if (errData.error?.message) {
            errMsg = errData.error.message;
          }
        } catch {}
        throw new Error(`OpenAI API returned error: ${errMsg}`);
      }

      const chatData = await chatRes.json();
      const replyText = chatData.choices[0].message.content;
      setLastReply(replyText);

      // 2. Aivis Speech synthesis
      const synthRes = await fetch("/api/aivis/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: replyText,
          speaker: Number(selectedSpeaker),
          aivisUrl,
        }),
      });

      if (!synthRes.ok) {
        throw new Error("Speech synthesis failed");
      }

      const audioBuffer = await synthRes.arrayBuffer();

      // 3. Play and sync mouth
      await playAudioAndSyncMouth(audioBuffer);

      setChatInput("");
    } catch (err) {
      console.error("Chat & LipSync error:", err);
      alert(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setIsChatSending(false);
    }
  };

  const playAudioAndSyncMouth = async (audioBuffer: ArrayBuffer) => {
    const AudioContextClass = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioContextClass) throw new Error("このブラウザはWeb Audio APIに対応していません");
    const audioCtx = new AudioContextClass();
    const buffer = await audioCtx.decodeAudioData(audioBuffer);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;

    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const data = new Uint8Array(analyser.fftSize);
    let animationFrameId = 0;
    let lastUpdateTime = 0;
    let smoothedLevel = 0;
    const UPDATE_INTERVAL = 50; // 更新間隔を50ms（約20fps）に縮めて追従性をアップ

    const syncMouth = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      const rawLevel = Math.min(rms * 10, 1); // 倍率を8から10に上げて小さな音でも反応しやすく

      // 音量が上がるときは即座に口を開き、下がるときはややなめらかに閉じる
      if (rawLevel > smoothedLevel) {
        smoothedLevel = rawLevel;
      } else {
        smoothedLevel = smoothedLevel * 0.6 + rawLevel * 0.4; // 減衰の引き継ぎを60%に抑えてメリハリを出す
      }

      const now = performance.now();
      if (now - lastUpdateTime >= UPDATE_INTERVAL) {
        lastUpdateTime = now;

        if (smoothedLevel > 0.45) { // 閾値を0.55から0.45に下げて大口を開けやすく
          setActiveMouthShape("open");
        } else if (smoothedLevel > 0.15) { // 閾値を0.22から0.15に下げて口を動かしやすく
          setActiveMouthShape("half");
        } else {
          setActiveMouthShape("closed");
        }
      }

      animationFrameId = requestAnimationFrame(syncMouth);
    };

    source.onended = () => {
      cancelAnimationFrame(animationFrameId);
      setActiveMouthShape("closed");
      audioCtx.close();
    };

    source.start(0);
    syncMouth();
  };

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDraggingVideo(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingVideo) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDraggingVideo(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomIntensity = 0.05;
    const nextScale = Math.min(Math.max(scale - e.deltaY * zoomIntensity * 0.01, 0.2), 5);
    setScale(nextScale);
  };

  const runtimeVideoRef = useRef<HTMLVideoElement | null>(null);
  const runtimeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeMouthShape, setActiveMouthShape] = useState<string>("closed");
  const runtimeLoopRef = useRef<number>(0);
  const runtimeImageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const updateRuntimeCanvas = () => {
    const video = runtimeVideoRef.current;
    const canvas = runtimeCanvasRef.current;
    if (!video || !canvas || !track?.frames.length) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frameIndex = Math.min(
      track.frames.length - 1,
      Math.max(0, Math.floor(video.currentTime * track.fps))
    );
    const frame = track.frames[frameIndex];

    if (frame?.valid && frame.quad) {
      const spriteName = activeMouthShape.toLowerCase();
      const sprite = mouthSprites.find((s) => s.name.toLowerCase() === spriteName) ||
                     mouthSprites.find((s) => s.name.toLowerCase() === "closed");

      if (sprite) {
        let img = runtimeImageCacheRef.current[sprite.url];
        if (!img) {
          img = new window.Image();
          img.src = sprite.url;
          runtimeImageCacheRef.current[sprite.url] = img;
        }

        if (img.complete && img.naturalWidth > 0) {
          drawWarpedPatch(ctx, img, frame.quad, img.naturalWidth || img.width, img.naturalHeight || img.height);
        }
      }
    }
  };

  useEffect(() => {
    if (mode !== "runtime" || !mouthlessUrl) {
      if (runtimeLoopRef.current) {
        cancelAnimationFrame(runtimeLoopRef.current);
        runtimeLoopRef.current = 0;
      }
      return;
    }

    const tick = () => {
      updateRuntimeCanvas();
      runtimeLoopRef.current = requestAnimationFrame(tick);
    };

    runtimeLoopRef.current = requestAnimationFrame(tick);

    return () => {
      if (runtimeLoopRef.current) {
        cancelAnimationFrame(runtimeLoopRef.current);
        runtimeLoopRef.current = 0;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mouthlessUrl, track, activeMouthShape, mouthSprites]);

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

  const handleMouthlessUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const isChromeVideo = file.type === "video/webm" || 
                            file.type === "video/mp4" || 
                            /\.(webm|mp4)$/i.test(file.name);
      if (!isChromeVideo) {
        alert("再生可能な動画形式ではありません。WebM または MP4 形式の動画をアップロードしてください。");
        event.target.value = "";
        return;
      }
      const url = URL.createObjectURL(file);
      setManagedMouthlessUrl(url);
      setMouthlessStatus("アップロード完了");
    }
  };

  const handleMouthSpriteUpload = (name: MouthSpriteName, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const newSprite: GeneratedSprite = {
      name,
      url,
      frameIndex: 0,
      width: 0,
      height: 0,
    };

    setManagedMouthSprites([
      ...mouthSprites.filter((s) => s.name !== name),
      newSprite,
    ]);
    setMouthStatus("手動追加");
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
      revokeObjectUrl(runtimeBgImageUrlRef.current);
      workerRef.current?.terminate();
      cancelScheduledFrameSync();
    };
  }, []);

  const handleBgImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      revokeObjectUrl(runtimeBgImageUrlRef.current);
      const url = URL.createObjectURL(file);
      runtimeBgImageUrlRef.current = url;
      setRuntimeBgImageUrl(url);
      setRuntimeBgType("image");
      localStorage.setItem("runtime_bg_type", "image");
    }
  };

  const handleBgColorChange = (color: string) => {
    setRuntimeBgColor(color);
    setRuntimeBgType("color");
    localStorage.setItem("runtime_bg_type", "color");
    localStorage.setItem("runtime_bg_color", color);
  };

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
    if (nextFile) {
      const isChromeVideo = nextFile.type === "video/webm" || 
                            nextFile.type === "video/mp4" || 
                            /\.(webm|mp4)$/i.test(nextFile.name);
      if (!isChromeVideo) {
        alert("再生可能な動画形式ではありません。WebM または MP4 形式の動画をアップロードしてください。");
        event.target.value = "";
        return;
      }
      loadVideoFile(nextFile);
    }
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) {
      const isChromeVideo = nextFile.type === "video/webm" || 
                            nextFile.type === "video/mp4" || 
                            /\.(webm|mp4)$/i.test(nextFile.name);
      if (!isChromeVideo) {
        alert("再生可能な動画形式ではありません。WebM または MP4 形式の動画をアップロードしてください。");
        return;
      }
      loadVideoFile(nextFile);
    }
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
        <header className="absolute top-0 left-0 w-full z-50 bg-transparent">
          <div className="mx-auto flex max-w-[1560px] items-center justify-start px-5 pt-6 pb-2">
            {isHeaderVisible ? (
              <div className="group relative flex items-center">
                <nav className="flex rounded-md border border-slate-200 bg-white p-1 shadow-sm transition-all duration-300">
                  <ModeButton active={mode === "materials"} icon={<Wand2 />} label="素材生成" onClick={() => setMode("materials")} />
                  <ModeButton active={mode === "runtime"} icon={<Radio />} label="配信モード" onClick={() => setMode("runtime")} />
                  <ModeButton active={mode === "settings"} icon={<Settings />} label="設定" onClick={() => setMode("settings")} />
                </nav>
                <button
                  onClick={() => setIsHeaderVisible(false)}
                  className="absolute -right-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 opacity-0 shadow-sm transition-all duration-200 hover:bg-slate-50 hover:text-slate-600 group-hover:opacity-100"
                  title="メニューを隠す"
                >
                  <Minus className="size-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsHeaderVisible(true)}
                className="flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white/80 text-slate-500 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-white hover:text-slate-800"
                title="メニューを表示"
              >
                <Plus className="size-4" />
              </button>
            )}
          </div>
        </header>

        {mode === "materials" && (
          <section className="mx-auto grid w-full max-w-[1560px] flex-1 grid-cols-[minmax(0,1fr)_390px] gap-4 px-5 pt-24 pb-4 max-lg:grid-cols-1">
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
                    <input className="sr-only" type="file" accept=".mp4,.webm" onChange={handleFileInput} />
                    <span className="grid justify-items-center gap-3">
                      <span className="grid size-14 place-items-center rounded-md bg-teal-600 text-white">
                        <Upload className="size-7" />
                      </span>
                      <span className="text-3xl font-semibold">動画をアップロード</span>
                      <span className="text-sm text-slate-500">MP4、WebM を選択またはドラッグ</span>
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
                <input className="sr-only" type="file" accept=".mp4,.webm" onChange={handleFileInput} />
              </label>


              <div className="h-px bg-slate-200" />
              <PanelTitle icon={<FileJson />} title="口追跡JSON生成" badge={isAnalyzing ? "実行中" : track ? "完了" : "待機"} />
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
              <PanelTitle icon={<Image />} title="口PNG差分" badge={mouthStatus} />
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!track || !videoUrl || isExtractingMouth || isRunningAll}
                onClick={() => void extractMouthSprites()}
              >
                <Play className="size-4" />
                5種を自動抽出
              </button>
              <div className="grid grid-cols-5 gap-2">
                {mouthSpriteNames.map((name) => {
                  const sprite = mouthSprites.find((s) => s.name === name);
                  return (
                    <label
                      key={name}
                      className="group relative grid gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 p-2 text-center text-xs font-medium cursor-pointer hover:border-teal-500 hover:bg-teal-50/10 transition"
                    >
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => handleMouthSpriteUpload(name, e)}
                      />
                      {sprite ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className="aspect-square w-full rounded bg-white object-contain" src={sprite.url} alt={`${name} mouth`} />
                          <span className="truncate text-slate-700">{name}</span>
                          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition rounded-md text-[10px]">
                            変更
                          </span>
                        </>
                      ) : (
                        <div className="flex aspect-square w-full flex-col items-center justify-center text-slate-400">
                          <Upload className="size-4" />
                          <span className="mt-1 text-[9px] truncate text-slate-500">{name}</span>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="h-px bg-slate-200" />
              <PanelTitle icon={<Video />} title="口無し動画" badge={mouthlessStatus} />
              <div className="flex gap-2">
                <button
                  className="flex-1 flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!track || !videoUrl || isGeneratingMouthless || isRunningAll}
                  onClick={() => void generateMouthlessVideo()}
                >
                  <Play className="size-4" />
                  口無し生成
                </button>
                <label className="flex-1 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
                  <Upload className="size-4" />
                  動画をアップ
                  <input className="sr-only" type="file" accept=".mp4,.webm" onChange={handleMouthlessUpload} />
                </label>
              </div>
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
          <div 
            className="relative w-full h-screen overflow-hidden"
            style={
              runtimeBgType === "image" && runtimeBgImageUrl
                ? {
                    backgroundImage: `url(${runtimeBgImageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : {
                    backgroundColor: runtimeBgColor,
                  }
            }
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {mouthlessUrl && (
              <div
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: "center center",
                  cursor: isDraggingVideo ? "grabbing" : "grab",
                }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none"
                onMouseDown={handleMouseDown}
                onWheel={handleWheel}
              >
                <video
                  ref={runtimeVideoRef}
                  className="pointer-events-none max-w-4xl"
                  src={mouthlessUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
                <canvas
                  ref={runtimeCanvasRef}
                  className="pointer-events-none absolute left-0 top-0 w-full h-full"
                />
              </div>
            )}

            {/* Chat Input Floating Form */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 flex flex-col items-center gap-4">
              {/* Latest Reply Bubble */}
              {lastReply && (
                <div className="rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 shadow-md backdrop-blur-sm max-w-full text-sm text-slate-800 transition-all">
                  {lastReply}
                </div>
              )}

              <div className="w-full flex gap-2 rounded-full border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm">
                <input
                  type="text"
                  placeholder={openaiApiKey ? "チャットで話しかける..." : "設定画面で OpenAI API キーを設定してください"}
                  value={chatInput}
                  disabled={!openaiApiKey || isChatSending}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      void sendChatMessage();
                    }
                  }}
                  className="flex-1 bg-transparent px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none disabled:cursor-not-allowed"
                />
                <button
                  onClick={() => void sendChatMessage()}
                  disabled={!chatInput.trim() || !openaiApiKey || isChatSending}
                  className="rounded-full bg-teal-600 p-2.5 text-white shadow-md hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 transition-all flex items-center justify-center"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "settings" && (
          <section className="mx-auto w-full max-w-2xl flex-1 px-5 pt-24 pb-4">
            <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
              <PanelTitle icon={<Settings />} title="連携設定" badge="連携設定" />
              
              <div className="mt-6 space-y-6">
                {/* OpenAI API Key */}
                <div className="grid gap-2">
                  <label className="text-sm font-semibold text-slate-800">OpenAI API キー</label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={openaiApiKey}
                    onChange={(e) => handleOpenaiKeyChange(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                  />
                  <p className="text-xs text-slate-500">APIキーはブラウザの localStorage にのみ保存されます。</p>
                </div>

                {/* OpenAI Model */}
                <div className="grid gap-2">
                  <label className="text-sm font-semibold text-slate-800">OpenAI モデル</label>
                  <select
                    value={openaiModel}
                    onChange={(e) => handleOpenaiModelChange(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white shadow-sm focus:border-teal-500 focus:outline-none"
                  >
                    {availableModels.map((model) => (
                      <option key={model} value={model}>
                        {model} {model === "gpt-4o-mini" ? "(推奨)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Voice Synthesis Engine Selection */}
                <div className="grid gap-2">
                  <label className="text-sm font-semibold text-slate-800">音声合成エンジン</label>
                  <div className="flex rounded-md border border-slate-200 bg-slate-50 p-1 w-fit">
                    <button
                      type="button"
                      onClick={() => handleTtsTypeChange("aivis")}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        ttsType === "aivis"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      Aivis Speech
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTtsTypeChange("voicevox")}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        ttsType === "voicevox"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      VOICEVOX
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTtsTypeChange("custom")}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        ttsType === "custom"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      カスタム
                    </button>
                  </div>
                </div>

                {/* Aivis Speech / VOICEVOX URL (Visible only when 'custom' is selected) */}
                {ttsType === "custom" && (
                  <div className="grid gap-2">
                    <label className="text-sm font-semibold text-slate-800">接続先URL</label>
                    <input
                      type="text"
                      placeholder="http://127.0.0.1:10101"
                      value={aivisUrl}
                      onChange={(e) => handleAivisUrlChange(e.target.value)}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500">カスタム接続先アドレスを指定します。</p>
                  </div>
                )}

                {/* Aivis Speech Speaker */}
                <div className="grid gap-2">
                  <label className="text-sm font-semibold text-slate-800">キャラクター音声（話者）</label>
                  <select
                    value={selectedSpeaker}
                    onChange={(e) => handleSpeakerChange(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white shadow-sm focus:border-teal-500 focus:outline-none"
                  >
                    {speakers.length > 0 ? (
                      speakers.map((sp) =>
                        sp.styles.map((style) => (
                          <option key={`${sp.speaker_uuid}-${style.id}`} value={style.id}>
                            {sp.name} ({style.name})
                          </option>
                        ))
                      )
                    ) : (
                      <option value="2">四国めたん (ノーマル) [接続待ち...]</option>
                    )}
                  </select>
                </div>

                {/* Runtime Background settings */}
                <div className="h-px bg-slate-200 my-4" />
                
                <div className="grid gap-4">
                  <label className="text-sm font-semibold text-slate-800">配信モードの背景</label>
                  
                  {/* Selector between Color and Image */}
                  <div className="flex rounded-md border border-slate-200 bg-slate-50 p-1 w-fit">
                    <button
                      type="button"
                      onClick={() => {
                        setRuntimeBgType("color");
                        localStorage.setItem("runtime_bg_type", "color");
                      }}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        runtimeBgType === "color"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      単色背景
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRuntimeBgType("image");
                        localStorage.setItem("runtime_bg_type", "image");
                      }}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        runtimeBgType === "image"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      背景画像
                    </button>
                  </div>

                  {runtimeBgType === "color" ? (
                    <div className="grid gap-3">
                      {/* Presets */}
                      <div className="flex gap-2">
                        {[
                          ["#f7f8fb", "標準"],
                          ["#00ff00", "グリーンバック"],
                          ["#ffffff", "ホワイト"],
                          ["#000000", "ブラック"],
                        ].map(([color, name]) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => handleBgColorChange(color)}
                            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-slate-50"
                          >
                            <span
                              className="size-3.5 rounded-full border border-slate-300"
                              style={{ backgroundColor: color }}
                            />
                            {name}
                          </button>
                        ))}
                      </div>
                      
                      {/* Custom Color Picker */}
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={runtimeBgColor}
                          onChange={(e) => handleBgColorChange(e.target.value)}
                          className="size-8 cursor-pointer rounded border border-slate-200"
                        />
                        <span className="text-xs text-slate-500">カスタムカラーを選択</span>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <label className="flex max-w-sm cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100/50 transition">
                        <Upload className="size-4" />
                        背景画像をアップロード
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleBgImageUpload}
                        />
                      </label>
                      {runtimeBgImageUrl && (
                        <div className="mt-2 max-w-xs relative rounded-md border border-slate-200 bg-slate-50 p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={runtimeBgImageUrl}
                            alt="Background Preview"
                            className="aspect-video w-full rounded object-cover"
                          />
                          <p className="mt-1 text-center text-[10px] text-slate-500 truncate">アップロード完了</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
