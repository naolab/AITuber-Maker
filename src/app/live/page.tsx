"use client";

import { PointerEvent, WheelEvent, useCallback, useEffect, useRef, useState } from "react";

import type { PresentationLiveState } from "@/lib/presentation";
import { defaultPresentationLiveState } from "@/lib/presentation";
import type { GeneratedSprite, MouthTrack, Quad } from "@/lib/materials";
import { drawWarpedPatch, waitForEvent } from "@/lib/materials";

type Emotion = "normal" | "happy" | "angry" | "surprised" | "sad";

type EmotionAsset = {
  videoUrl: string;
  track: MouthTrack | null;
  mouthSprites: GeneratedSprite[];
};

type StoredFile = {
  file: File;
  name: string;
};

type StoredTrack = {
  track: MouthTrack;
  name: string;
};

type YouTubeChatMessage = {
  id: string;
  authorName: string;
  authorImageUrl: string;
  message: string;
  publishedAt: string;
  type: string;
  isOwner: boolean;
  isModerator: boolean;
  isSponsor: boolean;
};

type YouTubeLiveChatResponse = {
  liveChatId?: string;
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  fetchedCount?: number;
  messages?: YouTubeChatMessage[];
  error?: string;
};

type LiveSpeechMessage = {
  type: "speech";
  id?: string;
  emotion: Emotion;
  text: string;
  audioBuffer: ArrayBuffer;
  sourceComment?: LiveSpeechSourceComment;
  presentationState?: PresentationLiveState;
};

type LiveSpeechStartedMessage = {
  type: "speech-started";
  id: string;
};

type LiveSpeechSourceComment = {
  id?: string;
  authorName: string;
  message: string;
};

type StoredLiveSpeech = {
  id: string;
  emotion: Emotion;
  text: string;
  audioBase64: string;
  contentType: string;
  sourceComment?: LiveSpeechSourceComment;
  createdAt: number;
};

type LiveSpeechResponse = {
  speech?: StoredLiveSpeech | null;
};

type PresentationLiveResponse = {
  state?: PresentationLiveState;
};

type PendingSpeech = {
  id?: string;
  emotion: Emotion;
  text: string;
  audioBuffer: ArrayBuffer;
  sourceComment?: LiveSpeechSourceComment;
  presentationState?: PresentationLiveState;
};

type ServerLiveAsset = {
  videoUrl?: string;
  trackUrl?: string;
  mouthSprites?: Array<{
    name: string;
    url: string;
  }>;
};

type ServerLiveAssetsResponse = {
  assets?: Partial<Record<Emotion, ServerLiveAsset>>;
};

type LiveSettingsResponse = Partial<{
  bgType: "color" | "image";
  bgColor: string;
  youtubeApiKey: string;
  youtubeVideoId: string;
  youtubeLiveChatId: string;
  youtubeChatEnabled: boolean;
  characterLayout: OverlayLayout;
  chatLayout: OverlayLayout;
}>;

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type OverlayLayout = {
  x: number;
  y: number;
  scale: number;
};

type DragTarget = "character" | "chat";

type DragState = {
  target: DragTarget;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLayout: OverlayLayout;
};

const DB_NAME = "AITuberMakerAssets";
const DB_VERSION = 1;
const STORE_NAME = "assets";
const LIVE_OUTPUT_CHANNEL = "aituber-maker-live-output";
const EMOTIONS: Emotion[] = ["normal", "happy", "angry", "surprised", "sad"];
const MOUTH_SPRITE_NAMES = ["closed", "half", "open", "e", "u"];
const CHARACTER_LAYOUT_KEY = "live_character_layout";
const CHAT_LAYOUT_KEY = "live_chat_layout";
const LIVE_CHAT_VISIBLE_COUNT = 10;
const DEFAULT_CHARACTER_LAYOUT: OverlayLayout = { x: 0, y: 0, scale: 1 };
const DEFAULT_CHAT_LAYOUT: OverlayLayout = { x: 0, y: 0, scale: 1 };

const base64ToArrayBuffer = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const isEmotion = (value: unknown): value is Emotion =>
  value === "normal" || value === "happy" || value === "angry" || value === "surprised" || value === "sad";

const isReadingSourceComment = (message: YouTubeChatMessage, sourceComment: LiveSpeechSourceComment | null) => {
  if (!sourceComment) return false;
  if (sourceComment.id) return message.id === sourceComment.id;
  return message.authorName === sourceComment.authorName && message.message === sourceComment.message;
};

