export type Mode = "materials" | "runtime" | "settings";
export type SpeedMode = "quality" | "balanced" | "fast" | "turbo";

export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export type MouthFrame = {
  index: number;
  quad: Quad;
  valid: boolean;
  confidence: number;
  source: string;
  processor?: string;
  interpolated?: boolean;
  rawValid?: boolean;
  resampled?: boolean;
  sourceFrameIndex?: number;
};

export type MouthTrack = {
  fps: number;
  width: number;
  height: number;
  detector: {
    name: string;
    runtime: string;
    backend: string;
    processor: string;
    analysisFps: number;
    speedMode: SpeedMode;
  };
  frames: MouthFrame[];
};

export type WorkerFramePayload = {
  type: "frame";
  index: number;
  frame: Omit<MouthFrame, "index">;
  backend?: string;
  backendLabel?: string;
  detectorRunCount?: number;
  detectorSkippedCount?: number;
  valid?: boolean;
  hrnetBatchSize?: number;
};

export type WorkerMessage =
  | { type: "ready"; backend: string; backendLabel: string }
  | { type: "progress"; message: string }
  | { type: "error"; message: string; index?: number }
  | { type: "reset-complete" }
  | WorkerFramePayload;

export type QuadComponent = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angle: number;
};

export type MouthSpriteName = "closed" | "half" | "open" | "e" | "u";

export type SpriteCandidate = {
  index: number;
  quad: Quad;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  confidence: number;
  features?: {
    openingRatio: number;
    innerDarkness: number;
    horizontalStretch: number;
    foregroundWidthRatio: number;
    foregroundHeightRatio: number;
  };
  scores?: Record<MouthSpriteName, number>;
};

export type GeneratedSprite = {
  name: MouthSpriteName;
  url: string;
  frameIndex: number;
  width: number;
  height: number;
};

export type MouthlessMask = {
  alpha: Float32Array;
  hard: Uint8Array;
  ring: Uint8Array;
  colorRing: Uint8Array;
};

export type LabRingStats = {
  plane: [number, number, number];
  meanA: number;
  meanB: number;
};

export type MouthlessCleanPlate = {
  width: number;
  height: number;
  cleanLabData: Float32Array;
  refStats: LabRingStats;
};

export const speedPresets: Record<SpeedMode, { label: string; fpsScale: number; detectorInterval: number }> = {
  quality: { label: "高精度", fpsScale: 1, detectorInterval: 1 },
  balanced: { label: "標準", fpsScale: 1, detectorInterval: 4 },
  fast: { label: "高速", fpsScale: 0.5, detectorInterval: 6 },
  turbo: { label: "最速", fpsScale: 0.33, detectorInterval: 10 },
};

export const modelUrls = {
  yoloModel: "/models/anime-face-yolov3-detector.onnx",
  yoloData: "/models/anime-face-yolov3-detector.onnx.data",
  hrnetModel: "/models/anime-face-hrnetv2-28kpt.onnx",
  hrnetData: "/models/anime-face-hrnetv2-28kpt.onnx.data",
  hrnetBatchModel: "/models/anime-face-hrnetv2-28kpt-batch.onnx",
  hrnetBatchData: "/models/anime-face-hrnetv2-28kpt-batch.onnx.data",
};

export const materialGenerationConfig = {
  analysis: {
    pad: 2.1,
    minWidthRatio: 0.12,
    spriteAspect: 1,
    hrnetBatchSize: 8,
  },
  mouthless: {
    quadScaleX: 1.24,
    quadScaleY: 1.34,
    maskCoverage: 0.9,
    maxReferenceFrames: 48,
  },
};

export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "00:00.0";
  const minutes = Math.floor(seconds / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
};

export const waitForEvent = <T extends Event>(target: EventTarget, eventName: string) =>
  new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, handleEvent);
      target.removeEventListener("error", handleError);
    };
    const handleEvent = (event: Event) => {
      cleanup();
      resolve(event as T);
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`${eventName} の待機中にエラーが発生しました`));
    };
    target.addEventListener(eventName, handleEvent, { once: true });
    target.addEventListener("error", handleError, { once: true });
  });

export const clampQuad = (quad: Quad, width: number, height: number): Quad =>
  quad.map(([x, y]) => [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))]) as Quad;

export const normalizeAngleDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

export const shortestAngleDiff = (from: number, to: number) => normalizeAngleDegrees(to - from);

export const decomposeQuad = (quad: Quad): QuadComponent => {
  const centerX = quad.reduce((sum, [x]) => sum + x, 0) / 4;
  const centerY = quad.reduce((sum, [, y]) => sum + y, 0) / 4;
  const topWidth = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const bottomWidth = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
  const leftHeight = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
  const rightHeight = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
  const angle = (Math.atan2(quad[1][1] - quad[0][1], quad[1][0] - quad[0][0]) * 180) / Math.PI;

  return {
    centerX,
    centerY,
    width: (topWidth + bottomWidth) / 2,
    height: (leftHeight + rightHeight) / 2,
    angle,
  };
};

export const composeQuad = ({ centerX, centerY, width, height, angle }: QuadComponent): Quad => {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => [x * cos - y * sin + centerX, x * sin + y * cos + centerY]) as Quad;
};

