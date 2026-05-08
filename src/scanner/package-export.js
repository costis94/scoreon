import { els, state, t } from "./shared.js";
import { canvasToBlob, getSettings } from "./processing.js";
import { buildPdf } from "./pdf-export.js";
import { normalizeWhitespace, sanitizeFilename } from "./text.js";

function padIndex(index) {
  return String(index + 1).padStart(3, "0");
}

function safePathPart(text, fallback = "item") {
  const cleaned = sanitizeFilename(text || fallback)
    .replace(/[.]+$/g, "")
    .replace(/^[-_\s.]+/g, "")
    .trim();
  return cleaned || fallback;
}

function getFrameBaseName(frame, index) {
  const label = safePathPart(frame.label || "", "");
  return label ? `${padIndex(index)}-${label}` : padIndex(index);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function textBytes(text) {
  return new TextEncoder().encode(text);
}

async function blobToUint8Array(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("errorLoadImage")));
    };
    img.src = url;
  });
}

async function frameToPngBlob(frame) {
  if (frame.pngBlob) return frame.pngBlob;

  const img = await loadImageFromBlob(frame.blob);
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, "image/png");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resizeForOmr(width, height) {
  const minTargetWidth = 1400;
  const maxTargetWidth = 2200;
  const desiredWidth = width < minTargetWidth ? minTargetWidth : width;
  const targetWidth = clamp(desiredWidth, width, maxTargetWidth);
  const scale = Math.min(1.35, targetWidth / width);
  return {
    width: Math.max(width, Math.round(width * scale)),
    height: Math.max(height, Math.round(height * scale))
  };
}

function collectGrayscaleData(imageData) {
  const { data, width, height } = imageData;
  const grays = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grays[p] = gray;
    histogram[gray]++;
  }

  return { grays, histogram };
}

function otsuThresholdFromHistogram(histogram, totalPixels) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = -1;
  let threshold = 160;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;

    const wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return Math.max(90, Math.min(220, threshold));
}

function percentileFromHistogram(histogram, totalPixels, percentile) {
  const target = totalPixels * percentile;
  let cumulative = 0;

  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i];
    if (cumulative >= target) return i;
  }

  return histogram.length - 1;
}

function normalizeGrays(grays, histogram) {
  const totalPixels = grays.length;
  const low = percentileFromHistogram(histogram, totalPixels, 0.01);
  const high = percentileFromHistogram(histogram, totalPixels, 0.995);
  const normalized = new Uint8Array(totalPixels);

  if (high <= low + 8) {
    normalized.set(grays);
    return normalized;
  }

  const scale = 255 / (high - low);
  for (let i = 0; i < grays.length; i++) {
    normalized[i] = clamp(Math.round((grays[i] - low) * scale), 0, 255);
  }

  return normalized;
}

function buildIntegralImage(grays, width, height) {
  const integral = new Uint32Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      rowSum += grays[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  return integral;
}

function getIntegralMean(integral, width, x1, y1, x2, y2) {
  const stride = width + 1;
  const sum =
    integral[(y2 + 1) * stride + (x2 + 1)] -
    integral[y1 * stride + (x2 + 1)] -
    integral[(y2 + 1) * stride + x1] +
    integral[y1 * stride + x1];
  const area = (x2 - x1 + 1) * (y2 - y1 + 1);
  return sum / area;
}

function adaptiveBinarize(grays, width, height) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < grays.length; i++) histogram[grays[i]]++;

  const globalThreshold = otsuThresholdFromHistogram(histogram, grays.length);
  const integral = buildIntegralImage(grays, width, height);
  const radius = clamp(Math.round(Math.min(width, height) / 28), 12, 32);
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const mean = getIntegralMean(integral, width, x1, y1, x2, y2);
      const localThreshold = Math.max(32, Math.min(globalThreshold - 12, mean - 16));
      out[y * width + x] = grays[y * width + x] <= localThreshold ? 1 : 0;
    }
  }

  return out;
}

