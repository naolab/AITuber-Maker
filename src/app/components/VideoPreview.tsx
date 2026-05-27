"use client";

import { Upload } from "lucide-react";
import type { CSSProperties, ChangeEvent, DragEvent, RefObject } from "react";
import type { Quad } from "@/lib/materials";

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  videoUrl: string;
  mouthlessUrl: string;
  previewTab: "original" | "mouthless";
  onPreviewTabChange: (tab: "original" | "mouthless") => void;
  currentQuad: Quad | undefined;
  overlaySize: { width: number; height: number };
  videoFrameStyle: CSSProperties;
  isDragging: boolean;
  onDragStateChange: (dragging: boolean) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onMetadataLoaded: () => void;
  onTimeUpdate: () => void;
  onSeeked: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
}

export default function VideoPreview({
  videoRef,
  canvasRef,
  previewRef,
  videoUrl,
  mouthlessUrl,
  previewTab,
  onPreviewTabChange,
  currentQuad,
  overlaySize,
  videoFrameStyle,
  isDragging,
  onDragStateChange,
  onDrop,
  onFileInput,
  onMetadataLoaded,
  onTimeUpdate,
  onSeeked,
  onPlay,
  onPause,
  onEnded,
}: VideoPreviewProps) {
  return (
    <div ref={previewRef} className="relative min-h-0 min-w-0 overflow-hidden bg-[var(--color-bg-deep)]">
      {videoUrl ? (
        <div className="grid h-full place-items-center p-5">
          <div className="grid min-w-0 justify-items-center gap-3">
            {/* Tab switcher */}
            {mouthlessUrl && (
              <div className="flex rounded-[var(--radius-full)] border border-[var(--color-border)] bg-white p-1 shadow-[var(--shadow-sm)]">
                <button
                  className={`rounded-[var(--radius-full)] px-4 py-1.5 text-xs font-semibold transition-all duration-[var(--transition-fast)] ${
                    previewTab === "original"
                      ? "bg-[var(--color-dark)] text-white shadow-[var(--shadow-xs)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                  onClick={() => onPreviewTabChange("original")}
                >
                  元動画
                </button>
                <button
                  className={`rounded-[var(--radius-full)] px-4 py-1.5 text-xs font-semibold transition-all duration-[var(--transition-fast)] ${
                    previewTab === "mouthless"
                      ? "bg-[var(--color-dark)] text-white shadow-[var(--shadow-xs)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                  onClick={() => onPreviewTabChange("mouthless")}
                >
                  口無し動画
                </button>
              </div>
            )}

            {/* Video frame */}
            <div
              className="relative overflow-hidden rounded-[var(--radius-lg)] bg-black shadow-[var(--shadow-lg)]"
              style={videoFrameStyle}
            >
              {previewTab === "mouthless" && mouthlessUrl ? (
                <video className="size-full object-contain" src={mouthlessUrl} controls playsInline loop />
              ) : (
                <video
                  ref={videoRef}
                  className="size-full object-contain"
                  src={videoUrl}
                  controls
                  playsInline
                  onLoadedMetadata={onMetadataLoaded}
                  onTimeUpdate={onTimeUpdate}
                  onSeeked={onSeeked}
                  onPlay={onPlay}
                  onPause={onPause}
                  onEnded={onEnded}
                />
              )}

              {/* Quad overlay */}
              {previewTab === "original" && currentQuad && overlaySize.width > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0 size-full"
                  viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <polygon
                    points={currentQuad.map(([x, y]) => `${x},${y}`).join(" ")}
                    fill="rgba(99, 102, 241, 0.15)"
                    stroke="#6366F1"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx={currentQuad.reduce((s, [x]) => s + x, 0) / 4}
                    cy={currentQuad.reduce((s, [, y]) => s + y, 0) / 4}
                    r="4"
                    fill="#F43F5E"
                    stroke="white"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Upload drop zone */
        <label
          className={`drop-zone m-6 grid h-[calc(100%-48px)] cursor-pointer place-items-center text-center ${isDragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            onDragStateChange(true);
          }}
          onDragLeave={() => onDragStateChange(false)}
          onDrop={onDrop}
        >
          <input className="sr-only" type="file" accept="video/*" onChange={onFileInput} />
          <span className="grid justify-items-center gap-4">
            <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[#818CF8] text-white shadow-[var(--shadow-md)]">
              <Upload className="size-7" />
            </span>
            <span className="text-xl font-bold text-[var(--color-text)]">動画をアップロード</span>
            <span className="text-sm text-[var(--color-text-muted)]">MP4、WebM、MOV などを選択またはドラッグ＆ドロップ</span>
          </span>
        </label>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