export const interpolateComponent = (previous: QuadComponent, next: QuadComponent, ratio: number): QuadComponent => ({
  centerX: previous.centerX + (next.centerX - previous.centerX) * ratio,
  centerY: previous.centerY + (next.centerY - previous.centerY) * ratio,
  width: previous.width + (next.width - previous.width) * ratio,
  height: previous.height + (next.height - previous.height) * ratio,
  angle: previous.angle + shortestAngleDiff(previous.angle, next.angle) * ratio,
});

export const median3 = (previous: number, current: number, next: number) =>
  [previous, current, next].sort((a, b) => a - b)[1];

export const smoothSeries = (values: number[], beta: number) => {
  const out = values.slice();
  for (let index = 1; index < out.length; index += 1) {
    out[index] = out[index - 1] + beta * (out[index] - out[index - 1]);
  }
  for (let index = out.length - 2; index >= 0; index -= 1) {
    out[index] = out[index + 1] + beta * (out[index] - out[index + 1]);
  }
  return out;
};

export const postProcessTrackFrames = (frames: MouthFrame[], fps: number, smoothCutoff = 0) => {
  if (!frames.length) return { frames, interpolatedCount: 0 };

  const valid = frames.map((frame) => Boolean(frame.valid && frame.quad));
  if (!valid.some(Boolean)) return { frames, interpolatedCount: 0 };

  const components = frames.map((frame, index) => (valid[index] ? decomposeQuad(frame.quad) : null));
  let interpolatedCount = 0;

  for (let index = 0; index < components.length; index += 1) {
    if (components[index]) continue;

    let previousIndex = index - 1;
    while (previousIndex >= 0 && !components[previousIndex]) previousIndex -= 1;
    let nextIndex = index + 1;
    while (nextIndex < components.length && !components[nextIndex]) nextIndex += 1;

    if (previousIndex >= 0 && nextIndex < components.length) {
      const ratio = (index - previousIndex) / (nextIndex - previousIndex);
      const previous = components[previousIndex];
      const next = components[nextIndex];
      if (previous && next) components[index] = interpolateComponent(previous, next, ratio);
    } else if (previousIndex >= 0) {
      const previous = components[previousIndex];
      if (previous) components[index] = { ...previous };
    } else if (nextIndex < components.length) {
      const next = components[nextIndex];
      if (next) components[index] = { ...next };
    }

    if (components[index]) interpolatedCount += 1;
  }

  if (components.some((component) => !component)) return { frames, interpolatedCount };

  const completed = components as QuadComponent[];
  for (let index = 1; index < completed.length - 1; index += 1) {
    const previous = completed[index - 1];
    const current = completed[index];
    const next = completed[index + 1];
    current.centerX = median3(previous.centerX, current.centerX, next.centerX);
    current.centerY = median3(previous.centerY, current.centerY, next.centerY);
    current.width = median3(previous.width, current.width, next.width);
    current.height = median3(previous.height, current.height, next.height);
    current.angle = current.angle + shortestAngleDiff(current.angle, median3(previous.angle, current.angle, next.angle));
  }

  const cutoff = Number(smoothCutoff) || 0;
  if (cutoff > 0) {
    const beta = 1 - Math.exp((-2 * Math.PI * cutoff) / Math.max(1, fps));
    const centerXs = smoothSeries(completed.map((component) => component.centerX), beta);
    const centerYs = smoothSeries(completed.map((component) => component.centerY), beta);
    const widths = smoothSeries(completed.map((component) => component.width), beta);
    const heights = smoothSeries(completed.map((component) => component.height), beta);
    const angles = [completed[0].angle];
    for (let index = 1; index < completed.length; index += 1) {
      angles[index] = angles[index - 1] + shortestAngleDiff(angles[index - 1], completed[index].angle);
    }
    const smoothedAngles = smoothSeries(angles, beta);

    completed.forEach((component, index) => {
      component.centerX = centerXs[index];
      component.centerY = centerYs[index];
      component.width = widths[index];
      component.height = heights[index];
      component.angle = normalizeAngleDegrees(smoothedAngles[index]);
    });
  }

  return {
    frames: frames.map((frame, index) => ({
      ...frame,
      quad: composeQuad(completed[index]),
      valid: true,
      interpolated: !valid[index],
      rawValid: valid[index],
    })),
    interpolatedCount,
  };
};

export const resampleTrackFrames = (frames: MouthFrame[], sourceFps: number, targetFps: number, duration: number) => {
  const targetCount = Math.max(1, Math.ceil((duration || 0) * targetFps));
  if (!frames.length) return { frames, interpolatedCount: 0 };
  if (sourceFps === targetFps && frames.length === targetCount) return { frames, interpolatedCount: 0 };

  const components = frames.map((frame) => decomposeQuad(frame.quad));
  const resampled: MouthFrame[] = [];
  let interpolatedCount = 0;

  for (let index = 0; index < targetCount; index += 1) {
    const sourcePosition = Math.min(frames.length - 1, (index / targetFps) * sourceFps);
    const previousIndex = Math.floor(sourcePosition);
    const nextIndex = Math.min(frames.length - 1, previousIndex + 1);
    const ratio = nextIndex === previousIndex ? 0 : sourcePosition - previousIndex;
    const component =
      ratio === 0 ? components[previousIndex] : interpolateComponent(components[previousIndex], components[nextIndex], ratio);
    const nearestIndex = ratio < 0.5 ? previousIndex : nextIndex;
    const nearest = frames[nearestIndex];
    const previousConfidence = Number(frames[previousIndex]?.confidence) || 0;
    const nextConfidence = Number(frames[nextIndex]?.confidence) || previousConfidence;
    const confidence = previousConfidence + (nextConfidence - previousConfidence) * ratio;
    const isInterpolated = ratio !== 0;

    if (isInterpolated) interpolatedCount += 1;
    resampled.push({
      ...nearest,
      index,
      quad: composeQuad(component),
      valid: true,
      confidence,
      interpolated: Boolean(nearest.interpolated || isInterpolated),
      rawValid: Boolean(nearest.rawValid && !isInterpolated),
      resampled: isInterpolated,
      sourceFrameIndex: nearestIndex,
    });
  }

  return { frames: resampled, interpolatedCount };
};

