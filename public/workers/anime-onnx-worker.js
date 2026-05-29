const ORT_VERSION = "1.23.2";
const ORT_WASM_MODULE_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/+esm`;
const ORT_WEBGPU_MODULE_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/webgpu/+esm`;
const ORT_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const ANIME_YOLO_SIZE = 608;
const ANIME_HRNET_SIZE = 256;
const ANIME_YOLO_ANCHORS = [
  [
    [116, 90],
    [156, 198],
    [373, 326],
  ],
  [
    [30, 61],
    [62, 45],
    [59, 119],
  ],
  [
    [10, 13],
    [16, 30],
    [33, 23],
  ],
];
const ANIME_YOLO_STRIDES = [32, 16, 8];
const ANIME_MOUTH_OUTLINE = [24, 25, 26, 27];
const DEFAULT_HRNET_BATCH_SIZE = 4;

let ort = null;
let detector = null;
let landmark = null;
let backend = "wasm";
let backendLabel = "WASM";
let previousBox = null;
let previousQuad = null;
let forceDetector = false;
let detectorRunCount = 0;
let detectorSkippedCount = 0;
let hrnetBatchSize = 1;
const perfTotals = {
  yoloPrepMs: 0,
  yoloRunMs: 0,
  yoloDecodeMs: 0,
  hrnetPrepMs: 0,
  hrnetRunMs: 0,
  hrnetDecodeMs: 0,
  frames: 0,
};
let yoloInputBuffer = new Float32Array(3 * ANIME_YOLO_SIZE * ANIME_YOLO_SIZE);
let hrnetInputBuffer = new Float32Array(3 * ANIME_HRNET_SIZE * ANIME_HRNET_SIZE);
let yoloCanvas = null;
let yoloContext = null;
let hrnetCanvas = null;
let hrnetContext = null;
let pendingHrnetTasks = [];
let hrnetFlushTimer = 0;
let isFlushingHrnet = false;

const backendName = (name) => (name === "webgpu" ? "WebGPU" : "WASM");

const resetAnalysisState = () => {
  previousBox = null;
  previousQuad = null;
  forceDetector = false;
  detectorRunCount = 0;
  detectorSkippedCount = 0;
  pendingHrnetTasks = [];
  if (hrnetFlushTimer) {
    clearTimeout(hrnetFlushTimer);
    hrnetFlushTimer = 0;
  }
  isFlushingHrnet = false;
  Object.keys(perfTotals).forEach((key) => {
    perfTotals[key] = 0;
  });
};

const sigmoid = (value) => 1 / (1 + Math.exp(-value));

const averagePoint = (points) => {
  if (!points.length) return null;
  const sum = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
};

const intersectionOverUnion = (a, b) => {
  const left = Math.max(a.x1, b.x1);
  const top = Math.max(a.y1, b.y1);
  const right = Math.min(a.x2, b.x2);
  const bottom = Math.min(a.y2, b.y2);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const intersection = width * height;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return intersection / Math.max(1e-6, areaA + areaB - intersection);
};

const nonMaxSuppression = (boxes, threshold = 0.45, limit = 20) => {
  const sorted = boxes.slice().sort((a, b) => b.score - a.score);
  const selected = [];

  for (const box of sorted) {
    if (selected.every((current) => intersectionOverUnion(current, box) < threshold)) {
      selected.push(box);
      if (selected.length >= limit) break;
    }
  }

  return selected;
};

const fetchBinary = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} の読み込みに失敗しました: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const loadRuntime = async (targetBackend) => {
  const moduleUrl = targetBackend === "webgpu" ? ORT_WEBGPU_MODULE_URL : ORT_WASM_MODULE_URL;
  const runtime = await import(moduleUrl);
  runtime.env.wasm.wasmPaths = ORT_WASM_PATH;
  return runtime;
};

