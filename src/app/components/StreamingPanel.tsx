"use client";

import {
  FileJson,
  MessageSquare,
  Mic2,
  Square,
  Trash2,
  Upload,
  Video,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { ChangeEvent } from "react";

import Button from "@/app/components/shared/Button";
import Card, { CardHeader, CardBody } from "@/app/components/shared/Card";
import SpriteGrid from "@/app/components/shared/SpriteGrid";

import type { GeneratedSprite, MouthSpriteName } from "@/lib/materials";
import { mouthSpriteNames } from "@/lib/materials";

type ChatMessage = { role: "user" | "assistant"; content: string };
type VoicevoxSpeaker = { name: string; styles: Array<{ id: number; name: string }> };

interface StreamingPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  /* assets */
  runtimeAssetReady: boolean;
  mouthSprites: GeneratedSprite[];
  mouthlessUrl: string;
  onLoadMouthlessFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onLoadTrackJson: (event: ChangeEvent<HTMLInputElement>) => void;
  onLoadMouthSprite: (name: MouthSpriteName) => (event: ChangeEvent<HTMLInputElement>) => void;
  /* voicevox */
  voicevoxUrl: string;
  voicevoxStatus: string;
  voicevoxSpeakers: VoicevoxSpeaker[];
  voicevoxSpeakerId: number;
  onVoicevoxUrlChange: (url: string) => void;
  onVoicevoxSpeakerChange: (id: number) => void;
  onTestVoicevox: () => void;
  /* chat */
  openAiKey: string;
  openAiModel: string;
  systemPrompt: string;
  chatMessages: ChatMessage[];
  isChatRunning: boolean;
  audioUrl: string;
  onOpenAiKeyChange: (key: string) => void;
  onOpenAiModelChange: (model: string) => void;
  onSystemPromptChange: (prompt: string) => void;
  onStopSpeech: () => void;
  onClearChat: () => void;
}

