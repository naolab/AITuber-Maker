"use client";

import {
  Activity,
  CircleStop,
  Download,
  FileJson,
  Play,
  Upload,
  Video,
  Wand2,
  Zap,
} from "lucide-react";
import type { ChangeEvent } from "react";

import Button from "@/app/components/shared/Button";
import Card, { CardHeader, CardBody } from "@/app/components/shared/Card";
import ProgressBar from "@/app/components/shared/ProgressBar";
import SpriteGrid from "@/app/components/shared/SpriteGrid";

import type { GeneratedSprite, SpeedMode } from "@/lib/materials";
import { formatTime, mouthSpriteNames, speedPresets } from "@/lib/materials";

interface WorkflowPanelProps {
  file: File | null;
  videoMeta: { width: number; height: number; duration: number };
  status: string;
  progress: number;
  track: unknown;
  downloadUrl: string;
  loadedTrackName: string;
  mouthSprites: GeneratedSprite[];
  mouthStatus: string;
  mouthlessUrl: string;
  mouthlessStatus: string;
  analysisFps: number;
  speedMode: SpeedMode;
  isAnalyzing: boolean;
  isRunningAll: boolean;
  isExtractingMouth: boolean;
  isGeneratingMouthless: boolean;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onAnalysisFpsChange: (fps: number) => void;
  onSpeedModeChange: (mode: SpeedMode) => void;
  onRunFullPipeline: () => void;
  onAnalyze: () => void;
  onStopAnalysis: () => void;
  onExtractMouth: () => void;
  onGenerateMouthless: () => void;
  onLoadTrackJson: (event: ChangeEvent<HTMLInputElement>) => void;
}