const createPinnedSourceMessage = (sourceComment: LiveSpeechSourceComment): YouTubeChatMessage => ({
  id: sourceComment.id || `source-comment-${sourceComment.authorName}-${sourceComment.message}`,
  authorName: sourceComment.authorName,
  authorImageUrl: "",
  message: sourceComment.message,
  publishedAt: "",
  type: "textMessageEvent",
  isOwner: false,
  isModerator: false,
  isSponsor: false,
});

const isImportableQuad = (value: unknown): value is Quad =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      point.every((coordinate) => Number.isFinite(coordinate)),
  );

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const readStoredLayout = (key: string, fallback: OverlayLayout) => {
  try {
    const rawValue = localStorage.getItem(key);
    if (!rawValue) return fallback;
    const value = JSON.parse(rawValue) as Partial<OverlayLayout>;
    const x = Number(value.x);
    const y = Number(value.y);
    const scale = Number(value.scale);
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      scale: Number.isFinite(scale) ? clamp(scale, 0.2, 5) : fallback.scale,
    };
  } catch {
    return fallback;
  }
};

const writeStoredLayout = (key: string, value: OverlayLayout) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const loadSharedLiveSettings = async () => {
  const response = await fetch("/api/live-settings", { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as LiveSettingsResponse;
};

const saveSharedLiveSettings = async (patch: LiveSettingsResponse) => {
  await fetch("/api/live-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
};

function initDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

function getAsset<T>(key: string): Promise<T | null> {
  return initDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve((request.result as T) || null);
      }),
  );
}

const sanitizeTrack = (track: MouthTrack): MouthTrack => ({
  ...track,
  frames: track.frames.map((frame) => ({
    ...frame,
    valid: Boolean(frame.valid && isImportableQuad(frame.quad)),
  })),
});

const loadServerLiveAssets = async () => {
  const response = await fetch("/api/live-assets", { cache: "no-store" });
  if (!response.ok) throw new Error("OBS用素材の取得に失敗しました");

  const data = (await response.json()) as ServerLiveAssetsResponse;
  const nextAssets = {} as Record<Emotion, EmotionAsset>;

  for (const emotion of EMOTIONS) {
    const asset = data.assets?.[emotion];
    let track: MouthTrack | null = null;
    if (asset?.trackUrl) {
      const trackResponse = await fetch(asset.trackUrl, { cache: "no-store" });
      if (trackResponse.ok) {
        track = sanitizeTrack((await trackResponse.json()) as MouthTrack);
      }
    }

    nextAssets[emotion] = {
      videoUrl: asset?.videoUrl || "",
      track,
      mouthSprites:
        asset?.mouthSprites?.map((sprite) => ({
          name: sprite.name,
          url: sprite.url,
        } as GeneratedSprite)) || [],
    };
  }

  return nextAssets;
};