const createSessions = async (targetBackend, modelUrls, requestedHrnetBatchSize = DEFAULT_HRNET_BATCH_SIZE) => {
  if (targetBackend === "webgpu" && !navigator.gpu) {
    throw new Error("このWorkerではWebGPUが使えません");
  }

  self.postMessage({ type: "progress", message: `Worker ${backendName(targetBackend)} 読込中` });
  const runtime = await loadRuntime(targetBackend);
  const [yoloModel, yoloData, hrnetLoadResult] = await Promise.all([
    fetchBinary(modelUrls.yoloModel),
    fetchBinary(modelUrls.yoloData),
    Promise.all([
      fetchBinary(modelUrls.hrnetBatchModel),
      fetchBinary(modelUrls.hrnetBatchData),
    ])
      .then(([model, data]) => ({
        model,
        data,
        dataPath: "anime-face-hrnetv2-28kpt-batch.onnx.data",
        batchSize: Math.max(1, Math.min(16, Math.round(Number(requestedHrnetBatchSize) || DEFAULT_HRNET_BATCH_SIZE))),
      }))
      .catch(() =>
        Promise.all([
          fetchBinary(modelUrls.hrnetModel),
          fetchBinary(modelUrls.hrnetData),
        ]).then(([model, data]) => ({ model, data, dataPath: "anime-face-hrnetv2-28kpt.onnx.data", batchSize: 1 })),
      ),
  ]);
  hrnetBatchSize = hrnetLoadResult.batchSize;
  const sessionOptions = {
    executionProviders: [targetBackend],
    graphOptimizationLevel: "all",
  };

  self.postMessage({ type: "progress", message: `Worker YOLO初期化中 (${backendName(targetBackend)})` });
  const yoloSession = await runtime.InferenceSession.create(yoloModel, {
    ...sessionOptions,
    externalData: [{ path: "anime-face-yolov3-detector.onnx.data", data: yoloData }],
  });
  self.postMessage({ type: "progress", message: `Worker HRNet初期化中 (${backendName(targetBackend)})` });
  const hrnetSession = await runtime.InferenceSession.create(hrnetLoadResult.model, {
    ...sessionOptions,
    externalData: [{ path: hrnetLoadResult.dataPath, data: hrnetLoadResult.data }],
  });

  return { runtime, yoloSession, hrnetSession };
};

const init = async (config) => {
  const candidates = config.backendCandidates || ["wasm"];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const sessions = await createSessions(candidate, config.modelUrls, config.hrnetBatchSize);
      ort = sessions.runtime;
      detector = sessions.yoloSession;
      landmark = sessions.hrnetSession;
      backend = candidate;
      backendLabel = backendName(candidate);
      yoloCanvas = new OffscreenCanvas(ANIME_YOLO_SIZE, ANIME_YOLO_SIZE);
      yoloContext = yoloCanvas.getContext("2d", { alpha: false });
      hrnetCanvas = new OffscreenCanvas(ANIME_HRNET_SIZE, ANIME_HRNET_SIZE);
      hrnetContext = hrnetCanvas.getContext("2d", { alpha: false });
      self.postMessage({ type: "ready", backend, backendLabel });
      return;
    } catch (error) {
      lastError = error;
      self.postMessage({
        type: "progress",
        message: `Worker ${backendName(candidate)}失敗${candidates.length > 1 ? "、切替中" : ""}`,
      });
    }
  }

  throw lastError || new Error("Worker ONNX初期化に失敗しました");
};

const prepareYoloInput = (source, width, height) => {
  yoloContext.setTransform(1, 0, 0, 1, 0, 0);
  yoloContext.fillStyle = "#000";
  yoloContext.fillRect(0, 0, ANIME_YOLO_SIZE, ANIME_YOLO_SIZE);
  const scale = Math.min(ANIME_YOLO_SIZE / width, ANIME_YOLO_SIZE / height);
  const drawWidth = Math.round(width * scale);
  const drawHeight = Math.round(height * scale);
  yoloContext.drawImage(source, 0, 0, width, height, 0, 0, drawWidth, drawHeight);
  const imageData = yoloContext.getImageData(0, 0, ANIME_YOLO_SIZE, ANIME_YOLO_SIZE).data;
  const plane = ANIME_YOLO_SIZE * ANIME_YOLO_SIZE;

  for (let i = 0, p = 0; i < imageData.length; i += 4, p += 1) {
    yoloInputBuffer[p] = imageData[i] / 255;
    yoloInputBuffer[plane + p] = imageData[i + 1] / 255;
    yoloInputBuffer[plane * 2 + p] = imageData[i + 2] / 255;
  }

  return { tensor: yoloInputBuffer, scale };
};

