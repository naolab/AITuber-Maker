"use client";

/* eslint-disable react-hooks/immutability -- This legacy client page intentionally coordinates mutable video elements and refs. */

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
  Presentation,
  Radio,
  Send,
  Settings,
  Sparkles,
  Upload,
  Video,
  Wand2,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactElement, useCallback, useEffect, useRef, useState } from "react";

import PresentationConsole from "@/app/presentation/presentation-console";
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

type Emotion = "normal" | "happy" | "angry" | "surprised" | "sad";
type TtsType = "aivis" | "aivis-cloud" | "voicevox" | "custom";
type LiveSpeechSourceComment = {
  id?: string;
  authorName: string;
  message: string;
};

// IndexedDB Helper Functions
const DB_NAME = "AITuberMakerAssets";
const DB_VERSION = 1;
const STORE_NAME = "assets";

function initDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

function getAsset<T>(key: string): Promise<T | null> {
  return initDb().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve((request.result as T) || null);
    });
  });
}

function setAsset<T>(key: string, value: T): Promise<void> {
  return initDb().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  });
}

interface EmotionAsset {
  videoUrl: string;
  track: MouthTrack | null;
  videoName?: string;
  trackName?: string;
  mouthSprites?: GeneratedSprite[];
}

interface PendingSpeech {
  emotion: Emotion;
  text: string;
  audioBuffer: ArrayBuffer;
}

type LiveSettingsPatch = Partial<{
  bgType: "color" | "image";
  bgColor: string;
  youtubeApiKey: string;
  youtubeVideoId: string;
  youtubeLiveChatId: string;
  youtubeChatEnabled: boolean;
  captionsEnabled: boolean;
  youtubeChatWidth: number;
  youtubeChatStatusVisible: boolean;
  youtubeChatVisibleCount: number;
}>;

type PersonaSettings = {
  name: string;
  firstPerson: string;
  personality: string;
  speakingStyle: string;
  responsePolicy: string;
};

const defaultPersona: PersonaSettings = {
  name: "AITuber",
  firstPerson: "私",
  personality: "親しみやすく、誠実で、落ち着いている",
  speakingStyle: "丁寧で自然な日本語。必要以上に大げさにしない。",
  responsePolicy: "不明なことは推測で断定せず、正直に伝える。",
};

const EMOTIONS: { key: Emotion; label: string }[] = [
  { key: "normal", label: "通常" },
  { key: "happy", label: "嬉しい" },
  { key: "angry", label: "怒り" },
  { key: "surprised", label: "驚き" },
  { key: "sad", label: "悲しい" },
];

const LIVE_OUTPUT_CHANNEL = "aituber-maker-live-output";
const MAX_YOUTUBE_MESSAGE_HISTORY = 500;

const personaPrompt = (persona: PersonaSettings) => `\nキャラクター設定:\n- 名前: ${persona.name || defaultPersona.name}\n- 一人称: ${persona.firstPerson || defaultPersona.firstPerson}\n- 性格: ${persona.personality || defaultPersona.personality}\n- 話し方: ${persona.speakingStyle || defaultPersona.speakingStyle}\n- 回答方針: ${persona.responsePolicy || defaultPersona.responsePolicy}\nこの設定を守って返答してください。`;

const createLiveSpeechSourceComment = (message: YouTubeChatMessage): LiveSpeechSourceComment => ({
  id: message.id,
  authorName: message.authorName,
  message: message.message,
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

const saveSpeechForLiveOutput = async ({
  id,
  emotion,
  text,
  audioBuffer,
  contentType,
  sourceComment,
}: {
  id: string;
  emotion: Emotion;
  text: string;
  audioBuffer: ArrayBuffer;
  contentType: string;
  sourceComment?: LiveSpeechSourceComment;
}) => {
  const response = await fetch("/api/live-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      emotion,
      text,
      audioBase64: arrayBufferToBase64(audioBuffer),
      contentType,
      sourceComment,
    }),
  });
  if (!response.ok) {
    throw new Error("OBS専用画面への発話送信に失敗しました");
  }
};