function countDarkNeighbors(binary, width, x, y) {
  let count = 0;

  for (let yy = y - 1; yy <= y + 1; yy++) {
    for (let xx = x - 1; xx <= x + 1; xx++) {
      if (xx === x && yy === y) continue;
      if (xx < 0 || yy < 0 || xx >= width) continue;
      const index = yy * width + xx;
      if (index < 0 || index >= binary.length) continue;
      count += binary[index];
    }
  }

  return count;
}

function despeckle(binary, width, height) {
  const out = binary.slice();

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const neighbors = countDarkNeighbors(binary, width, x, y);

      if (binary[index] && neighbors <= 1) {
        out[index] = 0;
      }
    }
  }

  return out;
}

function applyBinaryToImageData(binary, imageData) {
  const { data } = imageData;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const out = binary[p] ? 0 : 255;
    data[i] = out;
    data[i + 1] = out;
    data[i + 2] = out;
    data[i + 3] = 255;
  }
}

async function createOmrReadyPngBlob(frame) {
  const sourceBlob = await frameToPngBlob(frame);
  const img = await loadImageFromBlob(sourceBlob);
  const targetSize = resizeForOmr(frame.width, frame.height);
  const canvas = document.createElement("canvas");
  canvas.width = targetSize.width;
  canvas.height = targetSize.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { grays, histogram } = collectGrayscaleData(imageData);
  const normalized = normalizeGrays(grays, histogram);
  let binary = adaptiveBinarize(normalized, canvas.width, canvas.height);
  binary = despeckle(binary, canvas.width, canvas.height);
  applyBinaryToImageData(binary, imageData);
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, "image/png");
}

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

async function entryDataToBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof Blob) return blobToUint8Array(data);
  return textBytes(String(data));
}

async function createZipBlob(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = getDosDateTime();

  for (const entry of entries) {
    const nameBytes = textBytes(entry.path.replace(/\\/g, "/"));
    const dataBytes = await entryDataToBytes(entry.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const flags = 0x0800;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, flags);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, dosTime);
    writeU16(localView, 12, dosDate);
    writeU32(localView, 14, crc);
    writeU32(localView, 18, size);
    writeU32(localView, 22, size);
    writeU16(localView, 26, nameBytes.length);
    writeU16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, flags);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, dosTime);
    writeU16(centralView, 14, dosDate);
    writeU32(centralView, 16, crc);
    writeU32(centralView, 20, size);
    writeU32(centralView, 24, size);
    writeU16(centralView, 28, nameBytes.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, 0x06054b50);
  writeU16(eocdView, 4, 0);
  writeU16(eocdView, 6, 0);
  writeU16(eocdView, 8, entries.length);
  writeU16(eocdView, 10, entries.length);
  writeU32(eocdView, 12, centralSize);
  writeU32(eocdView, 16, centralOffset);
  writeU16(eocdView, 20, 0);

  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}

function buildOmrProjectJson(title, frames, settings) {
  return JSON.stringify({
    title,
    createdBy: "Scoreon",
    version: "1.0.0",
    exportType: "omr-package",
    createdAt: new Date().toISOString(),
    source: {
      tabTitle: state.sourceTabTitle || null,
      tabUrl: state.sourceTabUrl || null
    },
    frames: frames.map((frame, index) => {
      const base = getFrameBaseName(frame, index);
      return {
        order: index + 1,
        label: normalizeWhitespace(frame.label || "") || null,
        originalFile: `original/${base}-original.png`,
        omrFile: `omr/${base}-omr.png`,
        width: frame.width,
        height: frame.height,
        detectorScore: frame.score,
        capturedVideoTime: frame.videoTime
      };
    }),
    omrSettings: {
      preferredProgram: "Audiveris",
      targetFormat: "MusicXML / MXL",
      imageFormat: "PNG",
      binarization: "Otsu threshold",
      recommendedNextStep: "Open the OMR PNG files in Audiveris, export MusicXML/MXL, then correct the result in MuseScore Studio."
    },
    captureSettings: {
      pdfLayout: settings.pdfLayout,
      pdfMode: settings.pdfMode,
      autoTrim: settings.autoTrim,
      trimPadding: settings.trimPadding,
      enhance: settings.enhance,
      scoreDetector: settings.scoreDetector,
      minScore: settings.minScore
    }
  }, null, 2);
}