export default function WorkflowPanel({
  file,
  videoMeta,
  status,
  progress,
  track,
  downloadUrl,
  loadedTrackName,
  mouthSprites,
  mouthStatus,
  mouthlessUrl,
  mouthlessStatus,
  analysisFps,
  speedMode,
  isAnalyzing,
  isRunningAll,
  isExtractingMouth,
  isGeneratingMouthless,
  onFileInput,
  onAnalysisFpsChange,
  onSpeedModeChange,
  onRunFullPipeline,
  onAnalyze,
  onStopAnalysis,
  onExtractMouth,
  onGenerateMouthless,
  onLoadTrackJson,
}: WorkflowPanelProps) {
  const isBusy = isAnalyzing || isRunningAll || isExtractingMouth || isGeneratingMouthless;

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-[var(--color-border)] bg-white p-3">
      {/* ── Quick action ── */}
      <Button
        variant="primary"
        size="lg"
        icon={<Zap className="size-4" />}
        className="w-full"
        disabled={!file || !videoMeta.width || isBusy}
        loading={isRunningAll}
        onClick={onRunFullPipeline}
      >
        一括生成（解析 → 口PNG → 口無し動画）
      </Button>

      {/* ── Step 1: Input ── */}
      <Card>
        <CardHeader
          stepNumber={1}
          stepComplete={!!file && !!videoMeta.width}
          title="動画入力"
          badge={status}
          badgeVariant={isAnalyzing ? "active" : track ? "success" : "default"}
        />
        <CardBody className="grid gap-3">
          <label className="cursor-pointer">
            <Button variant="outline" size="md" icon={<Upload className="size-4" />} className="w-full pointer-events-none">
              動画を選択
            </Button>
            <input className="sr-only" type="file" accept="video/*" onChange={onFileInput} />
          </label>

          <dl className="grid gap-1.5 text-xs">
            <InfoRow label="ファイル" value={file?.name ?? "未選択"} />
            <InfoRow label="サイズ" value={videoMeta.width ? `${videoMeta.width} × ${videoMeta.height}` : "—"} />
            <InfoRow label="長さ" value={videoMeta.duration ? formatTime(videoMeta.duration) : "—"} />
          </dl>
        </CardBody>
      </Card>

      {/* ── Step 2: Analysis ── */}
      <Card>
        <CardHeader
          stepNumber={2}
          stepComplete={!!track}
          title="口追跡 JSON 生成"
          badge={isAnalyzing ? `${Math.round(progress * 100)}%` : track ? "完了" : "待機"}
          badgeVariant={isAnalyzing ? "active" : track ? "success" : "default"}
        />
        <CardBody className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">解析FPS</span>
              <input
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                type="number"
                min="1"
                max="60"
                value={analysisFps}
                onChange={(e) => onAnalysisFpsChange(Number(e.target.value) || 1)}
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">速度モード</span>
              <select
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-glow)] transition-all"
                value={speedMode}
                onChange={(e) => onSpeedModeChange(e.target.value as SpeedMode)}
              >
                {Object.entries(speedPresets).map(([val, preset]) => (
                  <option key={val} value={val}>{preset.label}</option>
                ))}
              </select>
            </label>
          </div>

          <ProgressBar value={progress} animated={isAnalyzing} />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Play className="size-3.5" />}
              disabled={!file || !videoMeta.width || isAnalyzing || isRunningAll}
              onClick={onAnalyze}
            >
              解析開始
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<CircleStop className="size-3.5" />}
              disabled={!isAnalyzing}
              onClick={onStopAnalysis}
            >
              停止
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-semibold transition-all ${
                downloadUrl
                  ? "bg-[var(--color-dark)] text-white hover:bg-[var(--color-dark-hover)] shadow-[var(--shadow-xs)]"
                  : "pointer-events-none bg-[var(--color-bg-deep)] text-[var(--color-text-muted)]"
              }`}
              href={downloadUrl || undefined}
              download="mouth_track.json"
            >
              <Download className="size-3.5" />
              JSON保存
            </a>
            <label className="cursor-pointer">
              <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-all">
                <FileJson className="size-3.5" />
                JSON読込
              </span>
              <input className="sr-only" type="file" accept="application/json,.json" onChange={onLoadTrackJson} />
            </label>
          </div>
          {loadedTrackName && (
            <p className="truncate text-[10px] text-[var(--color-text-muted)]">📄 {loadedTrackName}</p>
          )}
        </CardBody>
      </Card>

      {/* ── Step 3: Mouth PNG ── */}
      <Card>
        <CardHeader
          stepNumber={3}
          stepComplete={mouthSprites.length > 0}
          title="口PNG差分 抽出"
          badge={mouthStatus}
          badgeVariant={isExtractingMouth ? "active" : mouthSprites.length > 0 ? "success" : "default"}
        />
        <CardBody className="grid gap-3">
          <Button
            variant="primary"
            size="sm"
            icon={<Activity className="size-3.5" />}
            disabled={!track || !file || isExtractingMouth || isRunningAll}
            loading={isExtractingMouth}
            onClick={onExtractMouth}
            className="w-full"
          >
            5種を自動抽出
          </Button>
          <SpriteGrid sprites={mouthSprites} allNames={mouthSpriteNames} mode="download" />
        </CardBody>
      </Card>

      {/* ── Step 4: Mouthless ── */}
      <Card>
        <CardHeader
          stepNumber={4}
          stepComplete={!!mouthlessUrl}
          title="口無し動画 生成"
          badge={mouthlessStatus}
          badgeVariant={isGeneratingMouthless ? "active" : mouthlessUrl ? "success" : "default"}
        />
        <CardBody className="grid gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Video className="size-3.5" />}
            disabled={!track || !file || isGeneratingMouthless || isRunningAll}
            loading={isGeneratingMouthless}
            onClick={onGenerateMouthless}
            className="w-full"
          >
            口無し WebM 生成
          </Button>
          {mouthlessUrl && (
            <a
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-dark)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-dark-hover)] shadow-[var(--shadow-xs)] transition-all"
              href={mouthlessUrl}
              download="mouthless.webm"
            >
              <Download className="size-3.5" />
              mouthless.webm 保存
            </a>
          )}
        </CardBody>
      </Card>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="truncate font-medium text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