export const mouthSpriteNames: MouthSpriteName[] = ["open", "closed", "half", "e", "u"];

export const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const ensureEven = (value: number) => {
  const rounded = Math.max(2, Math.round(Number(value) || 2));
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

export const percentile = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
};

export const getQuadSize = (quad: Quad) => ({
  width: Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]),
  height: Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]),
});

export const expandQuad = (quad: Quad, scaleX = 1, scaleY = 1): Quad => {
  const centerX = quad.reduce((sum, [x]) => sum + x, 0) / 4;
  const centerY = quad.reduce((sum, [, y]) => sum + y, 0) / 4;
  return quad.map(([x, y]) => [centerX + (x - centerX) * scaleX, centerY + (y - centerY) * scaleY]) as Quad;
};

export const getTrackSpriteFrames = (track: MouthTrack): SpriteCandidate[] =>
  track.frames
    .map((frame, index) => {
      if (!frame.valid || !frame.quad) return null;
      const size = getQuadSize(frame.quad);
      if (size.width <= 1 || size.height <= 1) return null;
      return {
        index,
        quad: frame.quad,
        width: size.width,
        height: size.height,
        centerX: frame.quad.reduce((sum, [x]) => sum + x, 0) / 4,
        centerY: frame.quad.reduce((sum, [, y]) => sum + y, 0) / 4,
        confidence: Number(frame.confidence) || 0,
      };
    })
    .filter(Boolean) as SpriteCandidate[];

export const findStableMouthCluster = (frames: SpriteCandidate[], distanceThreshold = 50) => {
  if (!frames.length) return new Set<number>();
  let best = frames[0];
  let bestCount = -1;
  frames.forEach((candidate) => {
    let count = 0;
    frames.forEach((frame) => {
      if (Math.hypot(frame.centerX - candidate.centerX, frame.centerY - candidate.centerY) <= distanceThreshold) count += 1;
    });
    if (count > bestCount || (count === bestCount && candidate.confidence > best.confidence)) {
      best = candidate;
      bestCount = count;
    }
  });
  return new Set(
    frames
      .filter((frame) => Math.hypot(frame.centerX - best.centerX, frame.centerY - best.centerY) <= distanceThreshold)
      .map((frame) => frame.index),
  );
};

export const getAutoMouthCandidates = (track: MouthTrack) => {
  const allFrames = getTrackSpriteFrames(track);
  if (!allFrames.length) throw new Error("有効な mouth_track がありません");
  const stableCluster = findStableMouthCluster(allFrames);
  const candidates = allFrames.filter((frame) => stableCluster.has(frame.index));
  return candidates.length >= mouthSpriteNames.length ? candidates : allFrames;
};

export const computePngTuberAffine = (
  s0: [number, number],
  s1: [number, number],
  s2: [number, number],
  d0: [number, number],
  d1: [number, number],
  d2: [number, number],
) => {
  const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (denominator === 0) return null;

  const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / denominator;
  const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / denominator;
  const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / denominator;
  const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / denominator;
  const e =
    (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) +
      d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) +
      d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) /
    denominator;
  const f =
    (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) +
      d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) +
      d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) /
    denominator;

  return { a, b, c, d, e, f };
};

export const drawWarpTriangle = (
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  s0: [number, number],
  s1: [number, number],
  s2: [number, number],
  d0: [number, number],
  d1: [number, number],
  d2: [number, number],
) => {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.beginPath();
  context.moveTo(d0[0], d0[1]);
  context.lineTo(d1[0], d1[1]);
  context.lineTo(d2[0], d2[1]);
  context.closePath();
  context.clip();

  const matrix = computePngTuberAffine(s0, s1, s2, d0, d1, d2);
  if (matrix) {
    context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    context.drawImage(image, 0, 0);
  }
  context.restore();
};

export const drawMouthPatchToCanvas = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  quad: Quad,
  width: number,
  height: number,
) => {
  context.canvas.width = width;
  context.canvas.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;

  const [q0, q1, q2, q3] = quad;
  drawWarpTriangle(context, video, q0, q1, q2, [0, 0], [width, 0], [width, height]);
  drawWarpTriangle(context, video, q0, q2, q3, [0, 0], [width, height], [0, height]);
};

export const drawWarpedPatch = (context: CanvasRenderingContext2D, image: CanvasImageSource, quad: Quad, width: number, height: number) => {
  const [q0, q1, q2, q3] = quad;
  drawWarpTriangle(context, image, [0, 0], [width, 0], [width, height], q0, q1, q2);
  drawWarpTriangle(context, image, [0, 0], [width, height], [0, height], q0, q2, q3);
};