const decodeYoloOutput = (outputs, scale, videoWidth, videoHeight) => {
  const boxes = [];
  const tensors = [
    outputs.scale_32 || outputs[0],
    outputs.scale_16 || outputs[1],
    outputs.scale_8 || outputs[2],
  ];

  tensors.forEach((tensor, scaleIndex) => {
    const data = tensor.data;
    const [, , gridHeight, gridWidth] = tensor.dims;
    const stride = ANIME_YOLO_STRIDES[scaleIndex];
    const anchors = ANIME_YOLO_ANCHORS[scaleIndex];

    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
          const channel = anchorIndex * 6;
          const read = (offset) => data[((channel + offset) * gridHeight + y) * gridWidth + x];
          const tx = read(0);
          const ty = read(1);
          const tw = Math.max(-10, Math.min(10, read(2)));
          const th = Math.max(-10, Math.min(10, read(3)));
          const score = sigmoid(read(4)) * sigmoid(read(5));
          if (score < 0.12) continue;

          const [anchorWidth, anchorHeight] = anchors[anchorIndex];
          const centerX = (sigmoid(tx) + x) * stride;
          const centerY = (sigmoid(ty) + y) * stride;
          const boxWidth = Math.exp(tw) * anchorWidth;
          const boxHeight = Math.exp(th) * anchorHeight;
          const x1 = Math.max(0, Math.min(videoWidth, (centerX - boxWidth / 2) / scale));
          const y1 = Math.max(0, Math.min(videoHeight, (centerY - boxHeight / 2) / scale));
          const x2 = Math.max(0, Math.min(videoWidth, (centerX + boxWidth / 2) / scale));
          const y2 = Math.max(0, Math.min(videoHeight, (centerY + boxHeight / 2) / scale));
          if (x2 - x1 < 8 || y2 - y1 < 8) continue;
          boxes.push({ x1, y1, x2, y2, score });
        }
      }
    }
  });

  return nonMaxSuppression(boxes, 0.45, 10);
};

const selectFaceBox = (boxes) => {
  if (!boxes.length) return null;
  if (!previousBox) return boxes[0];
  const previousCenterX = (previousBox.x1 + previousBox.x2) / 2;
  const previousCenterY = (previousBox.y1 + previousBox.y2) / 2;
  const previousWidth = Math.max(1, previousBox.x2 - previousBox.x1);

  return boxes
    .map((box) => {
      const centerX = (box.x1 + box.x2) / 2;
      const centerY = (box.y1 + box.y2) / 2;
      const distancePenalty = Math.hypot(centerX - previousCenterX, centerY - previousCenterY) / previousWidth;
      return { box, rank: box.score - distancePenalty * 0.25 };
    })
    .sort((a, b) => b.rank - a.rank)[0].box;
};

const expandBoxToSquare = (box, videoWidth, videoHeight, scale = 1.25) => {
  const centerX = (box.x1 + box.x2) / 2;
  const centerY = (box.y1 + box.y2) / 2;
  const side = Math.max(box.x2 - box.x1, box.y2 - box.y1) * scale;
  const half = side / 2;
  return {
    x: Math.max(0, centerX - half),
    y: Math.max(0, centerY - half),
    width: Math.min(videoWidth, centerX + half) - Math.max(0, centerX - half),
    height: Math.min(videoHeight, centerY + half) - Math.max(0, centerY - half),
  };
};