export default function StreamingPanel({
  isOpen,
  onToggle,
  runtimeAssetReady,
  mouthSprites,
  mouthlessUrl,
  onLoadMouthlessFile,
  onLoadTrackJson,
  onLoadMouthSprite,
  voicevoxUrl,
  voicevoxStatus,
  voicevoxSpeakers,
  voicevoxSpeakerId,
  onVoicevoxUrlChange,
  onVoicevoxSpeakerChange,
  onTestVoicevox,
  openAiKey,
  openAiModel,
  systemPrompt,
  chatMessages,
  isChatRunning,
  audioUrl,
  onOpenAiKeyChange,
  onOpenAiModelChange,
  onSystemPromptChange,
  onStopSpeech,
  onClearChat,
}: StreamingPanelProps) {
  const voicevoxConnected = voicevoxStatus.startsWith("接続OK");

  return (
    <>
      {/* Toggle button */}
      <button
        className="absolute right-0 top-4 z-30 rounded-l-[var(--radius-lg)] bg-white/90 border border-r-0 border-[var(--color-border)] px-3 py-2.5 text-xs font-semibold text-[var(--color-text)] shadow-[var(--shadow-md)] backdrop-blur-md hover:bg-white transition-all"
        onClick={onToggle}
      >
        {isOpen ? "✕" : "☰ メニュー"}
      </button>

      {/* Panel */}
      <aside
        className={`
          absolute bottom-16 right-0 top-0 z-20 flex w-[360px] min-h-0 flex-col gap-3 overflow-y-auto
          border-l border-[var(--color-border)] bg-white/95 p-3 shadow-[var(--shadow-xl)] backdrop-blur-md
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `.trim()}
      >
        {/* ── Assets ── */}
        <Card>
          <CardHeader
            icon={<Video className="size-3.5" />}
            title="実行素材"
            badge={runtimeAssetReady ? "準備OK" : "一部未設定"}
            badgeVariant={runtimeAssetReady ? "success" : "warning"}
          />
          <CardBody className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" icon={<Upload className="size-3.5" />} className="w-full pointer-events-none">
                  口無し動画
                </Button>
                <input className="sr-only" type="file" accept="video/*" onChange={onLoadMouthlessFile} />
              </label>
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" icon={<FileJson className="size-3.5" />} className="w-full pointer-events-none">
                  track JSON
                </Button>
                <input className="sr-only" type="file" accept="application/json,.json" onChange={onLoadTrackJson} />
              </label>
            </div>
            <SpriteGrid sprites={mouthSprites} allNames={mouthSpriteNames} mode="upload" onUpload={onLoadMouthSprite} />
          </CardBody>
        </Card>

        {/* ── VOICEVOX ── */}
        <Card>
          <CardHeader
            icon={<Mic2 className="size-3.5" />}
            title="VOICEVOX / AivisSpeech"
            badge={voicevoxStatus}
            badgeVariant={voicevoxConnected ? "success" : "default"}
          >
            <span className="flex size-5 items-center justify-center">
              {voicevoxConnected ? (
                <Wifi className="size-3.5 text-[var(--color-success)]" />
              ) : (
                <WifiOff className="size-3.5 text-[var(--color-text-muted)]" />
              )}
            </span>
          </CardHeader>
          <CardBody className="grid gap-2.5">
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">接続先URL</span>
              <input
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                value={voicevoxUrl}
                onChange={(e) => onVoicevoxUrlChange(e.target.value)}
              />
            </label>
            <Button variant="secondary" size="sm" onClick={onTestVoicevox} className="w-full">
              接続テスト
            </Button>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">話者 / スタイル</span>
              <select
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                value={voicevoxSpeakerId}
                onChange={(e) => onVoicevoxSpeakerChange(Number(e.target.value))}
              >
                {voicevoxSpeakers.length ? (
                  voicevoxSpeakers.flatMap((speaker) =>
                    speaker.styles.map((style) => (
                      <option key={style.id} value={style.id}>
                        {speaker.name} / {style.name}
                      </option>
                    )),
                  )
                ) : (
                  <option value={voicevoxSpeakerId}>Speaker {voicevoxSpeakerId}</option>
                )}
              </select>
            </label>
          </CardBody>
        </Card>

        {/* ── Chat / LLM ── */}
        <Card>
          <CardHeader
            icon={<MessageSquare className="size-3.5" />}
            title="チャット設定"
            badge={isChatRunning ? "応答中…" : "待機"}
            badgeVariant={isChatRunning ? "active" : "default"}
          />
          <CardBody className="grid gap-2.5">
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">OpenAI API キー</span>
              <input
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-mono focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                type="password"
                value={openAiKey}
                onChange={(e) => onOpenAiKeyChange(e.target.value)}
                placeholder="sk-..."
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">モデル</span>
              <input
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                value={openAiModel}
                onChange={(e) => onOpenAiModelChange(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">システムプロンプト</span>
              <textarea
                className="min-h-16 resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs leading-5 focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                value={systemPrompt}
                onChange={(e) => onSystemPromptChange(e.target.value)}
              />
            </label>

            {/* Chat history */}
            {chatMessages.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 text-xs">
                <div className="grid gap-2">
                  {chatMessages.map((msg, i) => (
                    <div
                      className={`rounded-[var(--radius-md)] px-3 py-2 ${
                        msg.role === "user"
                          ? "bg-white border border-[var(--color-border)] ml-4"
                          : "bg-[var(--color-primary-light)] text-[var(--color-text)] mr-4"
                      }`}
                      key={`${msg.role}-${i}`}
                    >
                      <p className="mb-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                        {msg.role === "user" ? "あなた" : "AITuber"}
                      </p>
                      <p className="whitespace-pre-wrap leading-5">{msg.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" icon={<Square className="size-3.5" />} onClick={onStopSpeech}>
                発話停止
              </Button>
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onClearChat}>
                履歴クリア
              </Button>
            </div>

            {audioUrl && (
              <audio className="w-full h-8" controls src={audioUrl}>
                <track kind="captions" />
              </audio>
            )}
          </CardBody>
        </Card>
      </aside>
    </>
  );
}