export const applyEllipseFeatherAlpha = (context: CanvasRenderingContext2D, width: number, height: number, featherPx = 15, maskScale = 0.85) => {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.max(1, (width * maskScale) / 2);
  const ry = Math.max(1, (height * maskScale) / 2);
  const feather = Math.max(1, featherPx);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const edgePx = (1 - distance) * Math.min(rx, ry);
      const alphaScale = Math.max(0, Math.min(1, edgePx / feather));
      data[(y * width + x) * 4 + 3] = Math.round(data[(y * width + x) * 4 + 3] * alphaScale);
    }
  }

  context.putImageData(imageData, 0, 0);
};

export const rgbToHsv = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-6) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h: h / 2, s: max === 0 ? 0 : (delta / max) * 255, v: max * 255 };
};

export const analyzeMouthPatchFeatures = (imageData: ImageData, width: number, height: number) => {
  const data = imageData.data;
  const x1 = Math.floor(width / 4);
  const x2 = Math.max(x1 + 1, width - x1);
  const y1 = Math.floor(height / 4);
  const y2 = Math.max(y1 + 1, height - y1);
  const foreground: Array<{ x: number; y: number }> = [];
  let centerVSum = 0;
  let centerCount = 0;
  let centerOpenPixels = 0;
  let centerRedPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const { h, s, v } = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
      const isRed = (h < 15 || h > 165) && s > 60;
      const isMouthPixel = v < 80 || isRed;
      if (isMouthPixel) foreground.push({ x, y });
      if (x >= x1 && x < x2 && y >= y1 && y < y2) {
        centerVSum += v;
        centerCount += 1;
        if (isMouthPixel) centerOpenPixels += 1;
        if (isRed) centerRedPixels += 1;
      }
    }
  }

  let horizontalStretch = 0;
  let foregroundWidthRatio = 0;
  let foregroundHeightRatio = 0;
  if (foreground.length) {
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    foreground.forEach((point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });
    const fgWidth = maxX - minX + 1;
    const fgHeight = Math.max(1, maxY - minY + 1);
    foregroundWidthRatio = fgWidth / Math.max(1, width);
    foregroundHeightRatio = fgHeight / Math.max(1, height);
    horizontalStretch = Math.min(fgWidth / fgHeight, 3) / 3;
  }

  return {
    innerDarkness: centerCount ? Math.max(0, Math.min(1, 1 - centerVSum / centerCount / 255)) : 0,
    openingRatio: centerCount ? Math.max(centerOpenPixels, centerRedPixels) / centerCount : 0,
    horizontalStretch: Math.max(0, Math.min(1, horizontalStretch)),
    foregroundWidthRatio: Math.max(0, Math.min(1, foregroundWidthRatio)),
    foregroundHeightRatio: Math.max(0, Math.min(1, foregroundHeightRatio)),
  };
};

export const pickBestMouthFrame = (candidates: SpriteCandidate[], scores: number[], used: Set<number>, maximize = true) => {
  const order = scores
    .map((score, candidateIndex) => ({ score, candidateIndex }))
    .sort((a, b) => (maximize ? b.score - a.score : a.score - b.score));

  const unused = order.find(({ candidateIndex }) => !used.has(candidates[candidateIndex].index));
  const picked = candidates[unused?.candidateIndex ?? order[0].candidateIndex];
  used.add(picked.index);
  return picked;
};

export const selectAutoMouthSpriteFramesByGeometry = (candidates: SpriteCandidate[]) => {
  const heights = candidates.map((frame) => frame.height);
  const widths = candidates.map((frame) => frame.width);
  const aspects = candidates.map((frame) => frame.width / Math.max(1e-6, frame.height));
  const sortedHeights = heights.slice().sort((a, b) => a - b);
  const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] || 1;
  const used = new Set<number>();

  return {
    open: pickBestMouthFrame(candidates, heights, used, true),
    closed: pickBestMouthFrame(candidates, heights, used, false),
    half: pickBestMouthFrame(
      candidates,
      heights.map((height) => -Math.abs(height - medianHeight)),
      used,
      true,
    ),
    e: pickBestMouthFrame(candidates, aspects, used, true),
    u: pickBestMouthFrame(
      candidates,
      widths.map((width, index) => -width - 0.5 * Math.abs(heights[index] - medianHeight)),
      used,
      true,
    ),
  } satisfies Record<MouthSpriteName, SpriteCandidate>;
};

export const pickBestFeatureFrame = (candidates: SpriteCandidate[], scoreName: MouthSpriteName, used: Set<number>) => {
  const sorted = candidates
    .filter((frame) => !used.has(frame.index))
    .sort((a, b) => {
      const scoreDiff = (b.scores?.[scoreName] || 0) - (a.scores?.[scoreName] || 0);
      if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
      const confidenceDiff = (b.confidence || 0) - (a.confidence || 0);
      if (Math.abs(confidenceDiff) > 1e-6) return confidenceDiff;
      return a.index - b.index;
    });
  const picked = sorted[0] || candidates.find((frame) => !used.has(frame.index)) || candidates[0];
  used.add(picked.index);
  return picked;
};