function buildOmrReadme(title) {
  return [
    t("omrReadmeTitle"),
    "",
    `${t("omrReadmeLabelTitle")}: ${title}`,
    "",
    t("omrReadmeContents"),
    t("omrReadmeOriginal"),
    t("omrReadmeOmr"),
    t("omrReadmePreview"),
    t("omrReadmeProject"),
    "",
    t("omrReadmeWorkflow"),
    t("omrReadmeStep1"),
    t("omrReadmeStep2"),
    t("omrReadmeStep3"),
    t("omrReadmeStep4"),
    t("omrReadmeStep5"),
    "",
    t("omrReadmeImportant"),
    t("omrReadmeWarning"),
    ""
  ].join("\n");
}

export function bindExportHandlers(setStatus) {
  els.exportPngZipBtn.addEventListener("click", async () => {
    if (state.frames.length === 0) return;

    try {
      const settings = getSettings();
      const title = settings.scoreTitle;
      setStatus(t("statusCreatingPngZip"));

      const entries = [];
      for (let i = 0; i < state.frames.length; i++) {
        const frame = state.frames[i];
        const base = getFrameBaseName(frame, i);
        entries.push({ path: `${base}.png`, data: await frameToPngBlob(frame) });
      }

      const zipBlob = await createZipBlob(entries);
      downloadBlob(zipBlob, `${sanitizeFilename(title)}-png.zip`);
      setStatus(t("statusPngZipCreated"));
    } catch (error) {
      console.error(error);
      setStatus(t("statusPngZipFailed"));
    }
  });

  els.exportOmrPackageBtn.addEventListener("click", async () => {
    if (state.frames.length === 0) return;

    try {
      const settings = getSettings();
      const title = settings.scoreTitle;
      const root = safePathPart(title, "score-omr-package");
      setStatus(t("statusCreatingOmrPackage"));

      const entries = [];
      for (let i = 0; i < state.frames.length; i++) {
        const frame = state.frames[i];
        const base = getFrameBaseName(frame, i);
        entries.push({ path: `${root}/original/${base}-original.png`, data: await frameToPngBlob(frame) });
        entries.push({ path: `${root}/omr/${base}-omr.png`, data: await createOmrReadyPngBlob(frame) });
      }

      const previewPdf = await buildPdf(state.frames, settings.pdfLayout, settings.pdfMode, title);
      entries.push({ path: `${root}/preview.pdf`, data: previewPdf });
      entries.push({ path: `${root}/project.json`, data: buildOmrProjectJson(title, state.frames, settings) });
      entries.push({ path: `${root}/README.txt`, data: buildOmrReadme(title) });

      const zipBlob = await createZipBlob(entries);
      downloadBlob(zipBlob, `${sanitizeFilename(title)}-omr-package.zip`);
      setStatus(t("statusOmrPackageCreated"));
    } catch (error) {
      console.error(error);
      setStatus(t("statusOmrPackageFailed"));
    }
  });

  els.exportPdfBtn.addEventListener("click", async () => {
    if (state.frames.length === 0) return;

    try {
      setStatus(t("statusCreatingPdf"));
      const settings = getSettings();
      const pdfBlob = await buildPdf(state.frames, settings.pdfLayout, settings.pdfMode, settings.scoreTitle);
      const url = URL.createObjectURL(pdfBlob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(settings.scoreTitle)}.pdf`;
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus(t("statusPdfCreated"));
    } catch (error) {
      console.error(error);
      setStatus(t("statusPdfFailed"));
    }
  });
}
