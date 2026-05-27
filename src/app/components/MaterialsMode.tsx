"use client";

import type { CSSProperties, ChangeEvent, DragEvent, RefObject } from "react";

import VideoPreview from "@/app/components/VideoPreview";
import WorkflowPanel from "@/app/components/WorkflowPanel";

import type { GeneratedSprite, MouthTrack, Quad, SpeedMode } from "@/lib/materials";

interface MaterialsModeProps {
  /* refs */
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  materialPreviewRef: RefObject<HTMLDivElement | null>;
  /* video */
  file: File | null;
  videoUrl: string;
  videoMeta: { width: number; height: number; duration: number };
  materialPreviewTab: "original" | "mouthless";
  onPreviewTabChange: (tab: "original" | "mouthless") => void;
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
  currentQuad: Quad | undefined;
  overlaySize: { width: number; height: number };
  videoFrameStyle: CSSProperties;
  /* workflow */
  status: string;
  progress: number;
  track: MouthTrack | null;
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
  onAnalysisFpsChange: (fps: number) => void;
  onSpeedModeChange: (mode: SpeedMode) => void;
  onRunFullPipeline: () => void;
  onAnalyze: () => void;
  onStopAnalysis: () => void;
  onExtractMouth: () => void;
  onGenerateMouthless: () => void;
  onLoadTrackJson: (event: ChangeEvent<HTMLInputElement>) => void;
}

export default function MaterialsMode(props: MaterialsModeProps) {
  return (
    <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] overflow-hidden max-lg:grid-cols-1 animate-fade-in">
      <VideoPreview
        videoRef={props.videoRef}
        canvasRef={props.canvasRef}
        previewRef={props.materialPreviewRef}
        videoUrl={props.videoUrl}
        mouthlessUrl={props.mouthlessUrl}
        previewTab={props.materialPreviewTab}
        onPreviewTabChange={props.onPreviewTabChange}
        currentQuad={props.currentQuad}
        overlaySize={props.overlaySize}
        videoFrameStyle={props.videoFrameStyle}
        isDragging={props.isDragging}
        onDragStateChange={props.onDragStateChange}
        onDrop={props.onDrop}
        onFileInput={props.onFileInput}
        onMetadataLoaded={props.onMetadataLoaded}
        onTimeUpdate={props.onTimeUpdate}
        onSeeked={props.onSeeked}
        onPlay={props.onPlay}
        onPause={props.onPause}
        onEnded={props.onEnded}
      />
      <WorkflowPanel
        file={props.file}
        videoMeta={props.videoMeta}
        status={props.status}
        progress={props.progress}
        track={props.track}
        downloadUrl={props.downloadUrl}
        loadedTrackName={props.loadedTrackName}
        mouthSprites={props.mouthSprites}
        mouthStatus={props.mouthStatus}
        mouthlessUrl={props.mouthlessUrl}
        mouthlessStatus={props.mouthlessStatus}
        analysisFps={props.analysisFps}
        speedMode={props.speedMode}
        isAnalyzing={props.isAnalyzing}
        isRunningAll={props.isRunningAll}
        isExtractingMouth={props.isExtractingMouth}
        isGeneratingMouthless={props.isGeneratingMouthless}
        onFileInput={props.onFileInput}
        onAnalysisFpsChange={props.onAnalysisFpsChange}
        onSpeedModeChange={props.onSpeedModeChange}
        onRunFullPipeline={props.onRunFullPipeline}
        onAnalyze={props.onAnalyze}
        onStopAnalysis={props.onStopAnalysis}
        onExtractMouth={props.onExtractMouth}
        onGenerateMouthless={props.onGenerateMouthless}
        onLoadTrackJson={props.onLoadTrackJson}
      />
    </section>
  );
}