const prepareHrnetInput = (source, crop) => {
  hrnetContext.setTransform(1, 0, 0, 1, 0, 0);
  hrnetContext.fillStyle = "#000";
  hrnetContext.fillRect(0, 0, ANIME_HRNET_SIZE, ANIME_HRNET_SIZE);
  hrnetContext.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, ANIME_HRNET_SIZE, ANIME_HRNET_SIZE);
  const imageData = hrnetContext.getImageData(0, 0, ANIME_HRNET_SIZE, ANIME_HRNET_SIZE).data;
  const plane = ANIME_HRNET_SIZE * ANIME_HRNET_SIZE;
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let i = 0, p = 0; i < imageData.length; i += 4, p += 1) {
    hrnetInputBuffer[p] = (imageData[i] / 255 - mean[0]) / std[0];
    hrnetInputBuffer[plane + p] = (imageData[i + 1] / 255 - mean[1]) / std[1];
    hrnetInputBuffer[plane * 2 + p] = (imageData[i + 2] / 255 - mean[2]) / std[2];
  }

  return hrnetInputBuffer;
};

const decodeHrnetLandmarks = (heatmaps, crop, batchIndex = 0) => {
  const data = heatmaps.data;
  const [, joints, heatmapHeight, heatmapWidth] = heatmaps.dims;
  const landmarks = [];

  for (let joint = 0; joint < joints; joint += 1) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    const offset = (batchIndex * joints + joint) * heatmapHeight * heatmapWidth;
    for (let i = 0; i < heatmapHeight * heatmapWidth; i += 1) {
      const value = data[offset + i];
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const hx = bestIndex % heatmapWidth;
    const hy = Math.floor(bestIndex / heatmapWidth);
    landmarks.push({
      x: crop.x + ((hx + 0.5) / heatmapWidth) * crop.width,
      y: crop.y + ((hy + 0.5) / heatmapHeight) * crop.height,
      confidence: sigmoid(bestValue),
    });
  }

  return landmarks;
};

const getMouthQuad = (landmarks, faceBox, options = {}) => {
  const mouthPoints = ANIME_MOUTH_OUTLINE.map((index) => landmarks[index]).filter(Boolean);
  if (mouthPoints.length !== ANIME_MOUTH_OUTLINE.length) return null;

  const center = averagePoint(mouthPoints);
  const leftEye = averagePoint(landmarks.slice(11, 17));
  const rightEye = averagePoint(landmarks.slice(17, 23));
  const angle = leftEye && rightEye ? Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localPoints = mouthPoints.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: dx * cos + dy * sin,
      y: -dx * sin + dy * cos,
    };
  });
  const xs = localPoints.map((point) => point.x);
  const ys = localPoints.map((point) => point.y);
  const mouthWidth = Math.max(...xs) - Math.min(...xs);
  const mouthHeight = Math.max(...ys) - Math.min(...ys);
  const faceWidth = Math.max(1, faceBox.x2 - faceBox.x1);
  const minWidth = Math.max(12, faceWidth * (Number(options.minWidthRatio) || 0.12));
  const spriteAspect = Math.max(0.25, Math.min(4, Number(options.spriteAspect) || 1));
  const pad = Math.max(1.1, Math.min(4, Number(options.pad) || 2.1));
  const quadWidth = Math.max(mouthWidth, minWidth) * pad;
  const quadHeight = Math.max(mouthHeight * pad, quadWidth / spriteAspect);
  const halfWidth = quadWidth / 2;
  const halfHeight = quadHeight / 2;
  const quad = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([x, y]) => [x * cos - y * sin + center.x, x * sin + y * cos + center.y]);
  const confidence =
    mouthPoints.reduce((sum, point) => sum + Math.max(0, Math.min(1, point.confidence || 0)), 0) /
    mouthPoints.length;

  return { quad, confidence };
};

