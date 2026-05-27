"use client";

import { Radio, Send } from "lucide-react";
import type { ChangeEvent, PointerEvent, RefObject } from "react";

import StreamingPanel from "@/app/components/StreamingPanel";

import type { GeneratedSprite, MouthSpriteName, MouthTrack, Quad } from "@/lib/materials";
import { mouthSpriteNames } from "@/lib/materials";

type ChatMessage = { role: "user" | "assistant"; content: string };
type VoicevoxSpeaker = { name: string; styles: Array<{ id: number; name: string }> };
type MouthState = "closed" | "half" | "open" | "e" | "u";

interface StreamingModeProps {
  runtimePreviewRef: RefObject<HTMLDivElement | null>;
  runtimeVideoRef: RefObject<HTMLVideoElement | null>;
  runtimeCompositeCanvasRef: RefObject<HTMLCanvasElement | null>;
  /* video display */
  mouthlessUrl: string;
  runtimeAspectRatio: number;
  streamingVideoX: number;
  streamingVideoY: number;
  streamingVideoWidth: number;
  track: MouthTrack | null;
  /* mouth */
  mouthState: MouthState;
  mouthSprites: GeneratedSprite[];
  runtimeQuad: unknown;
  runtimeMouthSprite: GeneratedSprite | undefined;
  /* drag handlers */
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onResizeDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onRuntimeMetadataLoaded: () => void;
  onRuntimeTimeUpdate: () => void;
  /* panel */
  isStreamingMenuOpen: boolean;
  onToggleMenu: () => void;
  runtimeAssetReady: boolean;
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
  chatInput: string;
  chatMessages: ChatMessage[];
  isChatRunning: boolean;
  audioUrl: string;
  onOpenAiKeyChange: (key: string) => void;
  onOpenAiModelChange: (model: string) => void;
  onSystemPromptChange: (prompt: string) => void;
  onChatInputChange: (value: string) => void;
  onSendChat: () => void;
  onStopSpeech: () => void;
  onClearChat: () => void;
}

export default function StreamingMode(props: StreamingModeProps) {
  return (
    <section className="relative min-h-0 overflow-hidden bg-[var(--color-bg-deep)] animate-fade-in">
      <div ref={props.runtimePreviewRef} className="absolute inset-0 overflow-hidden">
        {/* Character viewport */}
        <div
          className="absolute cursor-move select-none overflow-hidden rounded-[var(--radius-lg)] bg-black shadow-[var(--shadow-xl)]"
          onPointerDown={props.onPointerDown}
          onPointerMove={props.onPointerMove}
          onPointerUp={props.onPointerUp}
          style={{
            aspectRatio: String(props.runtimeAspectRatio),
            left: props.streamingVideoX,
            top: props.streamingVideoY,
            width: `${props.streamingVideoWidth}px`,
          }}
        >
          {props.mouthlessUrl ? (
            <video
              ref={props.runtimeVideoRef}
              className="size-full object-contain"
              src={props.mouthlessUrl}
              autoPlay
              muted
              loop
              playsInline
              onLoadedMetadata={props.onRuntimeMetadataLoaded}
              onTimeUpdate={props.onRuntimeTimeUpdate}
            />
          ) : (
            <div className="grid size-full place-items-center text-center">
              <div className="grid justify-items-center gap-3">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-primary)]/20 to-[#818CF8]/20">
                  <Radio className="size-7 text-[var(--color-primary)]" />
                </div>
                <p className="text-sm font-semibold text-white/80">口無し動画を読み込んでください</p>
                <p className="text-xs text-white/40">メニューから素材を設定</p>
              </div>
            </div>
          )}
          {/* Mouth composite canvas */}
          {props.runtimeMouthSprite && props.runtimeQuad && props.track && (
            <canvas
              ref={props.runtimeCompositeCanvasRef}
              className="pointer-events-none absolute inset-0 size-full"
              width={props.track.width}
              height={props.track.height}
            />
          )}
          {/* Fallback mouth position */}
          {props.runtimeMouthSprite && (!props.runtimeQuad || !props.track) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pointer-events-none absolute left-1/2 top-[56%] w-[12%] -translate-x-1/2 -translate-y-1/2 object-contain"
              src={props.runtimeMouthSprite.url}
              alt=""
            />
          )}
          {/* Resize handle */}
          <button
            aria-label="サイズ変更"
            className="absolute bottom-1.5 right-1.5 size-5 cursor-nwse-resize rounded-[var(--radius-sm)] border border-white/40 bg-black/40 backdrop-blur-sm hover:border-white/70 transition-all"
            data-resize-handle
            onPointerDown={props.onResizeDown}
            onPointerMove={props.onPointerMove}
            onPointerUp={props.onPointerUp}
          />

          {/* Mouth state indicator */}
          {props.mouthState !== "closed" && (
            <div className="absolute top-2 left-2 rounded-[var(--radius-sm)] bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              🗣 {props.mouthState}
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      <StreamingPanel
        isOpen={props.isStreamingMenuOpen}
        onToggle={props.onToggleMenu}
        runtimeAssetReady={props.runtimeAssetReady}
        mouthSprites={props.mouthSprites}
        mouthlessUrl={props.mouthlessUrl}
        onLoadMouthlessFile={props.onLoadMouthlessFile}
        onLoadTrackJson={props.onLoadTrackJson}
        onLoadMouthSprite={props.onLoadMouthSprite}
        voicevoxUrl={props.voicevoxUrl}
        voicevoxStatus={props.voicevoxStatus}
        voicevoxSpeakers={props.voicevoxSpeakers}
        voicevoxSpeakerId={props.voicevoxSpeakerId}
        onVoicevoxUrlChange={props.onVoicevoxUrlChange}
        onVoicevoxSpeakerChange={props.onVoicevoxSpeakerChange}
        onTestVoicevox={props.onTestVoicevox}
        openAiKey={props.openAiKey}
        openAiModel={props.openAiModel}
        systemPrompt={props.systemPrompt}
        chatMessages={props.chatMessages}
        isChatRunning={props.isChatRunning}
        audioUrl={props.audioUrl}
        onOpenAiKeyChange={props.onOpenAiKeyChange}
        onOpenAiModelChange={props.onOpenAiModelChange}
        onSystemPromptChange={props.onSystemPromptChange}
        onStopSpeech={props.onStopSpeech}
        onClearChat={props.onClearChat}
      />

      {/* Chat input bar */}
      <div className="absolute inset-x-0 bottom-0 z-20 border-t border-[var(--color-border)] bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur-md">
        <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)_42px] gap-2">
          <textarea
            className="h-10 min-h-10 resize-none rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm leading-6 focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all placeholder:text-[var(--color-text-muted)]"
            value={props.chatInput}
            onChange={(e) => props.onChatInputChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") props.onSendChat();
            }}
            placeholder="話しかける内容を入力…"
          />
          <button
            className="grid size-10 place-items-center rounded-[var(--radius-lg)] bg-gradient-to-r from-[var(--color-primary)] to-[#818CF8] text-white shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
            disabled={!props.chatInput.trim() || props.isChatRunning}
            onClick={props.onSendChat}
            title="送信 (Ctrl+Enter)"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