export const selectAutoMouthSpriteFramesByFeatures = (candidates: SpriteCandidate[]) => {
  if (!candidates.some((frame) => frame.features)) {
    return selectAutoMouthSpriteFramesByGeometry(candidates);
  }

  const openings = candidates.map((frame) => frame.features?.openingRatio || 0);
  const openMin = Math.min(...openings);
  const openMax = Math.max(...openings);
  const openRange = openMax - openMin;
  const foregroundWidths = candidates.map((frame) => frame.features?.foregroundWidthRatio || 0);
  const fgWidthMin = Math.min(...foregroundWidths);
  const fgWidthMax = Math.max(...foregroundWidths);
  const fgWidthRange = fgWidthMax - fgWidthMin;

  candidates.forEach((frame) => {
    const normalizedOpening =
      openRange > 0.001 ? ((frame.features?.openingRatio || 0) - openMin) / openRange : 0.5;
    const distanceFromMid = Math.abs(normalizedOpening - 0.5);
    const eOpeningScore = Math.max(0, 1 - distanceFromMid * 2.5);
    const uOpeningScore = Math.max(0, 1 - distanceFromMid * 2.5);
    const horizontalStretch = frame.features?.horizontalStretch || 0;
    const widthRatio = frame.features?.foregroundWidthRatio || 0;
    const normalizedWidth = fgWidthRange > 0.001 ? (widthRatio - fgWidthMin) / fgWidthRange : horizontalStretch;

    frame.scores = {
      open: normalizedOpening,
      closed: 1 - normalizedOpening,
      half: Math.max(0, 1 - distanceFromMid * 3),
      e: eOpeningScore * 0.55 + normalizedWidth * 0.35 + horizontalStretch * 0.1,
      u: uOpeningScore * 0.65 + (1 - normalizedWidth) * 0.35,
    };
  });

  const used = new Set<number>();
  return {
    open: pickBestFeatureFrame(candidates, "open", used),
    closed: pickBestFeatureFrame(candidates, "closed", used),
    e: pickBestFeatureFrame(candidates, "e", used),
    u: pickBestFeatureFrame(candidates, "u", used),
    half: pickBestFeatureFrame(candidates, "half", used),
  } satisfies Record<MouthSpriteName, SpriteCandidate>;
};

export const getAutoMouthNormSize = (frames: SpriteCandidate[], padding = 1.1) => {
  const widths = frames.map((frame) => frame.width);
  const heights = frames.map((frame) => frame.height);
  const ratios = frames.map((frame) => frame.width / Math.max(1, frame.height));
  const normWidth = ensureEven(Math.max(96, Math.round(percentile(widths, 0.95) * padding)));
  const medianRatio = Math.max(0.25, Math.min(4, percentile(ratios, 0.5) || 1));
  return {
    normWidth,
    normHeight: ensureEven(Math.max(64, Math.round(normWidth / medianRatio))),
    outputWidth: ensureEven(Math.max(2, Math.round(Math.max(...widths) * padding))),
    outputHeight: ensureEven(Math.max(2, Math.round(Math.max(...heights) * padding))),
  };
};

export const quantile = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
};

export const dilateBinaryMask = (mask: Uint8Array, width: number, height: number, radius: number) => {
  if (radius <= 0) return mask.slice();
  const output = new Uint8Array(mask.length);
  const r2 = radius * radius;
  const offsets: Array<[number, number]> = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index]) {
        output[index] = 1;
        continue;
      }
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (mask[ny * width + nx]) {
          output[index] = 1;
          break;
        }
      }
    }
  }
  return output;
};

export const gaussianKernel = (radius: number) => {
  if (radius <= 0) return [1];
  const sigma = 0.3 * (radius - 1) + 0.8;
  const kernel = [];
  let sum = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const value = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  return kernel.map((value) => value / sum);
};

export const featherBinaryMask = (mask: Uint8Array, width: number, height: number, dilatePx: number, featherPx: number) => {
  const dilated = dilateBinaryMask(mask, width, height, dilatePx);
  if (featherPx <= 0) return Float32Array.from(dilated);
  const kernel = gaussianKernel(featherPx);
  const temp = new Float32Array(mask.length);
  const output = new Float32Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -featherPx; k <= featherPx; k += 1) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        sum += dilated[y * width + sx] * kernel[k + featherPx];
      }
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -featherPx; k <= featherPx; k += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        sum += temp[sy * width + x] * kernel[k + featherPx];
      }
      output[y * width + x] = Math.max(0, Math.min(1, sum));
    }
  }
  return output;
};

export const createMouthlessMask = (width: number, height: number, coverage = 0.9): MouthlessMask => {
  const cov = Math.max(0, Math.min(1, Number(coverage) || 0.9));
  const maskScaleX = 0.5 + 0.18 * cov;
  const maskScaleY = 0.44 + 0.14 * cov;
  const ringPx = Math.round(16 + 10 * cov);
  const dilatePx = Math.round(8 + 8 * cov);
  const featherPx = Math.round(18 + 10 * cov);
  const rx = Math.max(1, Math.min(Math.floor(width / 2) - 1, Math.round((width * maskScaleX) / 2)));
  const ry = Math.max(1, Math.min(Math.floor(height / 2) - 1, Math.round((height * maskScaleY) / 2)));
  const cx = width / 2;
  const cy = height / 2 + Math.round(height * (0.05 + 0.01 * cov));
  const topClipY = Math.max(0, Math.min(height, Math.round(cy - ry * (0.84 - 0.06 * cov))));
  const hard = new Uint8Array(width * height);
  const ring = new Uint8Array(width * height);
  const colorRing = new Uint8Array(width * height);
  const outerRx = Math.max(1, Math.min(Math.floor(width / 2) - 1, rx + ringPx));
  const outerRy = Math.max(1, Math.min(Math.floor(height / 2) - 1, ry + ringPx));
  const colorRingBottomY = cy + ry * 0.25;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (y < topClipY) continue;
      const innerNx = (x + 0.5 - cx) / rx;
      const innerNy = (y + 0.5 - cy) / ry;
      const outerNx = (x + 0.5 - cx) / outerRx;
      const outerNy = (y + 0.5 - cy) / outerRy;
      const insideInner = innerNx * innerNx + innerNy * innerNy <= 1;
      const insideOuter = outerNx * outerNx + outerNy * outerNy <= 1;
      hard[index] = insideInner ? 1 : 0;
      ring[index] = !insideInner && insideOuter ? 1 : 0;
      colorRing[index] = ring[index] && y + 0.5 <= colorRingBottomY ? 1 : 0;
    }
  }
  return { alpha: featherBinaryMask(hard, width, height, dilatePx, featherPx), hard, ring, colorRing };
};

