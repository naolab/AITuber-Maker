import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = join(repoRoot, "public", "models");
const defaultLocalSource = resolve(repoRoot, "..", "IlluMotion", "models");

const modelFiles = [
  "anime-face-yolov3-detector.onnx",
  "anime-face-yolov3-detector.onnx.data",
  "anime-face-hrnetv2-28kpt.onnx",
  "anime-face-hrnetv2-28kpt.onnx.data",
  "anime-face-hrnetv2-28kpt-batch.onnx",
  "anime-face-hrnetv2-28kpt-batch.onnx.data",
];

const baseUrl = process.env.AITUBER_MODEL_BASE_URL?.replace(/\/$/, "");
const localSource = resolve(process.env.AITUBER_MODEL_SOURCE_DIR || defaultLocalSource);

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const downloadFile = async (fileName) => {
  const url = `${baseUrl}/${fileName}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const outputPath = join(targetDir, fileName);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
};

const copyLocalFile = async (fileName) => {
  const sourcePath = join(localSource, fileName);
  if (!(await exists(sourcePath))) {
    throw new Error(`Missing local model: ${sourcePath}`);
  }
  await copyFile(sourcePath, join(targetDir, fileName));
};

await mkdir(targetDir, { recursive: true });

if (!baseUrl && !(await exists(localSource))) {
  await writeFile(join(targetDir, ".gitkeep"), "");
  throw new Error(
    [
      "Model source not found.",
      `Set AITUBER_MODEL_BASE_URL to download models, or set AITUBER_MODEL_SOURCE_DIR to a local model directory.`,
      `Default local source checked: ${localSource}`,
    ].join("\n"),
  );
}

for (const fileName of modelFiles) {
  process.stdout.write(`${baseUrl ? "Downloading" : "Copying"} ${fileName} ... `);
  if (baseUrl) {
    await downloadFile(fileName);
  } else {
    await copyLocalFile(fileName);
  }
  process.stdout.write("done\n");
}

await writeFile(join(targetDir, ".gitkeep"), "");
console.log("Model setup complete.");