const flushHrnetBatch = async () => {
  if (isFlushingHrnet || !pendingHrnetTasks.length) return;
  isFlushingHrnet = true;
  if (hrnetFlushTimer) {
    clearTimeout(hrnetFlushTimer);
    hrnetFlushTimer = 0;
  }

  const tasks = pendingHrnetTasks.splice(0, hrnetBatchSize);
  try {
    const singleSize = 3 * ANIME_HRNET_SIZE * ANIME_HRNET_SIZE;
    const batchInput = new Float32Array(tasks.length * singleSize);
    tasks.forEach((task, index) => {
      batchInput.set(task.input, index * singleSize);
    });

    const hrnetTensor = new ort.Tensor("float32", batchInput, [
      tasks.length,
      3,
      ANIME_HRNET_SIZE,
      ANIME_HRNET_SIZE,
    ]);
    const hrnetRunStart = performance.now();
    const hrnetOutputs = await landmark.run({ image: hrnetTensor });
    perfTotals.hrnetRunMs += performance.now() - hrnetRunStart;
    const heatmaps = hrnetOutputs.heatmaps || Object.values(hrnetOutputs)[0];

    tasks.forEach((task, index) => {
      const hrnetDecodeStart = performance.now();
      const landmarks = decodeHrnetLandmarks(heatmaps, task.crop, index);
      const mouth = getMouthQuad(landmarks, task.faceBox, task.options);
      perfTotals.hrnetDecodeMs += performance.now() - hrnetDecodeStart;
      task.resolve(mouth);
    });
  } catch (error) {
    tasks.forEach((task) => task.reject(error));
  } finally {
    isFlushingHrnet = false;
    if (pendingHrnetTasks.length >= hrnetBatchSize) {
      flushHrnetBatch();
    } else if (pendingHrnetTasks.length) {
      hrnetFlushTimer = setTimeout(() => {
        hrnetFlushTimer = 0;
        flushHrnetBatch();
      }, 0);
    }
  }
};

const runHrnetBatched = (input, crop, faceBox, options) =>
  new Promise((resolve, reject) => {
    pendingHrnetTasks.push({ input, crop, faceBox, options, resolve, reject });
    if (pendingHrnetTasks.length >= hrnetBatchSize) {
      flushHrnetBatch();
    } else if (!hrnetFlushTimer) {
      hrnetFlushTimer = setTimeout(() => {
        hrnetFlushTimer = 0;
        flushHrnetBatch();
      }, 0);
    }
  });