export const solvePlane3 = (matrix: number[][], vector: number[]): [number, number, number] | null => {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-6) return null;
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
    const div = a[col][col];
    for (let k = col; k < 4; k += 1) a[col][k] /= div;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = col; k < 4; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
};

export const fitScalarPlane = (samples: Array<{ x: number; y: number; value: number }>, fallback: number): [number, number, number] => {
  if (samples.length < 16) return [0, 0, fallback];
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const v = [0, 0, 0];
  samples.forEach((sample) => {
    const p = [sample.x, sample.y, 1];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) m[row][col] += p[row] * p[col];
      v[row] += p[row] * sample.value;
    }
  });
  return solvePlane3(m, v) || [0, 0, fallback];
};

export const evalScalarPlane = (plane: [number, number, number], x: number, y: number) => plane[0] * x + plane[1] * y + plane[2];

export const srgbToLinear = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const linearToSrgb = (value: number) => {
  const c = Math.max(0, Math.min(1, value));
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, srgb * 255)));
};

export const xyzToLabPivot = (value: number) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
export const labToXyzPivot = (value: number) => {
  const cube = value ** 3;
  return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787;
};

export const rgbToLab = (r: number, g: number, b: number) => {
  const rr = srgbToLinear(r);
  const gg = srgbToLinear(g);
  const bb = srgbToLinear(b);
  const x = (0.4124564 * rr + 0.3575761 * gg + 0.1804375 * bb) / 0.95047;
  const y = 0.2126729 * rr + 0.7151522 * gg + 0.072175 * bb;
  const z = (0.0193339 * rr + 0.119192 * gg + 0.9503041 * bb) / 1.08883;
  const fx = xyzToLabPivot(x);
  const fy = xyzToLabPivot(y);
  const fz = xyzToLabPivot(z);
  return [Math.max(0, Math.min(255, 2.55 * (116 * fy - 16))), 128 + 500 * (fx - fy), 128 + 200 * (fy - fz)];
};

export const labToRgb = (l: number, a: number, b: number) => {
  const lightness = Math.max(0, Math.min(100, l / 2.55));
  const fy = (lightness + 16) / 116;
  const fx = fy + (a - 128) / 500;
  const fz = fy - (b - 128) / 200;
  const x = 0.95047 * labToXyzPivot(fx);
  const y = labToXyzPivot(fy);
  const z = 1.08883 * labToXyzPivot(fz);
  return [
    linearToSrgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
    linearToSrgb(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
    linearToSrgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
  ];
};

export const imageDataToLabData = (imageData: ImageData, width: number, height: number) => {
  const lab = new Float32Array(width * height * 3);
  const data = imageData.data;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const labOffset = index * 3;
    const [l, a, b] = rgbToLab(data[offset], data[offset + 1], data[offset + 2]);
    lab[labOffset] = l;
    lab[labOffset + 1] = a;
    lab[labOffset + 2] = b;
  }
  return lab;
};

export const normalizedPatchCoord = (x: number, y: number, width: number, height: number): [number, number] => [
  (x - width * 0.5) / (width * 0.5),
  (y - height * 0.5) / (height * 0.5),
];

export const collectPlaneSamples = (imageData: ImageData, width: number, height: number, ringMask: Uint8Array) => {
  const data = imageData.data;
  const raw = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!ringMask[y * width + x]) continue;
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      const hsv = rgbToHsv(r, g, b);
      raw.push({ r, g, b, l, h: hsv.h, s: hsv.s });
    }
  }
  const luminances = raw.map((sample) => sample.l);
  const minLuma = Math.max(28, quantile(luminances, 0.08));
  const maxLuma = Math.min(248, quantile(luminances, 0.98));
  const samples = raw.filter((sample) => {
    const isRedMouth = sample.h < 18 || sample.h > 162;
    return sample.l >= minLuma && sample.l <= maxLuma && sample.s < 150 && !(isRedMouth && sample.s > 65);
  });
  const usable = samples.length >= 12 ? samples : raw;
  const avg = usable
    .reduce((acc, sample) => {
      acc[0] += sample.r;
      acc[1] += sample.g;
      acc[2] += sample.b;
      acc[3] += sample.l;
      return acc;
    }, [0, 0, 0, 0])
    .map((sum) => sum / Math.max(1, usable.length));
  return { avg };
};