export default function LiveOutputPage() {
  const [assets, setAssets] = useState<Record<Emotion, EmotionAsset>>({
    normal: { videoUrl: "", track: null, mouthSprites: [] },
    happy: { videoUrl: "", track: null, mouthSprites: [] },
    angry: { videoUrl: "", track: null, mouthSprites: [] },
    surprised: { videoUrl: "", track: null, mouthSprites: [] },
    sad: { videoUrl: "", track: null, mouthSprites: [] },
  });
  const [status, setStatus] = useState("配信素材を読み込み中");
  const [activeEmotion, setActiveEmotion] = useState<Emotion>("normal");
  const [mouthShape, setMouthShape] = useState("closed");
  const [lastReply, setLastReply] = useState("");
  const [activeSourceComment, setActiveSourceComment] = useState<LiveSpeechSourceComment | null>(null);
  const [isSourceCommentHighlightActive, setIsSourceCommentHighlightActive] = useState(false);
  const [pendingSpeech, setPendingSpeech] = useState<PendingSpeech | null>(null);
  const [bgType, setBgType] = useState<"color" | "image">("color");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgImageUrl] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState("");
  const [youtubeLiveChatId, setYoutubeLiveChatId] = useState("");
  const [isYoutubeChatEnabled, setIsYoutubeChatEnabled] = useState(false);
  const [youtubeChatStatus, setYoutubeChatStatus] = useState("未接続");
  const [youtubeMessages, setYoutubeMessages] = useState<YouTubeChatMessage[]>([]);
  const [characterLayout, setCharacterLayout] = useState<OverlayLayout>(DEFAULT_CHARACTER_LAYOUT);
  const [chatLayout, setChatLayout] = useState<OverlayLayout>(DEFAULT_CHAT_LAYOUT);
  const [activeVideoIndex, setActiveVideoIndex] = useState<0 | 1>(0);
  const [presentationState, setPresentationState] = useState<PresentationLiveState>(defaultPresentationLiveState);

  const videoRef0 = useRef<HTMLVideoElement | null>(null);
  const videoRef1 = useRef<HTMLVideoElement | null>(null);
  const activeVideoIndexRef = useRef<0 | 1>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef(0);
  const characterLayoutRef = useRef(DEFAULT_CHARACTER_LAYOUT);
  const chatLayoutRef = useRef(DEFAULT_CHAT_LAYOUT);
  const dragStateRef = useRef<DragState | null>(null);
  const assetsRef = useRef(assets);
  const activeEmotionRef = useRef<Emotion>("normal");
  const mouthShapeRef = useRef("closed");
  const videoAsset0Ref = useRef<Emotion>("normal");
  const videoAsset1Ref = useRef<Emotion>("normal");
  const pendingSpeechRef = useRef<PendingSpeech | null>(null);
  const isSpeakingRef = useRef(false);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const objectUrlsRef = useRef<string[]>([]);
  const youtubeNextPageTokenRef = useRef("");
  const youtubeMessageIdsRef = useRef<Set<string>>(new Set());
  const youtubeLiveChatIdRef = useRef("");
  const youtubeSourceKeyRef = useRef("");
  const lastSpeechIdRef = useRef("");
  const overlayHideTimerRef = useRef(0);
  const sourceCommentSettleTimerRef = useRef(0);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    activeEmotionRef.current = activeEmotion;
  }, [activeEmotion]);

  const getActiveVideo = () => (activeVideoIndexRef.current === 0 ? videoRef0.current : videoRef1.current);

  const loadEmotionIntoVideo = useCallback(async (emotion: Emotion, video: HTMLVideoElement) => {
    const asset = assetsRef.current[emotion];
    if (!asset?.videoUrl) return false;
    if (video.src !== asset.videoUrl) {
      try {
        video.src = asset.videoUrl;
        video.load();
        await waitForEvent(video, "canplay");
      } catch (error) {
        console.error(error);
        setStatus(`${emotion}素材の動画を読み込めませんでした`);
        return false;
      }
    }
    return true;
  }, []);

  const switchActiveVideo = () => {
    const activeIndex = activeVideoIndexRef.current;
    const nextIndex: 0 | 1 = activeIndex === 0 ? 1 : 0;
    const previousVideo = activeIndex === 0 ? videoRef0.current : videoRef1.current;
    previousVideo?.pause();
    activeVideoIndexRef.current = nextIndex;
    setActiveVideoIndex(nextIndex);
  };

  const showSpeechOverlay = useCallback((text: string, sourceComment?: LiveSpeechSourceComment) => {
    setLastReply(text);
    setActiveSourceComment(sourceComment ?? null);
    setIsSourceCommentHighlightActive(Boolean(sourceComment));
    if (overlayHideTimerRef.current) {
      window.clearTimeout(overlayHideTimerRef.current);
    }
    if (sourceCommentSettleTimerRef.current) {
      window.clearTimeout(sourceCommentSettleTimerRef.current);
    }
    overlayHideTimerRef.current = window.setTimeout(() => {
      setLastReply("");
      setIsSourceCommentHighlightActive(false);
      sourceCommentSettleTimerRef.current = window.setTimeout(() => {
        setActiveSourceComment(null);
        sourceCommentSettleTimerRef.current = 0;
      }, 900);
      overlayHideTimerRef.current = 0;
    }, 8000);
  }, []);

  useEffect(() => {
    mouthShapeRef.current = mouthShape;
  }, [mouthShape]);

  useEffect(() => {
    pendingSpeechRef.current = pendingSpeech;
  }, [pendingSpeech]);

  useEffect(() => {
    youtubeLiveChatIdRef.current = youtubeLiveChatId;
  }, [youtubeLiveChatId]);

  useEffect(() => {
    characterLayoutRef.current = characterLayout;
  }, [characterLayout]);

  useEffect(() => {
    chatLayoutRef.current = chatLayout;
  }, [chatLayout]);

  const loadSettings = useCallback(async () => {
    const settings = await loadSharedLiveSettings().catch(() => null);
    const nextBgType = settings?.bgType || (localStorage.getItem("runtime_bg_type") === "image" ? "image" : "color");
    const nextYoutubeApiKey = settings?.youtubeApiKey ?? localStorage.getItem("youtube_api_key") ?? "";
    const nextYoutubeVideoId = settings?.youtubeVideoId ?? localStorage.getItem("youtube_video_id") ?? "";
    const nextYoutubeLiveChatId = settings?.youtubeLiveChatId ?? localStorage.getItem("youtube_live_chat_id") ?? "";
    const nextYoutubeSourceKey = `${nextYoutubeApiKey}|${nextYoutubeVideoId}|${nextYoutubeLiveChatId}`;

    setBgType(nextBgType);
    setBgColor(settings?.bgColor || localStorage.getItem("runtime_bg_color") || "#ffffff");
    setYoutubeApiKey(nextYoutubeApiKey);
    setYoutubeVideoId(nextYoutubeVideoId);
    setYoutubeLiveChatId(nextYoutubeLiveChatId);
    setIsYoutubeChatEnabled(settings?.youtubeChatEnabled ?? localStorage.getItem("youtube_chat_enabled") === "true");

    if (youtubeSourceKeyRef.current !== nextYoutubeSourceKey) {
      youtubeSourceKeyRef.current = nextYoutubeSourceKey;
      youtubeNextPageTokenRef.current = "";
      youtubeMessageIdsRef.current = new Set();
      setYoutubeMessages([]);
      setYoutubeChatStatus(nextYoutubeApiKey ? "接続準備中" : "APIキーと動画IDが必要");
    }

    if (!dragStateRef.current) {
      setCharacterLayout(settings?.characterLayout || readStoredLayout(CHARACTER_LAYOUT_KEY, DEFAULT_CHARACTER_LAYOUT));
      setChatLayout(settings?.chatLayout || readStoredLayout(CHAT_LAYOUT_KEY, DEFAULT_CHAT_LAYOUT));
    }
  }, []);

  const updateLayout = useCallback((target: DragTarget, updater: (current: OverlayLayout) => OverlayLayout, persist = false) => {
    if (target === "character") {
      setCharacterLayout((current) => {
        const next = updater(current);
        characterLayoutRef.current = next;
        writeStoredLayout(CHARACTER_LAYOUT_KEY, next);
        if (persist) void saveSharedLiveSettings({ characterLayout: next });
        return next;
      });
      return;
    }

    setChatLayout((current) => {
      const next = updater(current);
      chatLayoutRef.current = next;
      writeStoredLayout(CHAT_LAYOUT_KEY, next);
      if (persist) void saveSharedLiveSettings({ chatLayout: next });
      return next;
    });
  }, []);

  const startDrag = useCallback((target: DragTarget, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      target,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayout: target === "character" ? characterLayoutRef.current : chatLayoutRef.current,
    };
  }, []);

  const handleDragMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    const nextLayout = {
      ...dragState.startLayout,
      x: dragState.startLayout.x + event.clientX - dragState.startClientX,
      y: dragState.startLayout.y + event.clientY - dragState.startClientY,
    };
    updateLayout(dragState.target, () => nextLayout);
  }, [updateLayout]);

  const stopDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    const layout = dragState.target === "character" ? characterLayoutRef.current : chatLayoutRef.current;
    void saveSharedLiveSettings(dragState.target === "character" ? { characterLayout: layout } : { chatLayout: layout });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleLayoutWheel = useCallback((target: DragTarget, event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    updateLayout(target, (current) => ({
      ...current,
      scale: clamp(current.scale - event.deltaY * 0.0015, 0.2, 5),
    }), true);
  }, [updateLayout]);

  const loadAssets = useCallback(async () => {
    const nextAssets = {} as Record<Emotion, EmotionAsset>;
    const nextUrls: string[] = [];

    for (const emotion of EMOTIONS) {
      const videoData = await getAsset<StoredFile>(`emotion_${emotion}_video`);
      const trackData = await getAsset<StoredTrack>(`emotion_${emotion}_track`);
      const sprites: GeneratedSprite[] = [];

      for (const name of MOUTH_SPRITE_NAMES) {
        const spriteData = await getAsset<StoredFile>(`emotion_${emotion}_mouthSprite_${name}`);
        if (spriteData?.file) {
          const url = URL.createObjectURL(spriteData.file);
          nextUrls.push(url);
          sprites.push({ name, url } as GeneratedSprite);
        }
      }

      let videoUrl = "";
      if (videoData?.file) {
        videoUrl = URL.createObjectURL(videoData.file);
        nextUrls.push(videoUrl);
      }

      nextAssets[emotion] = {
        videoUrl,
        track: trackData?.track ? sanitizeTrack(trackData.track) : null,
        mouthSprites: sprites,
      };
    }

    let loadedAssets = nextAssets;
    let loadedUrls = nextUrls;
    let normalAsset = loadedAssets.normal;

    if (!normalAsset.videoUrl || !normalAsset.track) {
      loadedUrls.forEach((url) => URL.revokeObjectURL(url));
      loadedUrls = [];
      loadedAssets = await loadServerLiveAssets();
      normalAsset = loadedAssets.normal;
    }

    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = loadedUrls;
    setAssets(loadedAssets);

    if (!normalAsset.videoUrl || !normalAsset.track) {
      setStatus("通常素材の動画と mouth_track.json が必要です");
      return;
    }

    setStatus("配信待機中");
    setActiveEmotion("normal");
    const video = videoRef0.current;
    if (video) {
      video.src = normalAsset.videoUrl;
      video.load();
      videoAsset0Ref.current = "normal";
      activeVideoIndexRef.current = 0;
      setActiveVideoIndex(0);
      void video.play();
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadSettings();
      void loadAssets().catch((error) => {
        console.error(error);
        setStatus(error instanceof Error ? error.message : "配信素材の読み込みに失敗しました");
      });
    }, 0);

    const settingsPoll = window.setInterval(() => {
      void loadSettings();
    }, 1500);
    const handleStorage = () => void loadSettings();
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearInterval(settingsPoll);
      window.removeEventListener("storage", handleStorage);
      if (overlayHideTimerRef.current) window.clearTimeout(overlayHideTimerRef.current);
      if (sourceCommentSettleTimerRef.current) window.clearTimeout(sourceCommentSettleTimerRef.current);
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [loadAssets, loadSettings]);

  useEffect(() => {
    const video = videoRef0.current;
    if (!video || !assets.normal.videoUrl) return;
    video.src = assets.normal.videoUrl;
    video.load();
    videoAsset0Ref.current = "normal";
    activeVideoIndexRef.current = 0;
    setActiveVideoIndex(0);
    void video.play();
  }, [assets.normal.videoUrl]);

  const playAudioAndSyncMouth = useCallback(async (audioBuffer: ArrayBuffer, speechId?: string, presentationState?: PresentationLiveState) => {
    const AudioContextClass = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioContextClass) {
      setStatus("このブラウザはWeb Audio APIに対応していません");
      return;
    }

    const audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const buffer = await audioCtx.decodeAudioData(audioBuffer.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let lastUpdateTime = 0;
    let smoothedLevel = 0;

    const sync = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rawLevel = Math.min(Math.sqrt(sum / data.length) * 10, 1);
      smoothedLevel = rawLevel > smoothedLevel ? rawLevel : smoothedLevel * 0.6 + rawLevel * 0.4;

      const now = performance.now();
      if (now - lastUpdateTime >= 50) {
        lastUpdateTime = now;
        if (smoothedLevel > 0.45) setMouthShape("open");
        else if (smoothedLevel > 0.15) setMouthShape("half");
        else setMouthShape("closed");
      }

      frame = requestAnimationFrame(sync);
    };

    source.onended = () => {
      cancelAnimationFrame(frame);
      setMouthShape("closed");
      void audioCtx.close();
      isSpeakingRef.current = false;
    };

    isSpeakingRef.current = true;
    setStatus("発話中");
    if (presentationState) {
      setPresentationState(presentationState);
      void fetch("/api/presentation-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(presentationState),
      });
    }
    source.start(0);
    if (speechId && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel(LIVE_OUTPUT_CHANNEL);
      const message: LiveSpeechStartedMessage = { type: "speech-started", id: speechId };
      channel.postMessage(message);
      channel.close();
    }
    sync();
  }, []);

  const queueLiveSpeech = useCallback((speech: PendingSpeech) => {
    setPendingSpeech(speech);
    pendingSpeechRef.current = speech;
  }, []);

  const handleVideoEnded = useCallback(async () => {
    const activeIndex = activeVideoIndexRef.current;
    const currentVideo = activeIndex === 0 ? videoRef0.current : videoRef1.current;
    const nextVideo = activeIndex === 0 ? videoRef1.current : videoRef0.current;
    const currentAssetRef = activeIndex === 0 ? videoAsset0Ref : videoAsset1Ref;
    const nextAssetRef = activeIndex === 0 ? videoAsset1Ref : videoAsset0Ref;

    if (!currentVideo || !nextVideo) return;

    const pending = pendingSpeechRef.current;
    if (pending) {
      const nextEmotion = assetsRef.current[pending.emotion]?.videoUrl ? pending.emotion : "normal";
      const loaded = await loadEmotionIntoVideo(nextEmotion, nextVideo);
      if (loaded) {
        nextAssetRef.current = nextEmotion;
        setActiveEmotion(nextEmotion);
        activeEmotionRef.current = nextEmotion;
      }

      showSpeechOverlay(pending.text, pending.sourceComment);
      await playAudioAndSyncMouth(pending.audioBuffer, pending.id, pending.presentationState);
      setPendingSpeech(null);
      pendingSpeechRef.current = null;

      if (loaded) {
        void nextVideo.play();
        switchActiveVideo();
      } else {
        currentVideo.currentTime = 0;
        void currentVideo.play();
      }
      return;
    }

    const currentEmotion = currentAssetRef.current;
    if (!isSpeakingRef.current && currentEmotion !== "normal") {
      const loaded = await loadEmotionIntoVideo("normal", nextVideo);
      if (loaded) {
        nextAssetRef.current = "normal";
        setActiveEmotion("normal");
        activeEmotionRef.current = "normal";
        setStatus("配信待機中");
        void nextVideo.play();
        switchActiveVideo();
      } else {
        currentVideo.currentTime = 0;
        void currentVideo.play();
      }
      return;
    }

    currentVideo.currentTime = 0;
    void currentVideo.play();
  }, [loadEmotionIntoVideo, playAudioAndSyncMouth, showSpeechOverlay]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) {
      return;
    }

    const channel = new BroadcastChannel(LIVE_OUTPUT_CHANNEL);
    channel.onmessage = (event: MessageEvent<LiveSpeechMessage>) => {
      const message = event.data;
      if (message?.type !== "speech" || !isEmotion(message.emotion)) return;
      if (message.id) lastSpeechIdRef.current = message.id;

      queueLiveSpeech({
        id: message.id,
        emotion: message.emotion,
        text: message.text,
        audioBuffer: message.audioBuffer,
        sourceComment: message.sourceComment,
        presentationState: message.presentationState,
      });
    };

    return () => channel.close();
  }, [queueLiveSpeech]);

  useEffect(() => {
    let disposed = false;
    let timer = 0;

    const poll = async () => {
      try {
        const response = await fetch("/api/live-speech", { cache: "no-store" });
        const data = (await response.json()) as LiveSpeechResponse;
        const speech = data.speech;
        if (!disposed && speech && speech.id !== lastSpeechIdRef.current && isEmotion(speech.emotion)) {
          lastSpeechIdRef.current = speech.id;
          queueLiveSpeech({
            id: speech.id,
            emotion: speech.emotion,
            text: speech.text,
            audioBuffer: base64ToArrayBuffer(speech.audioBase64),
            sourceComment: speech.sourceComment,
          });
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!disposed) timer = window.setTimeout(poll, 1000);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [queueLiveSpeech]);

  useEffect(() => {
    let disposed = false;
    let timer = 0;

    const poll = async () => {
      try {
        const response = await fetch("/api/presentation-live", { cache: "no-store" });
        const data = (await response.json()) as PresentationLiveResponse;
        if (!disposed && data.state) {
          setPresentationState((current) => data.state && data.state.updatedAt >= current.updatedAt ? data.state : current);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!disposed) timer = window.setTimeout(poll, 700);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const video = getActiveVideo();
      const canvas = canvasRef.current;
      const asset = assetsRef.current[activeEmotionRef.current];

      if (!video || !canvas || !asset?.track?.frames.length || video.videoWidth === 0) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frameIndex = Math.min(
        asset.track.frames.length - 1,
        Math.max(0, Math.floor(video.currentTime * asset.track.fps)),
      );
      const frame = asset.track.frames[frameIndex];
      if (frame?.valid && frame.quad) {
        const normalSprites = assetsRef.current.normal.mouthSprites;
        const activeSprites = asset.mouthSprites.length > 0 ? asset.mouthSprites : normalSprites;
        const sprite =
          activeSprites.find((item) => item.name.toLowerCase() === mouthShapeRef.current) ||
          activeSprites.find((item) => item.name.toLowerCase() === "closed");

        if (sprite) {
          let img = imageCacheRef.current[sprite.url];
          if (!img) {
            img = new window.Image();
            img.src = sprite.url;
            imageCacheRef.current[sprite.url] = img;
          }
          if (img.complete && img.naturalWidth > 0) {
            drawWarpedPatch(ctx, img, frame.quad, img.naturalWidth || img.width, img.naturalHeight || img.height);
          }
        }
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  const fetchYoutubeLiveChat = useCallback(async () => {
    if (!youtubeApiKey || (!youtubeVideoId && !youtubeLiveChatIdRef.current)) {
      setYoutubeChatStatus("APIキーと動画IDが必要");
      return 5000;
    }

    const params = new URLSearchParams({ apiKey: youtubeApiKey });
    if (youtubeVideoId) params.set("videoId", youtubeVideoId);
    if (youtubeLiveChatIdRef.current) params.set("liveChatId", youtubeLiveChatIdRef.current);
    if (youtubeNextPageTokenRef.current) params.set("pageToken", youtubeNextPageTokenRef.current);

    const response = await fetch(`/api/youtube/live-chat?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as YouTubeLiveChatResponse;
    if (!response.ok) throw new Error(data.error || "コメント取得に失敗しました");

    if (data.liveChatId && data.liveChatId !== youtubeLiveChatIdRef.current) {
      setYoutubeLiveChatId(data.liveChatId);
      youtubeLiveChatIdRef.current = data.liveChatId;
      localStorage.setItem("youtube_live_chat_id", data.liveChatId);
      void saveSharedLiveSettings({ youtubeLiveChatId: data.liveChatId });
    }
    youtubeNextPageTokenRef.current = data.nextPageToken || "";
    const incoming = data.messages?.filter((message) => message.message.trim()) ?? [];
    setYoutubeChatStatus(`接続中: ${data.fetchedCount ?? incoming.length}件取得 / ${Math.min(incoming.length, LIVE_CHAT_VISIBLE_COUNT)}件表示`);

    if (incoming.length) {
      youtubeMessageIdsRef.current = new Set(incoming.map((message) => message.id));
      setYoutubeMessages(incoming.slice(-LIVE_CHAT_VISIBLE_COUNT));
    }

    return Math.max(data.pollingIntervalMillis || 5000, 2000);
  }, [youtubeApiKey, youtubeVideoId]);

  useEffect(() => {
    if (!isYoutubeChatEnabled) {
      return;
    }

    let disposed = false;
    let timer = 0;

    const poll = async () => {
      try {
        const interval = await fetchYoutubeLiveChat();
        if (!disposed) timer = window.setTimeout(poll, interval);
      } catch {
        setYoutubeChatStatus("接続待機中");
        if (!disposed) timer = window.setTimeout(poll, 8000);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [fetchYoutubeLiveChat, isYoutubeChatEnabled]);

  const activeAsset = assets[activeEmotion];
  const isPresentationMode = presentationState.enabled;

  const shouldPinSourceComment =
    Boolean(activeSourceComment) && !youtubeMessages.some((message) => isReadingSourceComment(message, activeSourceComment));
  const displayedYoutubeMessages =
    activeSourceComment && shouldPinSourceComment
      ? [...youtubeMessages.slice(-(LIVE_CHAT_VISIBLE_COUNT - 1)), createPinnedSourceMessage(activeSourceComment)]
      : youtubeMessages;

  return (
    <main
      className="relative h-screen w-screen overflow-hidden text-white"
      style={
        bgType === "image" && bgImageUrl
          ? { backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
          : { backgroundColor: bgColor }
      }
    >
      {isPresentationMode && presentationState.slideImageUrl && (
        <div className="absolute inset-0 z-0 grid place-items-center bg-slate-950 p-[3vh]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={presentationState.slideImageUrl} alt={`スライド ${presentationState.slideIndex + 1}`} className="max-h-full max-w-full object-contain" />
          <div className="absolute left-6 top-5 rounded-full bg-slate-950/70 px-4 py-1.5 text-sm font-bold shadow-lg backdrop-blur-sm">
            {presentationState.projectTitle} · {presentationState.slideIndex + 1}/{presentationState.slideCount}
          </div>
        </div>
      )}
      {activeAsset.videoUrl ? (
        <div
          className="absolute z-10 select-none overflow-hidden"
          style={{
            height: isPresentationMode ? "min(38vh, 26vw)" : "min(82vh, 56.25vw)",
            width: isPresentationMode ? "min(46vw, 67.5vh)" : "min(92vw, 145.78vh)",
            left: isPresentationMode ? "17%" : "50%",
            top: isPresentationMode ? "75%" : "50%",
            transform: `translate(-50%, -50%) translate(${characterLayout.x}px, ${characterLayout.y}px) scale(${characterLayout.scale})`,
            transformOrigin: "center center",
            cursor: "grab",
            touchAction: "none",
          }}
          onPointerDown={(event) => startDrag("character", event)}
          onPointerMove={handleDragMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onWheel={(event) => handleLayoutWheel("character", event)}
        >
          <div className="relative h-full w-full">
            <video
              ref={videoRef0}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ opacity: activeVideoIndex === 0 ? 1 : 0 }}
              autoPlay
              loop={false}
              muted
              playsInline
              onEnded={handleVideoEnded}
            />
            <video
              ref={videoRef1}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ opacity: activeVideoIndex === 1 ? 1 : 0 }}
              autoPlay
              loop={false}
              muted
              playsInline
              onEnded={handleVideoEnded}
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
          </div>
        </div>
      ) : !isPresentationMode ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-950 text-sm font-semibold text-white">
          {status}
        </div>
      ) : null}

      {isYoutubeChatEnabled && (
        <div
          className="absolute right-6 top-6 z-20 flex max-h-[58vh] w-[min(360px,calc(100vw-48px))] select-none flex-col justify-end gap-2 overflow-visible"
          style={{
            transform: `translate(${chatLayout.x}px, ${chatLayout.y}px) scale(${chatLayout.scale})`,
            transformOrigin: "top right",
            cursor: "grab",
            touchAction: "none",
          }}
          onPointerDown={(event) => startDrag("chat", event)}
          onPointerMove={handleDragMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onWheel={(event) => handleLayoutWheel("chat", event)}
        >
          <div className="self-end rounded-full border border-white/30 bg-slate-950/55 px-3 py-1 text-[11px] font-semibold shadow-lg backdrop-blur-sm">
            YouTube Chat · {youtubeChatStatus}
          </div>
          {displayedYoutubeMessages.map((message) => {
            const matchesSourceComment = isReadingSourceComment(message, activeSourceComment);
            const hasReadingComment = isSourceCommentHighlightActive && activeSourceComment;
            const isReading = Boolean(hasReadingComment && matchesSourceComment);
            const isReadingSettling = Boolean(activeSourceComment && matchesSourceComment && !isSourceCommentHighlightActive);
            const readingTranslateClass = chatLayout.x < 0 ? "translate-x-16" : "-translate-x-16";

            return (
              <div
                key={message.id}
                className={`relative flex gap-2 rounded-2xl border px-3 py-2 text-sm text-slate-900 shadow-lg backdrop-blur-sm transition-all duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isReading
                    ? `z-30 origin-center ${readingTranslateClass} scale-110 border-teal-200 bg-white shadow-[0_20px_55px_rgba(8,145,178,0.34)] ring-4 ring-teal-300/45 reading-comment-card`
                    : hasReadingComment
                      ? "border-white/15 bg-white/70 opacity-60"
                      : "border-white/20 bg-white/92"
                }`}
              >
                {(isReading || isReadingSettling) && (
                  <div
                    className={`absolute -top-3 right-4 rounded-full border border-teal-200 bg-teal-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow-lg transition-opacity duration-500 ${
                      isReading ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    Reading
                  </div>
                )}
                {message.authorImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={message.authorImageUrl}
                    alt=""
                    className={`mt-0.5 size-7 flex-none rounded-full bg-slate-200 transition-transform duration-500 ${isReading ? "scale-110 ring-2 ring-teal-300" : ""}`}
                  />
                ) : (
                  <div
                    className={`mt-0.5 grid size-7 flex-none place-items-center rounded-full text-xs font-bold text-white transition-transform duration-500 ${
                      isReading ? "scale-110 bg-teal-500 ring-2 ring-teal-300" : "bg-teal-600"
                    }`}
                  >
                    {message.authorName.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={`truncate text-xs font-bold ${isReading ? "text-teal-800" : "text-slate-700"}`}>{message.authorName}</span>
                    {message.isOwner && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">OWNER</span>}
                    {message.isModerator && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">MOD</span>}
                    {message.isSponsor && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">MEMBER</span>}
                  </div>
                  <div className="break-words leading-relaxed">{message.message}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(isPresentationMode ? presentationState.caption : lastReply) && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 w-[min(860px,calc(100vw-48px))] -translate-x-1/2">
          <div className="rounded-md bg-slate-950/55 px-5 py-3 text-center text-lg font-semibold leading-relaxed shadow-lg backdrop-blur-sm">
            {isPresentationMode ? presentationState.caption : lastReply}
          </div>
        </div>
      )}
    </main>
  );
}