const processFrame = async ({ index, bitmap, width, height, options, detectorInterval }) => {
  const shouldRunDetector = forceDetector || !previousBox || index % detectorInterval === 0;
  let faceBox = previousBox;

  try {
    if (shouldRunDetector) {
      const yoloPrepStart = performance.now();
      const yoloInput = prepareYoloInput(bitmap, width, height);
      perfTotals.yoloPrepMs += performance.now() - yoloPrepStart;
      const yoloTensor = new ort.Tensor("float32", yoloInput.tensor, [1, 3, ANIME_YOLO_SIZE, ANIME_YOLO_SIZE]);
      const yoloRunStart = performance.now();
      const yoloOutputs = await detector.run({ image: yoloTensor });
      perfTotals.yoloRunMs += performance.now() - yoloRunStart;
      const yoloDecodeStart = performance.now();
      const boxes = decodeYoloOutput(yoloOutputs, yoloInput.scale, width, height);
      faceBox = selectFaceBox(boxes);
      perfTotals.yoloDecodeMs += performance.now() - yoloDecodeStart;
      detectorRunCount += 1;
    } else {
      detectorSkippedCount += 1;
    }

    let mouth = null;
    if (faceBox) {
      previousBox = faceBox;
      const cropScale = shouldRunDetector ? 1.25 : 1.45;
      const crop = expandBoxToSquare(faceBox, width, height, cropScale);
      const hrnetPrepStart = performance.now();
      const hrnetInput = new Float32Array(prepareHrnetInput(bitmap, crop));
      perfTotals.hrnetPrepMs += performance.now() - hrnetPrepStart;
      mouth = await runHrnetBatched(hrnetInput, crop, faceBox, options);
      forceDetector = !mouth || mouth.confidence < 0.18;
    } else {
      forceDetector = true;
    }

    const frame = mouth
      ? {
          quad: mouth.quad,
          valid: true,
          confidence: mouth.confidence,
          source: "anime-onnx",
          processor: "worker",
        }
      : {
          quad: previousQuad || [
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

    if (mouth) previousQuad = mouth.quad;
    perfTotals.frames += 1;
    self.postMessage({
      type: "frame",
      index,
      frame,
      backend,
      backendLabel,
      detectorRunCount,
      detectorSkippedCount,
      valid: Boolean(mouth),
      hrnetBatchSize,
      perfTotals,
    });
  } finally {
    bitmap.close();
  }
};

const detectFrame = async ({ index, bitmap, width, height }) => {
  try {
    const yoloPrepStart = performance.now();
    const yoloInput = prepareYoloInput(bitmap, width, height);
    perfTotals.yoloPrepMs += performance.now() - yoloPrepStart;
    const yoloTensor = new ort.Tensor("float32", yoloInput.tensor, [1, 3, ANIME_YOLO_SIZE, ANIME_YOLO_SIZE]);
    const yoloRunStart = performance.now();
    const yoloOutputs = await detector.run({ image: yoloTensor });
    perfTotals.yoloRunMs += performance.now() - yoloRunStart;
    const yoloDecodeStart = performance.now();
    const boxes = decodeYoloOutput(yoloOutputs, yoloInput.scale, width, height);
    const faceBox = selectFaceBox(boxes);
    perfTotals.yoloDecodeMs += performance.now() - yoloDecodeStart;
    detectorRunCount += 1;
    if (faceBox) previousBox = faceBox;

    self.postMessage({
      type: "detect-frame",
      index,
      faceBox,
      backend,
      backendLabel,
      detectorRunCount,
      detectorSkippedCount,
      hrnetBatchSize,
      perfTotals,
    });
  } finally {
    bitmap.close();
  }
};

const processHrnetFrame = async ({ index, bitmap, width, height, options, faceBox }) => {
  try {
    let mouth = null;
    if (faceBox) {
      const crop = expandBoxToSquare(faceBox, width, height, 1.35);
      const hrnetPrepStart = performance.now();
      const hrnetInput = new Float32Array(prepareHrnetInput(bitmap, crop));
      perfTotals.hrnetPrepMs += performance.now() - hrnetPrepStart;
      mouth = await runHrnetBatched(hrnetInput, crop, faceBox, options);
    }

    const frame = mouth
      ? {
          quad: mouth.quad,
          valid: true,
          confidence: mouth.confidence,
          source: "anime-onnx",
          processor: "worker-two-pass",
        }
      : {
          quad: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          valid: false,
          confidence: 0,
          source: "anime-onnx",
          processor: "worker-two-pass",
        };

    perfTotals.frames += 1;
    self.postMessage({
      type: "hrnet-frame",
      index,
      frame,
      backend,
      backendLabel,
      detectorRunCount,
      detectorSkippedCount,
      valid: Boolean(mouth),
      hrnetBatchSize,
      perfTotals,
    });
  } finally {
    bitmap.close();
  }
};

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    init(message.config).catch((error) => {
      self.postMessage({ type: "error", message: error?.message || String(error) });
    });
    return;
  }

  if (message.type === "reset") {
    resetAnalysisState();
    self.postMessage({ type: "reset-complete" });
    return;
  }

  if (message.type === "frame") {
    processFrame(message).catch((error) => {
      message.bitmap?.close?.();
      self.postMessage({ type: "error", message: error?.message || String(error), index: message.index });
    });
    return;
  }

  if (message.type === "detect-frame") {
    detectFrame(message).catch((error) => {
      message.bitmap?.close?.();
      self.postMessage({ type: "error", message: error?.message || String(error), index: message.index });
    });
    return;
  }

  if (message.type === "hrnet-frame") {
    processHrnetFrame(message).catch((error) => {
      message.bitmap?.close?.();
      self.postMessage({ type: "error", message: error?.message || String(error), index: message.index });
    });
  }
});