export const inpaintCleanPatch = (source: ImageData, width: number, height: number, hardMask: Uint8Array, fallbackColor: number[]) => {
  const output = new ImageData(new Uint8ClampedArray(source.data), width, height);
  const data = output.data;
  const known = new Uint8Array(width * height);
  const nextKnown = new Uint8Array(width * height);
  const work = new Uint8ClampedArray(data);
  for (let index = 0; index < hardMask.length; index += 1) {
    known[index] = hardMask[index] ? 0 : 1;
    if (!known[index]) {
      const offset = index * 4;
      data[offset] = fallbackColor[0];
      data[offset + 1] = fallbackColor[1];
      data[offset + 2] = fallbackColor[2];
      data[offset + 3] = 255;
      work[offset] = fallbackColor[0];
      work[offset + 1] = fallbackColor[1];
      work[offset + 2] = fallbackColor[2];
      work[offset + 3] = 255;
    }
  }
  const directions = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];
  for (let pass = 0; pass < width + height; pass += 1) {
    let changed = 0;
    nextKnown.set(known);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (known[index]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        directions.forEach((dir) => {
          const n = index + dir;
          if (!known[n]) return;
          const offset = n * 4;
          r += work[offset];
          g += work[offset + 1];
          b += work[offset + 2];
          count += 1;
        });
        if (!count) continue;
        const offset = index * 4;
        data[offset] = Math.round(r / count);
        data[offset + 1] = Math.round(g / count);
        data[offset + 2] = Math.round(b / count);
        data[offset + 3] = 255;
        nextKnown[index] = 1;
        changed += 1;
      }
    }
    work.set(data);
    known.set(nextKnown);
    if (!changed) break;
  }
  return output;
};

export const collectLabRingStats = (labData: Float32Array, width: number, height: number, ringMask: Uint8Array, sourceImageData: ImageData): LabRingStats => {
  const entries = [];
  const sourceData = sourceImageData.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!ringMask[index]) continue;
      const labOffset = index * 3;
      const rgbaOffset = index * 4;
      const { h, s } = rgbToHsv(sourceData[rgbaOffset], sourceData[rgbaOffset + 1], sourceData[rgbaOffset + 2]);
      const [xn, yn] = normalizedPatchCoord(x, y, width, height);
      entries.push({ x: xn, y: yn, value: labData[labOffset], l: labData[labOffset], a: labData[labOffset + 1], b: labData[labOffset + 2], h, s });
    }
  }
  const lValues = entries.map((entry) => entry.l);
  const minL = Math.max(32, quantile(lValues, 0.18));
  const maxL = Math.min(252, quantile(lValues, 0.98));
  const filtered = entries.filter((entry) => {
    const isRedMouth = entry.h < 18 || entry.h > 162;
    return entry.l >= minL && entry.l <= maxL && entry.s < 145 && !(isRedMouth && entry.s > 65);
  });
  const samples = filtered.length >= 16 ? filtered : entries;
  const fallbackL = samples.reduce((sum, sample) => sum + sample.value, 0) / Math.max(1, samples.length);
  const aMean = samples.reduce((sum, sample) => sum + sample.a, 0) / Math.max(1, samples.length);
  const bMean = samples.reduce((sum, sample) => sum + sample.b, 0) / Math.max(1, samples.length);
  return { plane: fitScalarPlane(samples, Number.isFinite(fallbackL) ? fallbackL : 128), meanA: aMean || 128, meanB: bMean || 128 };
};

export const grayVarianceAndEdge = (imageData: ImageData, width: number, height: number, hardMask: Uint8Array) => {
  const data = imageData.data;
  const gray = new Float32Array(width * height);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const value = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    gray[index] = value;
    if (hardMask[index]) {
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }
  let edge = 0;
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!hardMask[index]) continue;
      const gx =
        -gray[index - width - 1] + gray[index - width + 1] - 2 * gray[index - 1] + 2 * gray[index + 1] - gray[index + width - 1] + gray[index + width + 1];
      const gy =
        -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1] + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1];
      edge += gx * gx + gy * gy;
      edgeCount += 1;
    }
  }
  const mean = sum / Math.max(1, count);
  const variance = sumSq / Math.max(1, count) - mean * mean;
  return variance + 0.25 * (edge / Math.max(1, edgeCount));
};

export const makeMouthlessPatchFromCleanPlate = (currentPatch: ImageData, cleanPlate: MouthlessCleanPlate, mask: MouthlessMask) => {
  const { width, height, cleanLabData, refStats } = cleanPlate;
  const currentLab = imageDataToLabData(currentPatch, width, height);
  const currentStats = collectLabRingStats(currentLab, width, height, mask.colorRing || mask.ring, currentPatch);
  const output = new ImageData(width, height);
  const data = output.data;
  const currentData = currentPatch.data;
  const deltaA = Math.max(-10, Math.min(10, currentStats.meanA - refStats.meanA));
  const deltaB = Math.max(-10, Math.min(10, currentStats.meanB - refStats.meanB));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const labOffset = index * 3;
      const rgbaOffset = index * 4;
      const [xn, yn] = normalizedPatchCoord(x, y, width, height);
      const deltaL = Math.max(-18, Math.min(18, evalScalarPlane(currentStats.plane, xn, yn) - evalScalarPlane(refStats.plane, xn, yn)));
      const [cleanR, cleanG, cleanB] = labToRgb(
        Math.min(255, Math.max(0, cleanLabData[labOffset] + deltaL)),
        Math.min(255, Math.max(0, cleanLabData[labOffset + 1] + deltaA)),
        Math.min(255, Math.max(0, cleanLabData[labOffset + 2] + deltaB)),
      );
      const repair = mask.hard[index] ? 1 : 0;
      data[rgbaOffset] = cleanR * repair + currentData[rgbaOffset] * (1 - repair);
      data[rgbaOffset + 1] = cleanG * repair + currentData[rgbaOffset + 1] * (1 - repair);
      data[rgbaOffset + 2] = cleanB * repair + currentData[rgbaOffset + 2] * (1 - repair);
      data[rgbaOffset + 3] = Math.round(mask.alpha[index] * 255);
    }
  }

  return output;
};

