import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

type YouTubeVideosResponse = {
  items?: Array<{
    liveStreamingDetails?: {
      activeLiveChatId?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type YouTubeLiveChatResponse = {
  nextPageToken?: string;
  pollingIntervalMillis?: number;
  items?: Array<{
    id: string;
    snippet?: {
      publishedAt?: string;
      displayMessage?: string;
      type?: string;
    };
    authorDetails?: {
      displayName?: string;
      profileImageUrl?: string;
      isChatOwner?: boolean;
      isChatModerator?: boolean;
      isChatSponsor?: boolean;
    };
  }>;
  error?: {
    message?: string;
  };
};

type NormalizedYouTubeMessage = {
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

type ChatCache = Record<
  string,
  {
    updatedAt: number;
    messages: NormalizedYouTubeMessage[];
  }
>;

const CHAT_CACHE_PATH = path.resolve(".aituber-live-chat-cache.json");

const getYouTubeError = (data: YouTubeVideosResponse | YouTubeLiveChatResponse, fallback: string) =>
  data.error?.message || fallback;

const readChatCache = async (): Promise<ChatCache> => {
  try {
    return JSON.parse(await readFile(CHAT_CACHE_PATH, "utf8")) as ChatCache;
  } catch {
    return {};
  }
};

const writeChatCache = async (cache: ChatCache) => {
  await writeFile(CHAT_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
};

const mergeMessages = (cachedMessages: NormalizedYouTubeMessage[], fetchedMessages: NormalizedYouTubeMessage[]) => {
  const byId = new Map<string, NormalizedYouTubeMessage>();
  for (const message of cachedMessages) byId.set(message.id, message);
  for (const message of fetchedMessages) byId.set(message.id, message);

  return Array.from(byId.values())
    .sort((a, b) => Date.parse(a.publishedAt || "") - Date.parse(b.publishedAt || ""))
    .slice(-30);
};

export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get("apiKey")?.trim();
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
  let liveChatId = request.nextUrl.searchParams.get("liveChatId")?.trim();
  const pageToken = request.nextUrl.searchParams.get("pageToken")?.trim();

  if (!apiKey) {
    return NextResponse.json({ error: "YouTube APIキーが必要です" }, { status: 400 });
  }
  if (!videoId && !liveChatId) {
    return NextResponse.json({ error: "YouTube動画IDまたはliveChatIdが必要です" }, { status: 400 });
  }

  try {
    if (videoId) {
      const videoUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      videoUrl.searchParams.set("part", "liveStreamingDetails");
      videoUrl.searchParams.set("id", videoId);
      videoUrl.searchParams.set("key", apiKey);

      const videoRes = await fetch(videoUrl, { cache: "no-store" });
      const videoData = (await videoRes.json()) as YouTubeVideosResponse;
      if (!videoRes.ok) {
        return NextResponse.json({ error: getYouTubeError(videoData, "YouTube動画情報の取得に失敗しました") }, { status: videoRes.status });
      }

      liveChatId = videoData.items?.[0]?.liveStreamingDetails?.activeLiveChatId || liveChatId;
      if (!liveChatId) {
        return NextResponse.json({ error: "この動画から有効なライブチャットIDを取得できませんでした" }, { status: 404 });
      }
    }

    if (!liveChatId) {
      return NextResponse.json({ error: "liveChatIdを特定できませんでした" }, { status: 404 });
    }

    const chatUrl = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    chatUrl.searchParams.set("part", "snippet,authorDetails");
    chatUrl.searchParams.set("liveChatId", liveChatId);
    chatUrl.searchParams.set("key", apiKey);
    chatUrl.searchParams.set("maxResults", "200");
    chatUrl.searchParams.set("profileImageSize", "48");
    if (pageToken) chatUrl.searchParams.set("pageToken", pageToken);

    const chatRes = await fetch(chatUrl, { cache: "no-store" });
    const chatData = (await chatRes.json()) as YouTubeLiveChatResponse;
    if (!chatRes.ok) {
      return NextResponse.json({ error: getYouTubeError(chatData, "ライブチャットの取得に失敗しました") }, { status: chatRes.status });
    }

    const fetchedMessages =
      chatData.items?.map((item) => ({
        id: item.id,
        authorName: item.authorDetails?.displayName ?? "匿名",
        authorImageUrl: item.authorDetails?.profileImageUrl ?? "",
        message: item.snippet?.displayMessage ?? "",
        publishedAt: item.snippet?.publishedAt ?? "",
        type: item.snippet?.type ?? "textMessageEvent",
        isOwner: Boolean(item.authorDetails?.isChatOwner),
        isModerator: Boolean(item.authorDetails?.isChatModerator),
        isSponsor: Boolean(item.authorDetails?.isChatSponsor),
      })) ?? [];

    const cache = await readChatCache();
    const cachedMessages = cache[liveChatId]?.messages ?? [];
    const messages = mergeMessages(cachedMessages, fetchedMessages);
    if (fetchedMessages.length > 0 || messages.length > 0) {
      cache[liveChatId] = {
        updatedAt: Date.now(),
        messages,
      };
      await writeChatCache(cache);
    }

    return NextResponse.json({
      liveChatId,
      nextPageToken: chatData.nextPageToken ?? "",
      pollingIntervalMillis: chatData.pollingIntervalMillis ?? 5000,
      fetchedCount: fetchedMessages.length,
      messages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "YouTubeライブチャットへ接続できません" },
      { status: 502 },
    );
  }
}