const saveLiveSettingsForObs = async (patch: LiveSettingsPatch) => {
  const response = await fetch("/api/live-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error("OBS用設定の保存に失敗しました");
  }
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("materials");
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoMeta, setVideoMeta] = useState({ width: 0, height: 0, duration: 0 });
  const [analysisFps, setAnalysisFps] = useState(24);
  const [smoothCutoff, setSmoothCutoff] = useState(3.0);
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
  const [persona, setPersona] = useState<PersonaSettings>(defaultPersona);
  const [availableModels, setAvailableModels] = useState<string[]>([
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
  ]);
  const [ttsType, setTtsType] = useState<TtsType>("aivis");
  const [aivisUrl, setAivisUrl] = useState("http://127.0.0.1:10101");
  const [selectedSpeaker, setSelectedSpeaker] = useState("2");
  const [speakers, setSpeakers] = useState<AivisSpeaker[]>([]);
  const [aivisCloudApiKey, setAivisCloudApiKey] = useState("");
  const [aivisCloudModelUuid, setAivisCloudModelUuid] = useState("");
  const [aivisCloudStyleId, setAivisCloudStyleId] = useState("0");
  const [aivisCloudStyleName, setAivisCloudStyleName] = useState("");
  const [aivisCloudUserDictionaryUuid, setAivisCloudUserDictionaryUuid] = useState("");
  const [aivisCloudOutputFormat, setAivisCloudOutputFormat] = useState("mp3");
  const [localSpeakingRate, setLocalSpeakingRate] = useState("1.0");
  const [aivisCloudSpeakingRate, setAivisCloudSpeakingRate] = useState("1.0");
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [lastReply, setLastReply] = useState("");
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [isLocalSpeechPlaybackEnabled, setIsLocalSpeechPlaybackEnabled] = useState(true);
  const [isLocalCharacterPreviewEnabled, setIsLocalCharacterPreviewEnabled] = useState(true);
  const [activeVideoIndex, setActiveVideoIndex] = useState<0 | 1>(0);
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState("");
  const [youtubeLiveChatId, setYoutubeLiveChatId] = useState("");
  const [isYoutubeChatEnabled, setIsYoutubeChatEnabled] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [youtubeChatWidth, setYoutubeChatWidth] = useState(360);
  const [youtubeChatStatusVisible, setYoutubeChatStatusVisible] = useState(true);
  const [youtubeChatVisibleCount, setYoutubeChatVisibleCount] = useState(10);
  const [youtubeChatStatus, setYoutubeChatStatus] = useState("未接続");
  const [youtubeMessages, setYoutubeMessages] = useState<YouTubeChatMessage[]>([]);
  const [selectedYoutubeMessageId, setSelectedYoutubeMessageId] = useState("");
  const youtubeNextPageTokenRef = useRef("");
  const youtubeMessageIdsRef = useRef<Set<string>>(new Set());
  const selectedYoutubeMessage = youtubeMessages.find((message) => message.id === selectedYoutubeMessageId) ?? null;
  const activeReplySourceCommentRef = useRef<LiveSpeechSourceComment | undefined>(undefined);

  const [emotionAssets, setEmotionAssets] = useState<Record<Emotion, EmotionAsset>>({
    normal: { videoUrl: "", track: null, mouthSprites: [] },
    happy: { videoUrl: "", track: null, mouthSprites: [] },
    angry: { videoUrl: "", track: null, mouthSprites: [] },
    surprised: { videoUrl: "", track: null, mouthSprites: [] },
    sad: { videoUrl: "", track: null, mouthSprites: [] },
  });
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>("normal");
  const [pendingSpeech, setPendingSpeech] = useState<PendingSpeech | null>(null);
  const pendingSpeechRef = useRef<PendingSpeech | null>(null);

  useEffect(() => {
    pendingSpeechRef.current = pendingSpeech;
  }, [pendingSpeech]);

  const [runtimeBgType, setRuntimeBgType] = useState<"color" | "image">("color");
  const [runtimeBgColor, setRuntimeBgColor] = useState("#ffffff");
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

  const mouthSpriteUrlsRef = useRef<string[]>([]);
  const emotionVideoUrlsRef = useRef<Record<Emotion, string>>({
    normal: "",
    happy: "",
    angry: "",
    surprised: "",
    sad: "",
  });
  const emotionMouthSpriteUrlsRef = useRef<string[]>([]);

  const setManagedMouthSprites = (nextSprites: GeneratedSprite[]) => {
    const nextUrls = new Set(nextSprites.map((sprite) => sprite.url));
    const urlsToRevoke = mouthSpriteUrlsRef.current.filter((url) => !nextUrls.has(url));
    urlsToRevoke.forEach(revokeObjectUrl);
    mouthSpriteUrlsRef.current = nextSprites.map((sprite) => sprite.url);
    setMouthSprites(nextSprites);
  };
  const [liveAssetSyncStatus, setLiveAssetSyncStatus] = useState("未同期");

  const syncEmotionAssetForObs = async (
    emotion: Emotion,
    type: "video" | "track" | "mouthSprite",
    fileOrData: File | MouthTrack,
    spriteName?: MouthSpriteName,
    trackName?: string,
  ) => {
    const formData = new FormData();
    formData.set("emotion", emotion);
    formData.set("type", type);
    if (spriteName) formData.set("spriteName", spriteName);

    if (type === "track") {
      const file = new File([JSON.stringify(fileOrData as MouthTrack)], trackName || "mouth_track.json", {
        type: "application/json",
      });
      formData.set("file", file);
    } else {
      formData.set("file", fileOrData as File);
    }

    const response = await fetch("/api/live-assets", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "OBS用素材の同期に失敗しました");
    }
  };

  // Helper to save emotion asset files to IndexedDB
  const saveEmotionAssetToDb = async (emotion: Emotion, type: "video" | "track" | "mouthSprite", fileOrData: File | MouthTrack, spriteName?: MouthSpriteName, trackName?: string) => {
    try {
      const dbKey = `emotion_${emotion}_${type}${spriteName ? `_${spriteName}` : ""}`;
      if (type === "video" || type === "mouthSprite") {
        const file = fileOrData as File;
        await setAsset(dbKey, { file, name: file.name });
      } else if (type === "track") {
        const trackData = fileOrData as MouthTrack;
        await setAsset(dbKey, { track: trackData, name: trackName || "mouth_track.json" });
      }
      await syncEmotionAssetForObs(emotion, type, fileOrData, spriteName, trackName);
      setLiveAssetSyncStatus("OBS用素材を同期済み");
    } catch (err) {
      console.error(`Failed to save asset ${type} for ${emotion}:`, err);
      setLiveAssetSyncStatus(err instanceof Error ? err.message : "OBS用素材の同期に失敗");
    }
  };

  const syncAllLiveAssetsForObs = async () => {
    setLiveAssetSyncStatus("OBS用素材を同期中...");
    try {
      for (const emotion of EMOTIONS.map((item) => item.key)) {
        const videoData = await getAsset<{ file: File; name: string }>(`emotion_${emotion}_video`);
        if (videoData?.file) {
          await syncEmotionAssetForObs(emotion, "video", videoData.file);
        }

        const trackData = await getAsset<{ track: MouthTrack; name: string }>(`emotion_${emotion}_track`);
        if (trackData?.track) {
          await syncEmotionAssetForObs(emotion, "track", trackData.track, undefined, trackData.name);
        }

        for (const name of mouthSpriteNames) {
          const spriteData = await getAsset<{ file: File; name: string }>(`emotion_${emotion}_mouthSprite_${name}`);
          if (spriteData?.file) {
            await syncEmotionAssetForObs(emotion, "mouthSprite", spriteData.file, name);
          }
        }
      }
      await saveLiveSettingsForObs({
        bgType: runtimeBgType,
        bgColor: runtimeBgColor,
        youtubeApiKey,
        youtubeVideoId,
        youtubeLiveChatId,
        youtubeChatEnabled: isYoutubeChatEnabled,
      });
      setLiveAssetSyncStatus("OBS用素材を同期済み");
    } catch (error) {
      console.error(error);
      setLiveAssetSyncStatus(error instanceof Error ? error.message : "OBS用素材の同期に失敗");
    }
  };

  useEffect(() => {
    window.requestAnimationFrame(async () => {
      const key = localStorage.getItem("openai_api_key") || "";
      const model = localStorage.getItem("openai_model") || "gpt-4o-mini";
      const savedPersona = JSON.parse(localStorage.getItem("character_persona") || "null") as Partial<PersonaSettings> | null;
      const tts = (localStorage.getItem("tts_type") as TtsType) || "aivis";
      const url = localStorage.getItem("aivis_url") || "http://127.0.0.1:10101";
      const speaker = localStorage.getItem("aivis_speaker") || "2";
      const cloudApiKey = localStorage.getItem("aivis_cloud_api_key") || "";
      const cloudModelUuid = localStorage.getItem("aivis_cloud_model_uuid") || "";
      const cloudStyleId = localStorage.getItem("aivis_cloud_style_id") || "0";
      const cloudStyleName = localStorage.getItem("aivis_cloud_style_name") || "";
      const cloudUserDictionaryUuid = localStorage.getItem("aivis_cloud_user_dictionary_uuid") || "";
      const cloudOutputFormat = localStorage.getItem("aivis_cloud_output_format") || "mp3";
      const cloudSpeakingRate = localStorage.getItem("aivis_cloud_speaking_rate") || "1.0";
      const savedLocalSpeakingRate = localStorage.getItem("local_speaking_rate") || "1.0";
      const bgType = (localStorage.getItem("runtime_bg_type") as "color" | "image") || "color";
      const bgColor = localStorage.getItem("runtime_bg_color") || "#ffffff";
      const savedYoutubeApiKey = localStorage.getItem("youtube_api_key") || "";
      const savedYoutubeVideoId = localStorage.getItem("youtube_video_id") || "";
      const savedYoutubeLiveChatId = localStorage.getItem("youtube_live_chat_id") || "";
      const savedYoutubeChatEnabled = localStorage.getItem("youtube_chat_enabled") === "true";
      const savedLocalSpeechPlayback = localStorage.getItem("local_speech_playback_enabled");
      const savedLocalCharacterPreview = localStorage.getItem("local_character_preview_enabled");
      const liveSettings = await fetch("/api/live-settings", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null) as LiveSettingsPatch | null;

      const nextBgType = liveSettings?.bgType || bgType;
      const nextBgColor = liveSettings?.bgColor || bgColor;
      const nextYoutubeApiKey = liveSettings?.youtubeApiKey || savedYoutubeApiKey;
      const nextYoutubeVideoId = liveSettings?.youtubeVideoId || savedYoutubeVideoId;
      const nextYoutubeLiveChatId = liveSettings?.youtubeLiveChatId || savedYoutubeLiveChatId;
      const nextYoutubeChatEnabled = liveSettings?.youtubeChatEnabled ?? savedYoutubeChatEnabled;
      const nextCaptionsEnabled = liveSettings?.captionsEnabled ?? localStorage.getItem("captions_enabled") !== "false";
      const nextYoutubeChatWidth = liveSettings?.youtubeChatWidth ?? Number(localStorage.getItem("youtube_chat_width") || 360);
      const nextYoutubeChatStatusVisible = liveSettings?.youtubeChatStatusVisible ?? localStorage.getItem("youtube_chat_status_visible") !== "false";
      const nextYoutubeChatVisibleCount = liveSettings?.youtubeChatVisibleCount ?? Number(localStorage.getItem("youtube_chat_visible_count") || 10);

      setOpenaiApiKey(key);
      setOpenaiModel(model);
      setPersona({ ...defaultPersona, ...savedPersona });
      setTtsType(tts);
      setAivisUrl(url);
      setSelectedSpeaker(speaker);
      setAivisCloudApiKey(cloudApiKey);
      setAivisCloudModelUuid(cloudModelUuid);
      setAivisCloudStyleId(cloudStyleId);
      setAivisCloudStyleName(cloudStyleName);
      setAivisCloudUserDictionaryUuid(cloudUserDictionaryUuid);
      setAivisCloudOutputFormat(cloudOutputFormat);
      setLocalSpeakingRate(savedLocalSpeakingRate);
      setAivisCloudSpeakingRate(cloudSpeakingRate);
      setRuntimeBgType(nextBgType === "image" ? "color" : nextBgType);
      setRuntimeBgColor(nextBgColor);
      setYoutubeApiKey(nextYoutubeApiKey);
      setYoutubeVideoId(nextYoutubeVideoId);
      setYoutubeLiveChatId(nextYoutubeLiveChatId);
      setIsYoutubeChatEnabled(Boolean(nextYoutubeChatEnabled));
      setCaptionsEnabled(nextCaptionsEnabled);
      setYoutubeChatWidth(nextYoutubeChatWidth);
      setYoutubeChatStatusVisible(nextYoutubeChatStatusVisible);
      setYoutubeChatVisibleCount(nextYoutubeChatVisibleCount);
      setIsLocalSpeechPlaybackEnabled(savedLocalSpeechPlayback !== "false");
      setIsLocalCharacterPreviewEnabled(savedLocalCharacterPreview !== "false");

      if (url) {
        void fetchSpeakers(url);
      }
      if (key) {
        void fetchOpenaiModels(key);
      }

      // Load saved assets from IndexedDB
      try {
        const loadedAssets: Record<Emotion, EmotionAsset> = {
          normal: { videoUrl: "", track: null, mouthSprites: [] },
          happy: { videoUrl: "", track: null, mouthSprites: [] },
          angry: { videoUrl: "", track: null, mouthSprites: [] },
          surprised: { videoUrl: "", track: null, mouthSprites: [] },
          sad: { videoUrl: "", track: null, mouthSprites: [] },
        };

        let normalTrack: MouthTrack | null = null;
        const normalMouthSprites: GeneratedSprite[] = [];

        for (const emotion of EMOTIONS.map(e => e.key)) {
          // 1. Video
          const videoData = await getAsset<{ file: File; name: string }>(`emotion_${emotion}_video`);
          if (videoData) {
            const url = URL.createObjectURL(videoData.file);
            loadedAssets[emotion].videoUrl = url;
            loadedAssets[emotion].videoName = videoData.name;
            emotionVideoUrlsRef.current[emotion] = url;
            if (emotion === "normal") {
              setMouthlessUrl(url);
            }
          }

          // 2. Track JSON
          const trackData = await getAsset<{ track: MouthTrack; name: string }>(`emotion_${emotion}_track`);
          if (trackData) {
            loadedAssets[emotion].track = trackData.track;
            loadedAssets[emotion].trackName = trackData.name;
            if (emotion === "normal") {
              normalTrack = trackData.track;
            }
          }

          // 3. Mouth Sprites
          const sprites: GeneratedSprite[] = [];
          for (const name of mouthSpriteNames) {
            const spriteData = await getAsset<{ file: File; name: string }>(`emotion_${emotion}_mouthSprite_${name}`);
            if (spriteData) {
              const url = URL.createObjectURL(spriteData.file);
              emotionMouthSpriteUrlsRef.current.push(url);
              const sprite: GeneratedSprite = {
                name,
                url,
                frameIndex: 0,
                width: 0,
                height: 0,
              };
              sprites.push(sprite);
              if (emotion === "normal") {
                normalMouthSprites.push(sprite);
              }
            }
          }
          loadedAssets[emotion].mouthSprites = sprites;
        }

        setEmotionAssets(loadedAssets);
        if (normalTrack) {
          setTrack(normalTrack);
        }
        if (normalMouthSprites.length > 0) {
          setManagedMouthSprites(normalMouthSprites);
        }
      } catch (err) {
        console.error("Failed to restore saved assets from IndexedDB:", err);
      }
    });
  }, []);

  useEffect(() => {
    if (mode !== "runtime" || !isLocalCharacterPreviewEnabled) {
      pauseRuntimeVideos();
      return;
    }

    if (emotionAssets.normal?.videoUrl && runtimeVideoRef0.current) {
      const primaryVideo = runtimeVideoRef0.current;
      // モード移動でvideo要素はアンマウントされるが、素材用のrefは残る。
      // 新しくマウントされたvideo要素にはsrcが無いため、要素側も判定に含めて再初期化する。
      const needsRestore = primaryVideo.src !== emotionAssets.normal.videoUrl;
      if (needsRestore || !videoAsset0Ref.current || videoAsset0Ref.current.videoUrl !== emotionAssets.normal.videoUrl) {
        activeVideoIndexRef.current = 0;
        setActiveVideoIndex(0);
        setCurrentEmotion("normal");
        setMouthlessUrl(emotionAssets.normal.videoUrl);
        setTrack(emotionAssets.normal.track);
        videoAsset0Ref.current = {
          videoUrl: emotionAssets.normal.videoUrl,
          track: emotionAssets.normal.track,
          emotion: "normal",
        };
        videoAsset1Ref.current = null;
        primaryVideo.src = emotionAssets.normal.videoUrl;
        primaryVideo.load();
        void primaryVideo.play();
      }
    }
  }, [mode, emotionAssets, isLocalCharacterPreviewEnabled]);

  const handleOpenaiKeyChange = (key: string) => {
    setOpenaiApiKey(key);
    localStorage.setItem("openai_api_key", key);
    void fetchOpenaiModels(key);
  };

  const handleOpenaiModelChange = (model: string) => {
    setOpenaiModel(model);
    localStorage.setItem("openai_model", model);
  };

  const handlePersonaChange = (patch: Partial<PersonaSettings>) => {
    setPersona((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem("character_persona", JSON.stringify(next));
      return next;
    });
  };

  const handleTtsTypeChange = (type: TtsType) => {
    setTtsType(type);
    localStorage.setItem("tts_type", type);
    
    let targetUrl = aivisUrl;
    if (type === "aivis") {
      targetUrl = "http://127.0.0.1:10101";
    } else if (type === "voicevox") {
      targetUrl = "http://127.0.0.1:50021";
    }
    
    if (type === "aivis" || type === "voicevox") {
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

  const handleAivisCloudApiKeyChange = (key: string) => {
    setAivisCloudApiKey(key);
    localStorage.setItem("aivis_cloud_api_key", key);
  };

  const handleAivisCloudModelUuidChange = (modelUuid: string) => {
    setAivisCloudModelUuid(modelUuid);
    localStorage.setItem("aivis_cloud_model_uuid", modelUuid);
  };

  const handleAivisCloudStyleIdChange = (styleId: string) => {
    setAivisCloudStyleId(styleId);
    localStorage.setItem("aivis_cloud_style_id", styleId);
  };

  const handleAivisCloudStyleNameChange = (styleName: string) => {
    setAivisCloudStyleName(styleName);
    localStorage.setItem("aivis_cloud_style_name", styleName);
  };

  const handleAivisCloudUserDictionaryUuidChange = (userDictionaryUuid: string) => {
    setAivisCloudUserDictionaryUuid(userDictionaryUuid);
    localStorage.setItem("aivis_cloud_user_dictionary_uuid", userDictionaryUuid);
  };

  const handleAivisCloudOutputFormatChange = (outputFormat: string) => {
    setAivisCloudOutputFormat(outputFormat);
    localStorage.setItem("aivis_cloud_output_format", outputFormat);
  };

  const handleAivisCloudSpeakingRateChange = (speakingRate: string) => {
    setAivisCloudSpeakingRate(speakingRate);
    localStorage.setItem("aivis_cloud_speaking_rate", speakingRate);
  };

  const handleLocalSpeakingRateChange = (speakingRate: string) => {
    setLocalSpeakingRate(speakingRate);
    localStorage.setItem("local_speaking_rate", speakingRate);
  };

  const handleYoutubeApiKeyChange = (key: string) => {
    setYoutubeApiKey(key);
    localStorage.setItem("youtube_api_key", key);
    void saveLiveSettingsForObs({ youtubeApiKey: key });
  };

  const handleCaptionsEnabledChange = (enabled: boolean) => {
    setCaptionsEnabled(enabled);
    localStorage.setItem("captions_enabled", String(enabled));
    void saveLiveSettingsForObs({ captionsEnabled: enabled });
  };

  const handleYoutubeChatWidthChange = (width: number) => {
    const next = Math.min(640, Math.max(240, width || 360));
    setYoutubeChatWidth(next);
    localStorage.setItem("youtube_chat_width", String(next));
    void saveLiveSettingsForObs({ youtubeChatWidth: next });
  };

  const handleYoutubeChatStatusVisibleChange = (visible: boolean) => {
    setYoutubeChatStatusVisible(visible);
    localStorage.setItem("youtube_chat_status_visible", String(visible));
    void saveLiveSettingsForObs({ youtubeChatStatusVisible: visible });
  };

  const handleYoutubeChatVisibleCountChange = (count: number) => {
    const next = Math.min(30, Math.max(1, count || 10));
    setYoutubeChatVisibleCount(next);
    localStorage.setItem("youtube_chat_visible_count", String(next));
    void saveLiveSettingsForObs({ youtubeChatVisibleCount: next });
  };

  const handleYoutubeVideoIdChange = (videoId: string) => {
    setYoutubeVideoId(videoId);
    localStorage.setItem("youtube_video_id", videoId);
    void saveLiveSettingsForObs({ youtubeVideoId: videoId });
    youtubeNextPageTokenRef.current = "";
    youtubeMessageIdsRef.current = new Set();
    setYoutubeMessages([]);
  };

  const handleYoutubeLiveChatIdChange = (liveChatId: string) => {
    setYoutubeLiveChatId(liveChatId);
    localStorage.setItem("youtube_live_chat_id", liveChatId);
    void saveLiveSettingsForObs({ youtubeLiveChatId: liveChatId });
    youtubeNextPageTokenRef.current = "";
    youtubeMessageIdsRef.current = new Set();
    setYoutubeMessages([]);
  };

  const handleYoutubeChatEnabledChange = (enabled: boolean) => {
    setIsYoutubeChatEnabled(enabled);
    localStorage.setItem("youtube_chat_enabled", String(enabled));
    void saveLiveSettingsForObs({ youtubeChatEnabled: enabled });
    if (!enabled) {
      setYoutubeChatStatus("停止中");
      youtubeNextPageTokenRef.current = "";
    }
  };

  const handleLocalSpeechPlaybackChange = (enabled: boolean) => {
    setIsLocalSpeechPlaybackEnabled(enabled);
    localStorage.setItem("local_speech_playback_enabled", String(enabled));
    if (!enabled) {
      setPendingSpeech(null);
      setActiveMouthShape("closed");
    }
  };

  const pauseRuntimeVideos = () => {
    runtimeVideoRef0.current?.pause();
    runtimeVideoRef1.current?.pause();
  };

  const handleLocalCharacterPreviewChange = (enabled: boolean) => {
    setIsLocalCharacterPreviewEnabled(enabled);
    localStorage.setItem("local_character_preview_enabled", String(enabled));
    if (!enabled) {
      pauseRuntimeVideos();
      setPendingSpeech(null);
      setActiveMouthShape("closed");
    }
  };

  const fetchYoutubeLiveChat = useCallback(async () => {
    if (!youtubeApiKey || (!youtubeVideoId && !youtubeLiveChatId)) {
      setYoutubeChatStatus("YouTube APIキーと動画IDまたはliveChatIdが必要");
      return 5000;
    }

    const params = new URLSearchParams({
      apiKey: youtubeApiKey,
    });
    if (youtubeVideoId) params.set("videoId", youtubeVideoId);
    if (youtubeLiveChatId) params.set("liveChatId", youtubeLiveChatId);
    if (youtubeNextPageTokenRef.current) params.set("pageToken", youtubeNextPageTokenRef.current);

    const response = await fetch(`/api/youtube/live-chat?${params.toString()}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as YouTubeLiveChatResponse;
    if (!response.ok) {
      throw new Error(data.error || "YouTubeライブチャットの取得に失敗しました");
    }

    if (data.liveChatId && data.liveChatId !== youtubeLiveChatId) {
      setYoutubeLiveChatId(data.liveChatId);
      localStorage.setItem("youtube_live_chat_id", data.liveChatId);
      void saveLiveSettingsForObs({ youtubeLiveChatId: data.liveChatId });
    }
    youtubeNextPageTokenRef.current = data.nextPageToken || "";

    const incoming = (data.messages ?? []).filter((message) => message.message.trim());
    if (incoming.length) {
      const newMessages = incoming.filter((message) => !youtubeMessageIdsRef.current.has(message.id));
      incoming.forEach((message) => youtubeMessageIdsRef.current.add(message.id));
      if (newMessages.length) {
        setYoutubeMessages((current) => [...current, ...newMessages].slice(-MAX_YOUTUBE_MESSAGE_HISTORY));
      }
    }

    setYoutubeChatStatus(`接続中: ${data.fetchedCount ?? incoming.length}件取得 / 最大${MAX_YOUTUBE_MESSAGE_HISTORY}件を保持`);
    return Math.max(1000, data.pollingIntervalMillis || 5000);
  }, [youtubeApiKey, youtubeVideoId, youtubeLiveChatId]);

  useEffect(() => {
    if (mode !== "runtime" || !isYoutubeChatEnabled) return;

    let stopped = false;
    let timeoutId = 0;

    const tick = async () => {
      if (stopped) return;
      try {
        const nextInterval = await fetchYoutubeLiveChat();
        if (!stopped) {
          timeoutId = window.setTimeout(tick, nextInterval);
        }
      } catch (error) {
        setYoutubeChatStatus(error instanceof Error ? error.message : "YouTubeコメント取得に失敗");
        if (!stopped) {
          timeoutId = window.setTimeout(tick, 8000);
        }
      }
    };

    void tick();

    return () => {
      stopped = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [mode, isYoutubeChatEnabled, fetchYoutubeLiveChat]);

  const sendMessageToCharacter = async ({
    llmMessage,
    displayMessage,
    sourceComment,
    onSuccess,
  }: {
    llmMessage: string;
    displayMessage?: string;
    sourceComment?: LiveSpeechSourceComment;
    onSuccess?: () => void;
  }) => {
    const trimmedMessage = llmMessage.trim();
    if (!trimmedMessage || !openaiApiKey || isChatSending) return;
    const speechSourceComment = sourceComment ?? activeReplySourceCommentRef.current;
    setLastUserMessage((displayMessage || trimmedMessage).trim());
    setIsChatSending(true);

    try {
      let presentationContext = "";
      if (speechSourceComment) {
        const liveStateResponse = await fetch("/api/presentation-live", { cache: "no-store" });
        const liveState = await liveStateResponse.json().catch(() => ({})) as { state?: { projectId?: string } };
        if (liveState.state?.projectId) {
          const contextResponse = await fetch(`/api/presentation-context?id=${encodeURIComponent(liveState.state.projectId)}`, { cache: "no-store" });
          const contextData = await contextResponse.json().catch(() => ({})) as { context?: string };
          presentationContext = contextData.context || "";
        }
      }
      // 1. OpenAI Chat Completion
      const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `あなたはAITuberのキャラクターとして振る舞ってください。ユーザーとの対話において、キャラクターとしての返答本文と、その返答の感情（通常、嬉しい、怒り、驚き、悲しい）を、必ず以下のJSONフォーマットで返却してください。

JSONフォーマット例:
{
  "emotion": "嬉しい",
  "text": "こんにちは！お話しできてとても嬉しいです！"
}

感情の選択肢（値は以下のいずれか1つのみにしてください）:
- "通常"
- "嬉しい"
- "怒り"
- "驚き"
- "悲しい"
${personaPrompt(persona)}

${presentationContext ? `以下は現在のゼミ発表の根拠資料です。コメントへの回答はこの資料に基づき、根拠がなければ推測で断定せず「現時点では確認できていません」と答えてください。\n\n${presentationContext}` : ""}`,
            },
            { role: "user", content: trimmedMessage },
          ],
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
      const replyJson = chatData.choices[0].message.content;
      
      let emotion: Emotion = "normal";
      let cleanText = "";
      try {
        const parsed = JSON.parse(replyJson);
        cleanText = parsed.text || "";
        const emotionStr = parsed.emotion;
        if (emotionStr === "嬉しい") emotion = "happy";
        else if (emotionStr === "怒り") emotion = "angry";
        else if (emotionStr === "驚き") emotion = "surprised";
        else if (emotionStr === "悲しい") emotion = "sad";
        else emotion = "normal";
      } catch (err) {
        console.error("Failed to parse OpenAI JSON response:", err);
        cleanText = replyJson;
      }
      cleanText = cleanText.trim();
      if (!cleanText) {
        throw new Error("LLMの返答本文が空でした");
      }

      // 2. Aivis Speech synthesis
      const synthRes = await fetch("/api/aivis/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanText,
          ttsType,
          speaker: Number(selectedSpeaker),
          aivisUrl,
          aivisCloudApiKey,
          aivisCloudModelUuid,
          aivisCloudStyleId,
          aivisCloudStyleName,
          aivisCloudUserDictionaryUuid,
          aivisCloudOutputFormat,
          aivisCloudSpeakingRate,
          localSpeakingRate,
        }),
      });

      if (!synthRes.ok) {
        let errMsg = synthRes.statusText;
        try {
          const errData = await synthRes.json();
          if (errData.error) errMsg = errData.error;
        } catch {
          const errText = await synthRes.text().catch(() => "");
          if (errText) errMsg = errText;
        }
        throw new Error(`音声合成に失敗しました: ${errMsg}`);
      }

      const audioContentType = synthRes.headers.get("content-type") || "audio/wav";
      const audioBuffer = await synthRes.arrayBuffer();
      const liveAudioBuffer = audioBuffer.slice(0);
      const speechId = crypto.randomUUID();

      if (isLocalSpeechPlaybackEnabled && isLocalCharacterPreviewEnabled) {
        // 動画のループ終了時に切り替えるため、保留中（キュー）に設定
        setPendingSpeech({
          emotion,
          text: cleanText,
          audioBuffer,
        });
      } else {
        setLastReply(cleanText);
        setCurrentEmotion(emotion);
        setActiveMouthShape("closed");
      }

      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const channel = new BroadcastChannel(LIVE_OUTPUT_CHANNEL);
        channel.postMessage({
          type: "speech",
          id: speechId,
          sourceComment: speechSourceComment,
          emotion,
          text: cleanText,
          audioBuffer: liveAudioBuffer,
        });
        channel.close();
      }
      await saveSpeechForLiveOutput({
        id: speechId,
        emotion,
        text: cleanText,
        audioBuffer: liveAudioBuffer.slice(0),
        contentType: audioContentType,
        sourceComment: speechSourceComment,
      });

      onSuccess?.();
    } catch (err) {
      console.error("Chat & LipSync error:", err);
      alert(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      activeReplySourceCommentRef.current = undefined;
      setIsChatSending(false);
    }
  };

  const sendChatMessage = async () => {
    const sourceComment = selectedYoutubeMessage ? createLiveSpeechSourceComment(selectedYoutubeMessage) : undefined;

    await sendMessageToCharacter({
      llmMessage: chatInput,
      sourceComment,
      onSuccess: () => setChatInput(""),
    });
  };

  const replyToYoutubeMessage = async (message: YouTubeChatMessage) => {
    const sourceComment = createLiveSpeechSourceComment(message);
    activeReplySourceCommentRef.current = sourceComment;
    await sendMessageToCharacter({
      llmMessage: `YouTubeライブのコメントに、AITuberとして自然に返答してください。

投稿者: ${message.authorName}
コメント: ${message.message}`,
      displayMessage: `${message.authorName}: ${message.message}`,
      sourceComment,
    });
  };

  const isSpeakingRef = useRef<boolean>(false);

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
      isSpeakingRef.current = false;
    };

    isSpeakingRef.current = true;
    source.start(0);
    syncMouth();
  };

  interface ActiveVideoAsset {
    videoUrl: string;
    track: MouthTrack | null;
    emotion: Emotion;
  }

  const videoAsset0Ref = useRef<ActiveVideoAsset | null>(null);
  const videoAsset1Ref = useRef<ActiveVideoAsset | null>(null);

  const activeVideoIndexRef = useRef<0 | 1>(0);
  const runtimeVideoRef0 = useRef<HTMLVideoElement | null>(null);
  const runtimeVideoRef1 = useRef<HTMLVideoElement | null>(null);

  const getActiveVideo = () => {
    return activeVideoIndex === 0 ? runtimeVideoRef0.current : runtimeVideoRef1.current;
  };

  const getInactiveVideo = () => {
    return activeVideoIndex === 0 ? runtimeVideoRef1.current : runtimeVideoRef0.current;
  };

  const switchActiveVideo = () => {
    const activeIndex = activeVideoIndexRef.current;
    const nextIndex = activeIndex === 0 ? 1 : 0;
    
    const prevVideo = activeIndex === 0 ? runtimeVideoRef0.current : runtimeVideoRef1.current;
    if (prevVideo) {
      // Stop previous video to save performance
      prevVideo.pause();
    }
    
    activeVideoIndexRef.current = nextIndex;
    setActiveVideoIndex(nextIndex);
  };

  const handleVideoEnded = async () => {
    const activeIdx = activeVideoIndexRef.current;
    const currentVideo = activeIdx === 0 ? runtimeVideoRef0.current : runtimeVideoRef1.current;
    const nextVideo = activeIdx === 0 ? runtimeVideoRef1.current : runtimeVideoRef0.current;
    const nextAssetRef = activeIdx === 0 ? videoAsset1Ref : videoAsset0Ref;
    const currentAssetRef = activeIdx === 0 ? videoAsset0Ref : videoAsset1Ref;

    if (!currentVideo || !nextVideo) return;

    const pending = pendingSpeechRef.current;
    if (pending) {
      const nextEmotion = pending.emotion;
      let asset = emotionAssets[nextEmotion];
      if (!asset || !asset.videoUrl) {
        asset = emotionAssets["normal"];
      }

      if (asset && asset.videoUrl) {
        nextAssetRef.current = {
          videoUrl: asset.videoUrl,
          track: asset.track,
          emotion: nextEmotion,
        };

        setCurrentEmotion(nextEmotion);
        setMouthlessUrl(asset.videoUrl);
        setTrack(asset.track);

        nextVideo.src = asset.videoUrl;
        nextVideo.load();
        await waitForEvent(nextVideo, "canplay");
      }

      setLastReply(pending.text);
      await playAudioAndSyncMouth(pending.audioBuffer);
      setPendingSpeech(null);
      
      void nextVideo.play();
      switchActiveVideo();
    } else {
      const currentAsset = currentAssetRef.current;
      if (!isSpeakingRef.current && currentAsset && currentAsset.emotion !== "normal") {
        const normalAsset = emotionAssets["normal"];
        if (normalAsset && normalAsset.videoUrl) {
          nextAssetRef.current = {
            videoUrl: normalAsset.videoUrl,
            track: normalAsset.track,
            emotion: "normal",
          };

          setCurrentEmotion("normal");
          setMouthlessUrl(normalAsset.videoUrl);
          setTrack(normalAsset.track);

          nextVideo.src = normalAsset.videoUrl;
          nextVideo.load();
          await waitForEvent(nextVideo, "canplay");
          
          void nextVideo.play();
          switchActiveVideo();
        }
      } else {
        currentVideo.currentTime = 0;
        void currentVideo.play();
      }
    }
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

  const runtimeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeMouthShape, setActiveMouthShape] = useState<string>("closed");
  const runtimeLoopRef = useRef<number>(0);
  const runtimeImageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const updateRuntimeCanvas = () => {
    const activeIdx = activeVideoIndexRef.current;
    const video = activeIdx === 0 ? runtimeVideoRef0.current : runtimeVideoRef1.current;
    const canvas = runtimeCanvasRef.current;
    const activeAsset = activeIdx === 0 ? videoAsset0Ref.current : videoAsset1Ref.current;

    if (!video || !canvas || video.videoWidth === 0 || !activeAsset || !activeAsset.track?.frames.length) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const trackObj = activeAsset.track;
    const frameIndex = Math.min(
      trackObj.frames.length - 1,
      Math.max(0, Math.floor(video.currentTime * trackObj.fps))
    );
    const frame = trackObj.frames[frameIndex];

    if (frame?.valid && frame.quad) {
      const spriteName = activeMouthShape.toLowerCase();
      const currentSprites = emotionAssets[activeAsset.emotion]?.mouthSprites;
      const normalSprites = emotionAssets["normal"]?.mouthSprites;
      const activeSprites = (currentSprites && currentSprites.length > 0)
        ? currentSprites
        : (normalSprites && normalSprites.length > 0)
          ? normalSprites
          : mouthSprites;

      const sprite = activeSprites.find((s) => s.name.toLowerCase() === spriteName) ||
                     activeSprites.find((s) => s.name.toLowerCase() === "closed");

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
    if (mode !== "runtime" || !isLocalCharacterPreviewEnabled) {
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
  }, [mode, activeMouthShape, mouthSprites, emotionAssets, isLocalCharacterPreviewEnabled]);

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

  const handleEmotionVideoUpload = (emotion: Emotion, event: ChangeEvent<HTMLInputElement>) => {
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
      
      // Revoke old URL if exists
      const oldUrl = emotionVideoUrlsRef.current[emotion];
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      emotionVideoUrlsRef.current[emotion] = url;

      setEmotionAssets((prev) => ({
        ...prev,
        [emotion]: {
          ...prev[emotion],
          videoUrl: url,
          videoName: file.name,
        },
      }));

      // If configuring normal, sync with mouthlessUrl
      if (emotion === "normal") {
        setMouthlessUrl(url);
      }
      void saveEmotionAssetToDb(emotion, "video", file);
    }
  };

  const handleEmotionTrackUpload = async (emotion: Emotion, event: ChangeEvent<HTMLInputElement>) => {
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

      setEmotionAssets((prev) => ({
        ...prev,
        [emotion]: {
          ...prev[emotion],
          track: normalizedTrack,
          trackName: jsonFile.name,
        },
      }));

      if (emotion === "normal") {
        setTrack(normalizedTrack);
      }
      void saveEmotionAssetToDb(emotion, "track", normalizedTrack, undefined, jsonFile.name);
    } catch (error) {
      alert(error instanceof Error ? error.message : "mouth_track.json の読み込みに失敗しました");
    } finally {
      event.target.value = "";
    }
  };

  const handleEmotionMouthSpriteUpload = (emotion: Emotion, name: MouthSpriteName, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    emotionMouthSpriteUrlsRef.current.push(url);

    const newSprite: GeneratedSprite = {
      name,
      url,
      frameIndex: 0,
      width: 0,
      height: 0,
    };

    setEmotionAssets((prev) => {
      const currentSprites = prev[emotion].mouthSprites || [];
      const updatedSprites = [
        ...currentSprites.filter((s) => s.name !== name),
        newSprite,
      ];
      return {
        ...prev,
        [emotion]: {
          ...prev[emotion],
          mouthSprites: updatedSprites,
        },
      };
    });

    if (emotion === "normal") {
      setManagedMouthSprites([
        ...mouthSprites.filter((s) => s.name !== name),
        newSprite,
      ]);
    }
    void saveEmotionAssetToDb(emotion, "mouthSprite", file, name);
  };

  const handleEmotionVideoDrop = (emotion: Emotion, event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const isChromeVideo = file.type === "video/webm" || 
                            file.type === "video/mp4" || 
                            /\.(webm|mp4)$/i.test(file.name);
      if (!isChromeVideo) {
        alert("再生可能な動画形式ではありません。WebM または MP4 形式の動画をアップロードしてください。");
        return;
      }
      const url = URL.createObjectURL(file);
      
      const oldUrl = emotionVideoUrlsRef.current[emotion];
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      emotionVideoUrlsRef.current[emotion] = url;

      setEmotionAssets((prev) => ({
        ...prev,
        [emotion]: {
          ...prev[emotion],
          videoUrl: url,
          videoName: file.name,
        },
      }));

      if (emotion === "normal") {
        setMouthlessUrl(url);
      }
      void saveEmotionAssetToDb(emotion, "video", file);
    }
  };

  const handleEmotionTrackDrop = async (emotion: Emotion, event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const jsonFile = event.dataTransfer.files?.[0];
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

      setEmotionAssets((prev) => ({
        ...prev,
        [emotion]: {
          ...prev[emotion],
          track: normalizedTrack,
          trackName: jsonFile.name,
        },
      }));

      if (emotion === "normal") {
        setTrack(normalizedTrack);
      }
      void saveEmotionAssetToDb(emotion, "track", normalizedTrack, undefined, jsonFile.name);
    } catch (error) {
      alert(error instanceof Error ? error.message : "mouth_track.json の読み込みに失敗しました");
    }
  };

  const handleEmotionMouthSpriteDrop = (emotion: Emotion, name: MouthSpriteName, event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("画像ファイル（PNG等）をアップロードしてください。");
      return;
    }

    const url = URL.createObjectURL(file);
    emotionMouthSpriteUrlsRef.current.push(url);

    const newSprite: GeneratedSprite = {
      name,
      url,
      frameIndex: 0,
      width: 0,
      height: 0,
    };

    setEmotionAssets((prev) => {
      const currentSprites = prev[emotion].mouthSprites || [];
      const updatedSprites = [
        ...currentSprites.filter((s) => s.name !== name),
        newSprite,
      ];
      return {
        ...prev,
        [emotion]: {
          ...prev[emotion],
          mouthSprites: updatedSprites,
        },
      };
    });

    if (emotion === "normal") {
      setManagedMouthSprites([
        ...mouthSprites.filter((s) => s.name !== name),
        newSprite,
      ]);
    }
    void saveEmotionAssetToDb(emotion, "mouthSprite", file, name);
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
    const emotionVideoUrls = emotionVideoUrlsRef.current;
    const emotionMouthSpriteUrls = emotionMouthSpriteUrlsRef.current;
    return () => {
      revokeObjectUrl(videoUrlRef.current);
      revokeObjectUrl(downloadUrlRef.current);
      mouthSpriteUrlsRef.current.forEach(revokeObjectUrl);
      revokeObjectUrl(mouthlessUrlRef.current);
      revokeObjectUrl(runtimeBgImageUrlRef.current);
      Object.values(emotionVideoUrls).forEach(url => {
        if (url) revokeObjectUrl(url);
      });
      emotionMouthSpriteUrls.forEach(revokeObjectUrl);
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
      void saveLiveSettingsForObs({ bgType: "image" });
    }
  };

  const handleBgColorChange = (color: string) => {
    setRuntimeBgColor(color);
    setRuntimeBgType("color");
    localStorage.setItem("runtime_bg_type", "color");
    localStorage.setItem("runtime_bg_color", color);
    void saveLiveSettingsForObs({ bgType: "color", bgColor: color });
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
      const processed = postProcessTrackFrames(rawFrames, effectiveFps, smoothCutoff);
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

  const downloadAllMouthSprites = () => {
    mouthSpriteNames.forEach((name) => {
      const sprite = mouthSprites.find((s) => s.name === name);
      if (sprite) {
        const link = document.createElement("a");
        link.href = sprite.url;
        link.download = `${name}.png`;
        link.click();
      }
    });
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
                  <ModeButton active={mode === "presentation"} icon={<Presentation />} label="発表" onClick={() => setMode("presentation")} />
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
              <label className="grid gap-1 text-sm">
                <span className="font-medium flex items-center justify-between">
                  <span>ブレ防止強度 (滑らかさ)</span>
                  <span className="text-xs font-semibold text-teal-600">{smoothCutoff.toFixed(1)} Hz</span>
                </span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="0.5"
                    className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                    value={smoothCutoff}
                    onChange={(event) => setSmoothCutoff(Number(event.target.value))}
                  />
                </div>
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
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!track || !videoUrl || isExtractingMouth || isRunningAll}
                  onClick={() => void extractMouthSprites()}
                >
                  <Play className="size-4" />
                  5種を自動抽出
                </button>
                <button
                  className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={mouthSprites.length === 0}
                  onClick={downloadAllMouthSprites}
                >
                  <Download className="size-4" />
                  一括保存
                </button>
              </div>
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const link = document.createElement("a");
                              link.href = sprite.url;
                              link.download = `${name}.png`;
                              link.click();
                            }}
                            className="absolute top-1 right-1 z-10 rounded-full bg-slate-900/80 p-1 text-white hover:bg-slate-900 opacity-0 group-hover:opacity-100 transition"
                          >
                            <Download className="size-3" />
                          </button>
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
            {mouthlessUrl && isLocalCharacterPreviewEnabled && (
              <div
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: "center center",
                  cursor: isDraggingVideo ? "grabbing" : "grab",
                  width: videoMeta.width ? `${videoMeta.width}px` : "800px",
                  height: videoMeta.height ? `${videoMeta.height}px` : "450px",
                  maxWidth: "90vw",
                  maxHeight: "80vh",
                  aspectRatio: videoMeta.width && videoMeta.height ? `${videoMeta.width} / ${videoMeta.height}` : "16/9",
                }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden"
                onMouseDown={handleMouseDown}
                onWheel={handleWheel}
              >
                 <div className="relative w-full h-full">
                  <video
                    ref={runtimeVideoRef0}
                    className="pointer-events-none absolute inset-0 w-full h-full object-contain"
                    style={{ opacity: activeVideoIndex === 0 ? 1 : 0 }}
                    autoPlay
                    loop={false}
                    muted
                    playsInline
                    onEnded={handleVideoEnded}
                  />
                  <video
                    ref={runtimeVideoRef1}
                    className="pointer-events-none absolute inset-0 w-full h-full object-contain"
                    style={{ opacity: activeVideoIndex === 1 ? 1 : 0 }}
                    autoPlay
                    loop={false}
                    muted
                    playsInline
                    onEnded={handleVideoEnded}
                  />
                  <canvas
                    ref={runtimeCanvasRef}
                    className="pointer-events-none absolute inset-0 w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            {isYoutubeChatEnabled && (
              <div className="absolute right-6 top-24 z-40 flex h-[58vh] flex-col gap-2" style={{ width: `min(${youtubeChatWidth}px, calc(100vw - 48px))` }}>
                {youtubeChatStatusVisible && <div className="self-end rounded-full border border-white/30 bg-slate-950/55 px-3 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-sm">
                  YouTube Chat · {youtubeChatStatus}
                </div>}
                <div data-youtube-comment-list className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {youtubeMessages.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => setSelectedYoutubeMessageId(message.id)}
                      className={`flex w-full gap-2 rounded-2xl border px-3 py-2 text-left text-sm text-slate-900 shadow-lg backdrop-blur-sm transition ${
                        selectedYoutubeMessageId === message.id
                          ? "border-teal-400 bg-teal-50/95 ring-2 ring-teal-300"
                          : "border-white/20 bg-white/92 hover:border-teal-300 hover:bg-white"
                      }`}
                    >
                      {message.authorImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={message.authorImageUrl}
                          alt=""
                          className="mt-0.5 size-7 flex-none rounded-full bg-slate-200"
                        />
                      ) : (
                        <div className="mt-0.5 grid size-7 flex-none place-items-center rounded-full bg-teal-600 text-xs font-bold text-white">
                          {message.authorName.slice(0, 1)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="truncate text-xs font-bold text-slate-700">{message.authorName}</span>
                          {message.isOwner && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">OWNER</span>}
                          {message.isModerator && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">MOD</span>}
                          {message.isSponsor && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">MEMBER</span>}
                        </div>
                        <div className="break-words leading-relaxed">{message.message}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {selectedYoutubeMessage && (
                  <div className="rounded-2xl border border-teal-200 bg-white/95 p-3 text-sm text-slate-900 shadow-xl backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-teal-700">選択中コメント</div>
                        <div className="mt-1 truncate text-xs font-bold text-slate-700">{selectedYoutubeMessage.authorName}</div>
                        <div className="mt-1 line-clamp-3 break-words leading-relaxed">{selectedYoutubeMessage.message}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedYoutubeMessageId("")}
                        className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                      >
                        解除
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void replyToYoutubeMessage(selectedYoutubeMessage)}
                      disabled={!openaiApiKey || isChatSending}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-4 py-2 text-sm font-bold text-white shadow-md transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Send className="size-4" />
                      {isChatSending ? "返答生成中..." : "このコメントに返答"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chat Input Floating Form */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 flex flex-col items-center gap-4">
              {/* Latest User Message Bubble */}
              {lastUserMessage && (
                <div className="self-end rounded-2xl border border-slate-700 bg-slate-800/90 px-5 py-3 shadow-md backdrop-blur-sm max-w-[85%] text-sm text-white transition-all relative">
                  <div className="absolute -top-2.5 right-4 px-2 py-0.5 rounded bg-slate-600 text-[10px] font-bold text-white shadow-sm">
                    あなた
                  </div>
                  <div className="mt-1">{lastUserMessage}</div>
                </div>
              )}

              {/* Latest Reply Bubble */}
              {captionsEnabled && lastReply && (
                <div className="self-start rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 shadow-md backdrop-blur-sm max-w-[85%] text-sm text-slate-800 transition-all relative">
                  <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded bg-teal-600 text-[10px] font-bold text-white shadow-sm">
                    {EMOTIONS.find(e => e.key === currentEmotion)?.label || "通常"}
                  </div>
                  <div className="mt-1">{lastReply}</div>
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

        {mode === "presentation" && (
          <section className="mx-auto w-full max-w-[1600px] flex-1 px-5 pt-24 pb-4">
            <PresentationConsole embedded />
          </section>
        )}

        {mode === "settings" && (
          <section className="mx-auto w-full max-w-4xl flex-1 px-5 pt-24 pb-4">
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

                <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="text-sm font-semibold text-slate-800">キャラクターペルソナ</label>
                    <p className="mt-1 text-xs text-slate-500">通常チャットとYouTubeコメント応答に常に反映されます。</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold">名前<input value={persona.name} onChange={(event) => handlePersonaChange({ name: event.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 font-normal" /></label>
                    <label className="grid gap-1.5 text-sm font-semibold">一人称<input value={persona.firstPerson} onChange={(event) => handlePersonaChange({ firstPerson: event.target.value })} className="rounded-md border border-slate-200 bg-white px-3 py-2 font-normal" /></label>
                  </div>
                  <label className="grid gap-1.5 text-sm font-semibold">性格<textarea value={persona.personality} onChange={(event) => handlePersonaChange({ personality: event.target.value })} className="min-h-20 resize-y rounded-md border border-slate-200 bg-white p-3 font-normal" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold">話し方<textarea value={persona.speakingStyle} onChange={(event) => handlePersonaChange({ speakingStyle: event.target.value })} className="min-h-20 resize-y rounded-md border border-slate-200 bg-white p-3 font-normal" /></label>
                  <label className="grid gap-1.5 text-sm font-semibold">回答方針<textarea value={persona.responsePolicy} onChange={(event) => handlePersonaChange({ responsePolicy: event.target.value })} className="min-h-20 resize-y rounded-md border border-slate-200 bg-white p-3 font-normal" /></label>
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
                      onClick={() => handleTtsTypeChange("aivis-cloud")}
                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                        ttsType === "aivis-cloud"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      Aivis Cloud
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

                {ttsType === "aivis-cloud" && (
                  <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-semibold text-slate-800">Aivis Cloud API キー</label>
                      <input
                        type="password"
                        placeholder="Aivis Cloud APIキー"
                        value={aivisCloudApiKey}
                        onChange={(event) => handleAivisCloudApiKeyChange(event.target.value)}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                      />
                      <p className="text-xs text-slate-500">APIキーはブラウザの localStorage に保存され、ローカルAPI経由でAivis Cloud APIへ送信されます。</p>
                    </div>

                    <div className="grid gap-2">
                      <label className="text-sm font-semibold text-slate-800">モデルUUID</label>
                      <input
                        type="text"
                        placeholder="AivisHubのモデルUUID"
                        value={aivisCloudModelUuid}
                        onChange={(event) => handleAivisCloudModelUuidChange(event.target.value)}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                      />
                      <p className="text-xs text-slate-500">AivisHubのモデル詳細ページで確認できるUUIDを指定します。</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-2">
                        <label className="text-sm font-semibold text-slate-800">Style ID</label>
                        <input
                          type="number"
                          placeholder="0"
                          value={aivisCloudStyleId}
                          onChange={(event) => handleAivisCloudStyleIdChange(event.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-semibold text-slate-800">Style Name</label>
                        <input
                          type="text"
                          placeholder="Normal"
                          value={aivisCloudStyleName}
                          onChange={(event) => handleAivisCloudStyleNameChange(event.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <p className="-mt-2 text-xs text-slate-500">Style IDを入力している場合はStyle Nameより優先します。</p>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="grid gap-2">
                        <label className="text-sm font-semibold text-slate-800">出力形式</label>
                        <select
                          value={aivisCloudOutputFormat}
                          onChange={(event) => handleAivisCloudOutputFormatChange(event.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                        >
                          {["mp3", "wav", "aac", "opus", "flac"].map((format) => (
                            <option key={format} value={format}>
                              {format}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-semibold text-slate-800">話速</label>
                        <input
                          type="number"
                          min="0.5"
                          max="2"
                          step="0.1"
                          value={aivisCloudSpeakingRate}
                          onChange={(event) => handleAivisCloudSpeakingRateChange(event.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-semibold text-slate-800">ユーザー辞書UUID</label>
                        <input
                          type="text"
                          placeholder="任意"
                          value={aivisCloudUserDictionaryUuid}
                          onChange={(event) => handleAivisCloudUserDictionaryUuidChange(event.target.value)}
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

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
                {ttsType !== "aivis-cloud" && (
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
                )}

                {ttsType !== "aivis-cloud" && (
                  <div className="grid gap-2">
                    <label className="text-sm font-semibold text-slate-800">話速</label>
                    <input
                      type="number"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={localSpeakingRate}
                      onChange={(event) => handleLocalSpeakingRateChange(event.target.value)}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500">AivisSpeechローカル・VOICEVOX・カスタム接続先に共通で適用します。1.0が標準です。</p>
                  </div>
                )}

                {/* YouTube Live Chat */}
                <div className="h-px bg-slate-200 my-4" />

                <div className="grid gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label className="text-sm font-semibold text-slate-800">YouTubeライブチャット表示</label>
                      <p className="mt-1 text-xs text-slate-500">配信モード画面の右上にライブチャットを重ねます。</p>
                    </div>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        className="size-4 accent-teal-600"
                        checked={isYoutubeChatEnabled}
                        onChange={(event) => handleYoutubeChatEnabledChange(event.target.checked)}
                      />
                      表示する
                    </label>
                  </div>

                  <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800">字幕を表示
                      <input type="checkbox" className="size-4 accent-teal-600" checked={captionsEnabled} onChange={(event) => handleCaptionsEnabledChange(event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-800">接続状態ラベルを表示
                      <input type="checkbox" className="size-4 accent-teal-600" checked={youtubeChatStatusVisible} onChange={(event) => handleYoutubeChatStatusVisibleChange(event.target.checked)} />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800 md:col-span-2">コメント欄の横幅（px）
                      <input type="number" min="240" max="640" step="10" value={youtubeChatWidth} onChange={(event) => handleYoutubeChatWidthChange(Number(event.target.value))} className="rounded-md border border-slate-200 bg-white px-3 py-2 font-normal" />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800 md:col-span-2">OBSに表示するコメント数
                      <input type="number" min="1" max="30" step="1" value={youtubeChatVisibleCount} onChange={(event) => handleYoutubeChatVisibleCountChange(Number(event.target.value))} className="rounded-md border border-slate-200 bg-white px-3 py-2 font-normal" />
                    </label>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-semibold text-slate-800">YouTube Data API キー</label>
                    <input
                      type="password"
                      placeholder="AIza..."
                      value={youtubeApiKey}
                      onChange={(event) => handleYoutubeApiKeyChange(event.target.value)}
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500">APIキーはブラウザの localStorage に保存され、ローカルAPI経由でYouTubeに送信されます。</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-sm font-semibold text-slate-800">ライブ動画ID</label>
                      <input
                        type="text"
                        placeholder="YouTube URL末尾のID"
                        value={youtubeVideoId}
                        onChange={(event) => handleYoutubeVideoIdChange(event.target.value)}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-semibold text-slate-800">liveChatId</label>
                      <input
                        type="text"
                        placeholder="分かる場合だけ指定"
                        value={youtubeLiveChatId}
                        onChange={(event) => handleYoutubeLiveChatIdChange(event.target.value)}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    状態: {youtubeChatStatus}
                  </div>
                </div>

                {/* OBS Live Output */}
                <div className="h-px bg-slate-200 my-4" />

                <div className="grid gap-3">
                  <div>
                    <label className="text-sm font-semibold text-slate-800">OBS専用画面</label>
                    <p className="mt-1 text-xs text-slate-500">OBSにはこの専用画面だけを映します。設定画面や操作中のUIは配信に出ません。</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div>
                      <label className="text-sm font-semibold text-slate-800">管理画面のキャラプレビューを表示する</label>
                      <p className="mt-1 text-xs text-slate-500">OFFにすると、管理画面側の動画再生と口パク描画を止めます。OBS専用画面には影響しません。</p>
                    </div>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        className="size-4 accent-teal-600"
                        checked={isLocalCharacterPreviewEnabled}
                        onChange={(event) => handleLocalCharacterPreviewChange(event.target.checked)}
                      />
                      表示する
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div>
                      <label className="text-sm font-semibold text-slate-800">管理画面でも発話を再生する</label>
                      <p className="mt-1 text-xs text-slate-500">OFFにすると、管理画面側の音声再生と口パクを止めて、OBS専用画面だけで発話します。</p>
                    </div>
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        className="size-4 accent-teal-600"
                        checked={isLocalSpeechPlaybackEnabled}
                        onChange={(event) => handleLocalSpeechPlaybackChange(event.target.checked)}
                      />
                      再生する
                    </label>
                  </div>
                  <a
                    href="/live"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    <Radio className="size-4" />
                    OBS専用画面を開く
                  </a>
                  <button
                    type="button"
                    onClick={() => void syncAllLiveAssetsForObs()}
                    className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Upload className="size-4" />
                    OBSブラウザソース用に素材を同期
                  </button>
                  <p className="text-xs text-slate-500">状態: {liveAssetSyncStatus}</p>
                </div>

                {/* Emotion Assets Settings */}
                <div className="h-px bg-slate-200 my-4" />
                
                <div className="grid gap-4">
                  <label className="text-sm font-semibold text-slate-800">感情別キャラクター素材設定</label>
                  <p className="text-xs text-slate-500">AIの感情表現に合わせて切り替えるための「口無し動画」と「口位置追跡データ（mouth_track.json）」を設定します。</p>
                  
                  <div className="space-y-4">
                    {EMOTIONS.map((emotion) => {
                      const asset = emotionAssets[emotion.key];
                      const isNormal = emotion.key === "normal";
                      const hasVideo = !!asset.videoUrl;
                      const hasTrack = !!asset.track;
                      const isComplete = hasVideo && hasTrack;

                      let borderClass = "border-slate-200 bg-slate-50/50";
                      if (isNormal && !isComplete) {
                        borderClass = "border-rose-300 bg-rose-50/10 shadow-sm shadow-rose-100/50";
                      } else if (isComplete) {
                        borderClass = "border-emerald-200 bg-emerald-50/10";
                      }

                      let dotColor = "bg-slate-400";
                      if (isComplete) {
                        dotColor = "bg-emerald-500";
                      } else if (isNormal) {
                        dotColor = "bg-rose-500 animate-pulse";
                      }

                      return (
                        <div key={emotion.key} className={`rounded-lg border p-4 space-y-3 transition-colors ${borderClass}`}>
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor}`} />
                              {emotion.label} ({emotion.key})
                            </span>
                            
                            {isNormal ? (
                              isComplete ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  設定済み (必須)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200 animate-pulse">
                                  <span className="size-1.5 rounded-full bg-rose-500" />
                                  未設定 (必須)
                                </span>
                              )
                            ) : isComplete ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                個別設定済み
                              </span>
                            ) : (hasVideo || hasTrack) ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                                <span className="size-1.5 rounded-full bg-amber-500" />
                                一部未設定 (通常版で代替)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 border border-slate-200">
                                <span className="size-1.5 rounded-full bg-slate-400" />
                                未設定 (通常版で代替)
                              </span>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Video Upload */}
                            <div className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600 block">口無し動画 (ドラッグ＆ドロップ可)</span>
                              <label
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.add("border-teal-500", "bg-teal-50/20");
                                }}
                                onDragLeave={(e) => {
                                  e.currentTarget.classList.remove("border-teal-500", "bg-teal-50/20");
                                }}
                                onDrop={(e) => {
                                  e.currentTarget.classList.remove("border-teal-500", "bg-teal-50/20");
                                  handleEmotionVideoDrop(emotion.key, e);
                                }}
                                className={`flex items-center gap-2 cursor-pointer rounded-md border bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 truncate transition ${isNormal && !hasVideo ? "border-rose-300 ring-1 ring-rose-200" : "border-slate-200"}`}
                              >
                                <Video className="size-3.5 flex-shrink-0" />
                                <span className="truncate flex-1 text-left">
                                  {asset.videoName || "動画を選択またはドロップ..."}
                                </span>
                                <input
                                  type="file"
                                  accept="video/webm,video/mp4"
                                  className="sr-only"
                                  onChange={(e) => handleEmotionVideoUpload(emotion.key, e)}
                                />
                              </label>
                            </div>
                            
                            {/* JSON Upload */}
                            <div className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600 block">口位置 JSON (ドラッグ＆ドロップ可)</span>
                              <label
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.add("border-teal-500", "bg-teal-50/20");
                                }}
                                onDragLeave={(e) => {
                                  e.currentTarget.classList.remove("border-teal-500", "bg-teal-50/20");
                                }}
                                onDrop={(e) => {
                                  e.currentTarget.classList.remove("border-teal-500", "bg-teal-50/20");
                                  void handleEmotionTrackDrop(emotion.key, e);
                                }}
                                className={`flex items-center gap-2 cursor-pointer rounded-md border bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 truncate transition ${isNormal && !hasTrack ? "border-rose-300 ring-1 ring-rose-200" : "border-slate-200"}`}
                              >
                                <FileJson className="size-3.5 flex-shrink-0" />
                                <span className="truncate flex-1 text-left">
                                  {asset.trackName || "JSONを選択またはドロップ..."}
                                </span>
                                <input
                                  type="file"
                                  accept="application/json"
                                  className="sr-only"
                                  onChange={(e) => void handleEmotionTrackUpload(emotion.key, e)}
                                />
                              </label>
                            </div>
                          </div>

                          {/* Mouth PNG Sprites for this Emotion */}
                          <div className="pt-2 border-t border-slate-200/60">
                            <span className="text-xs font-semibold text-slate-600 block mb-2">口パーツ画像（PNG素材 - ドラッグ＆ドロップ可）</span>
                            <div className="grid grid-cols-5 gap-2">
                              {mouthSpriteNames.map((name) => {
                                const currentSprites = asset.mouthSprites || [];
                                const sprite = currentSprites.find((s) => s.name === name);
                                return (
                                  <label
                                    key={name}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      e.currentTarget.classList.add("border-teal-500", "bg-teal-50/20");
                                    }}
                                    onDragLeave={(e) => {
                                      e.currentTarget.classList.remove("border-teal-500", "bg-teal-50/20");
                                    }}
                                    onDrop={(e) => {
                                      e.currentTarget.classList.remove("border-teal-500", "bg-teal-50/20");
                                      handleEmotionMouthSpriteDrop(emotion.key, name, e);
                                    }}
                                    className="group relative grid gap-1 rounded-md border border-dashed border-slate-300 bg-white p-2 text-center text-xs font-semibold cursor-pointer hover:border-teal-500 hover:bg-teal-50/10 transition"
                                  >
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="sr-only"
                                      onChange={(e) => handleEmotionMouthSpriteUpload(emotion.key, name, e)}
                                    />
                                    {sprite ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            const link = document.createElement("a");
                                            link.href = sprite.url;
                                            link.download = `${emotion.key}_${name}.png`;
                                            link.click();
                                          }}
                                          className="absolute top-1 right-1 z-10 rounded-full bg-slate-900/80 p-1 text-white hover:bg-slate-900 opacity-0 group-hover:opacity-100 transition"
                                        >
                                          <Download className="size-2.5" />
                                        </button>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img className="aspect-square w-full rounded bg-slate-50 object-contain border border-slate-100" src={sprite.url} alt={`${name} mouth`} />
                                        <span className="truncate text-slate-600 text-[9px] mt-0.5">{name}</span>
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition rounded-md text-[9px]">
                                          変更
                                        </span>
                                      </>
                                    ) : (
                                      <div className="flex aspect-square w-full flex-col items-center justify-center text-slate-400">
                                        <Upload className="size-3" />
                                        <span className="mt-0.5 text-[8px] truncate text-slate-500">{name}</span>
                                      </div>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
                        void saveLiveSettingsForObs({ bgType: "color", bgColor: runtimeBgColor });
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
                        void saveLiveSettingsForObs({ bgType: "image" });
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
                          ["#ffffff", "白"],
                          ["#00ff00", "グリーンバック"],
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