export const concatUint8Arrays = (parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

export const ebmlId = (hex: string) => {
  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(parseInt(hex.slice(index, index + 2), 16));
  }
  return new Uint8Array(bytes);
};

export const ebmlSize = (length: number) => {
  for (let bytes = 1; bytes <= 8; bytes += 1) {
    const max = 2 ** (7 * bytes) - 2;
    if (length <= max) {
      const output = new Uint8Array(bytes);
      let value = length;
      for (let index = bytes - 1; index >= 0; index -= 1) {
        output[index] = value & 0xff;
        value = Math.floor(value / 256);
      }
      output[0] |= 1 << (8 - bytes);
      return output;
    }
  }
  throw new Error("WebMデータが大きすぎます");
};

export const ebmlUnsigned = (value: number) => {
  let bytes = 1;
  while (value >= 2 ** (8 * bytes) && bytes < 8) bytes += 1;
  const output = new Uint8Array(bytes);
  let current = value;
  for (let index = bytes - 1; index >= 0; index -= 1) {
    output[index] = current & 0xff;
    current = Math.floor(current / 256);
  }
  return output;
};

export const ebmlFloat64 = (value: number) => {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setFloat64(0, value);
  return output;
};

export const ebmlText = (value: string) => new TextEncoder().encode(value);

export const ebmlElement = (idHex: string, data: Uint8Array) => concatUint8Arrays([ebmlId(idHex), ebmlSize(data.length), data]);

export const ebmlMaster = (idHex: string, children: Uint8Array[]) => ebmlElement(idHex, concatUint8Arrays(children));

export const createSimpleBlock = (frame: Uint8Array, relativeTimecode: number) => {
  const header = new Uint8Array(4);
  header[0] = 0x81;
  new DataView(header.buffer).setInt16(1, relativeTimecode);
  header[3] = 0x80;
  return ebmlElement("A3", concatUint8Arrays([header, frame]));
};

export const extractVp8FromWebP = (bytes: Uint8Array) => {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") {
    throw new Error("WebP変換に失敗しました");
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = text(offset, 4);
    const chunkSize = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (chunkType === "VP8 ") return bytes.slice(dataStart, dataEnd);
    offset = dataEnd + (chunkSize % 2);
  }

  throw new Error("このブラウザのWebP形式をWebM化できません");
};

export const canvasToVp8Frame = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("フレームのWebP化に失敗しました"));
    }, "image/webp", 0.92);
  });
  return extractVp8FromWebP(new Uint8Array(await blob.arrayBuffer()));
};

export const createVp8WebM = ({
  frames,
  width,
  height,
  fps,
  durationMs,
}: {
  frames: Uint8Array[];
  width: number;
  height: number;
  fps: number;
  durationMs: number;
}) => {
  const info = ebmlMaster("1549A966", [
    ebmlElement("2AD7B1", ebmlUnsigned(1_000_000)),
    ebmlElement("4D80", ebmlText("AITuber Maker")),
    ebmlElement("5741", ebmlText("AITuber Maker")),
    ebmlElement("4489", ebmlFloat64(durationMs)),
  ]);
  const tracks = ebmlMaster("1654AE6B", [
    ebmlMaster("AE", [
      ebmlElement("D7", ebmlUnsigned(1)),
      ebmlElement("73C5", ebmlUnsigned(1)),
      ebmlElement("83", ebmlUnsigned(1)),
      ebmlElement("86", ebmlText("V_VP8")),
      ebmlMaster("E0", [ebmlElement("B0", ebmlUnsigned(width)), ebmlElement("BA", ebmlUnsigned(height))]),
    ]),
  ]);
  const frameDuration = 1000 / fps;
  const clusters: Uint8Array[] = [];
  let clusterTimecode = 0;
  let clusterBlocks: Uint8Array[] = [];

  frames.forEach((frame, index) => {
    const timestamp = Math.round(index * frameDuration);
    const nextClusterTimecode = Math.floor(timestamp / 30000) * 30000;
    if (clusterBlocks.length && nextClusterTimecode !== clusterTimecode) {
      clusters.push(ebmlMaster("1F43B675", [ebmlElement("E7", ebmlUnsigned(clusterTimecode)), ...clusterBlocks]));
      clusterBlocks = [];
      clusterTimecode = nextClusterTimecode;
    }
    clusterBlocks.push(createSimpleBlock(frame, timestamp - clusterTimecode));
  });

  if (clusterBlocks.length) {
    clusters.push(ebmlMaster("1F43B675", [ebmlElement("E7", ebmlUnsigned(clusterTimecode)), ...clusterBlocks]));
  }

  const header = ebmlMaster("1A45DFA3", [
    ebmlElement("4286", ebmlUnsigned(1)),
    ebmlElement("42F7", ebmlUnsigned(1)),
    ebmlElement("42F2", ebmlUnsigned(4)),
    ebmlElement("42F3", ebmlUnsigned(8)),
    ebmlElement("4282", ebmlText("webm")),
    ebmlElement("4287", ebmlUnsigned(2)),
    ebmlElement("4285", ebmlUnsigned(2)),
  ]);
  const segment = ebmlMaster("18538067", [info, tracks, ...clusters]);
  return new Blob([header, segment], { type: "video/webm" });
};
