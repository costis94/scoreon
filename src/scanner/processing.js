import { compareCtx, DEFAULT_SCORE_TITLE, detectorCtx, els, state, t, workCtx } from "./shared.js";
import { renderFrames } from "./ui.js";
import { cleanScoreTitle } from "./text.js";

export function getSettings() {
  return {
    scoreTitle: cleanScoreTitle(els.scoreTitleInput.value) || DEFAULT_SCORE_TITLE,
    intervalMs: Number(els.intervalInput.value) || 500,
    threshold: Number(els.thresholdInput.value) || 12,
    minGapMs: Number(els.minGapInput.value) || 900,
    maxImageWidth: Number(els.maxImageWidthInput.value) || 1600,
    scoreDetector: els.scoreDetectorInput.checked,
    minScore: Number(els.minScoreInput.value) || 48,
    enhance: els.enhanceInput.checked,
    pdfLayout: els.pdfLayoutInput.value,
    pdfMode: els.pdfModeInput.value,
    autoTrim: els.autoTrimInput.checked,
    trimPadding: Number(els.trimPaddingInput.value) || 18,
    duplicateThreshold: Number(els.duplicateThresholdInput.value) || 5
  };
}

export function buildSignature() {
  const crop = state.cropVideo;
  if (!crop) return null;

  const sigW = 96;
  const sigH = Math.max(16, Math.round(sigW * crop.h / crop.w));

  els.compareCanvas.width = sigW;
  els.compareCanvas.height = sigH;
  compareCtx.drawImage(els.video, crop.x, crop.y, crop.w, crop.h, 0, 0, sigW, sigH);

  const imageData = compareCtx.getImageData(0, 0, sigW, sigH);
  const data = imageData.data;
  const grays = new Uint8Array(sigW * sigH);
  let sum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grays[p] = gray;
    sum += gray;
  }

  const mean = sum / grays.length;
  const inkThreshold = Math.max(80, Math.min(155, mean - 35));
  const signature = new Uint8Array(sigW * sigH);

  for (let i = 0; i < grays.length; i++) {
    signature[i] = grays[i] < inkThreshold ? 255 : 0;
  }

  return signature;
}

export function signatureDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export function minDiffFromSavedSignatures(signature) {
  if (!signature || state.savedSignatures.length === 0) return Infinity;
  let min = Infinity;
  for (const saved of state.savedSignatures) {
    const diff = signatureDiff(signature, saved);
    if (diff < min) min = diff;
  }
  return min;
}

export function analyzeScoreLikeArea() {
  const crop = state.cropVideo;
  if (!crop) {
    return { score: 0, lineCount: 0, density: 0, contrast: 0, avgRunRatio: 0 };
  }

  const analysisW = Math.min(360, Math.max(120, crop.w));
  const analysisH = Math.min(220, Math.max(50, Math.round(analysisW * crop.h / crop.w)));

  els.detectorCanvas.width = analysisW;
  els.detectorCanvas.height = analysisH;
  detectorCtx.drawImage(els.video, crop.x, crop.y, crop.w, crop.h, 0, 0, analysisW, analysisH);

  const imageData = detectorCtx.getImageData(0, 0, analysisW, analysisH);
  const data = imageData.data;
  const grays = new Uint8Array(analysisW * analysisH);

  let sum = 0;
  let darkPixels = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grays[p] = gray;
    sum += gray;
    if (gray < 105) darkPixels++;
  }

  const totalPixels = analysisW * analysisH;
  const mean = sum / totalPixels;

  let varianceSum = 0;
  for (let i = 0; i < grays.length; i++) {
    const delta = grays[i] - mean;
    varianceSum += delta * delta;
  }

  const contrast = Math.sqrt(varianceSum / totalPixels);
  const density = darkPixels / totalPixels;

  const rowCandidates = [];
  let maxRunRatioSum = 0;
  let candidateRows = 0;

  for (let y = 0; y < analysisH; y++) {
    let rowDark = 0;
    let maxRun = 0;
    let run = 0;

    for (let x = 0; x < analysisW; x++) {
      const gray = grays[y * analysisW + x];
      const isDark = gray < 115;
      if (isDark) {
        rowDark++;
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }

    const darkRatio = rowDark / analysisW;
    const runRatio = maxRun / analysisW;
    const looksLikeHorizontalRule = runRatio >= 0.26 && darkRatio >= 0.035;
    rowCandidates.push(looksLikeHorizontalRule);

    if (looksLikeHorizontalRule) {
      maxRunRatioSum += runRatio;
      candidateRows++;
    }
  }

  const lineGroups = [];
  let inGroup = false;
  let start = 0;

  for (let y = 0; y < rowCandidates.length; y++) {
    if (rowCandidates[y] && !inGroup) {
      inGroup = true;
      start = y;
    }

    if ((!rowCandidates[y] || y === rowCandidates.length - 1) && inGroup) {
      const end = rowCandidates[y] ? y : y - 1;
      lineGroups.push({ start, end, center: (start + end) / 2 });
      inGroup = false;
    }
  }

  const filteredGroups = lineGroups.filter((group) => (group.end - group.start + 1) <= 5);
  let closeSpacingPairs = 0;
  for (let i = 1; i < filteredGroups.length; i++) {
    const spacing = filteredGroups[i].center - filteredGroups[i - 1].center;
    if (spacing >= 4 && spacing <= 32) closeSpacingPairs++;
  }

  const lineCount = filteredGroups.length;
  const avgRunRatio = candidateRows ? maxRunRatioSum / candidateRows : 0;
  const lineScore = Math.min(1, lineCount / 5);
  const spacingScore = Math.min(1, closeSpacingPairs / 4);
  const runScore = Math.min(1, avgRunRatio / 0.55);
  const contrastScore = Math.min(1, contrast / 48);

  let densityScore = 0;
  if (density >= 0.006 && density <= 0.38) {
    densityScore = density <= 0.18 ? Math.min(1, density / 0.035) : Math.max(0.25, 1 - (density - 0.18) / 0.20);
  }

  const score = Math.round(100 * (
    0.34 * lineScore +
    0.20 * spacingScore +
    0.22 * runScore +
    0.14 * contrastScore +
    0.10 * densityScore
  ));

  return { score, lineCount, density, contrast, avgRunRatio };
}

export function updateDetectorMetrics(result = null) {
  if (result) {
    els.lastScore.textContent = `${result.score} / 100`;
    els.lastScore.title = t("scoreDetailsTitle", [
      String(result.lineCount),
      (result.density * 100).toFixed(1),
      result.contrast.toFixed(1)
    ]);
  } else {
    els.lastScore.textContent = "-";
    els.lastScore.removeAttribute("title");
  }

  els.rejectedCount.textContent = state.rejectedByDetector.toString();
}

function findTrimBounds(canvas, padding) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const darkThreshold = 205;
  const rowDarkRatio = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (gray < darkThreshold) dark++;
    }
    rowDarkRatio[y] = dark / width;
  }

  const blockedRows = new Uint8Array(height);
  let y = 0;
  while (y < height) {
    if (rowDarkRatio[y] <= 0.72) {
      y++;
      continue;
    }

    const start = y;
    while (y < height && rowDarkRatio[y] > 0.72) y++;
    const end = y - 1;
    const groupHeight = end - start + 1;

    if (groupHeight >= 6) {
      for (let yy = start; yy <= end; yy++) blockedRows[yy] = 1;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let yy = 0; yy < height; yy++) {
    if (blockedRows[yy]) continue;

    for (let x = 0; x < width; x++) {
      const i = (yy * width + x) * 4;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (gray < darkThreshold) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, yy);
        maxY = Math.max(maxY, yy);
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;
  if (trimW < 80 || trimH < 30) return null;
  if (trimW >= width * 0.98 && trimH >= height * 0.98) return null;

  return { x: minX, y: minY, w: trimW, h: trimH };
}

function trimCanvasToInk(canvas, padding) {
  const bounds = findTrimBounds(canvas, padding);
  if (!bounds) return { width: canvas.width, height: canvas.height, changed: false };

  const tmp = document.createElement("canvas");
  tmp.width = bounds.w;
  tmp.height = bounds.h;
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.fillStyle = "#ffffff";
  tmpCtx.fillRect(0, 0, bounds.w, bounds.h);
  tmpCtx.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);

  canvas.width = bounds.w;
  canvas.height = bounds.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, bounds.w, bounds.h);
  ctx.drawImage(tmp, 0, 0);

  return { width: bounds.w, height: bounds.h, changed: true };
}

function enhanceImage(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const contrast = 1.28;
  const midpoint = 128;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const adjusted = Math.max(0, Math.min(255, midpoint + (gray - midpoint) * contrast));
    data[i] = adjusted;
    data[i + 1] = adjusted;
    data[i + 2] = adjusted;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

export async function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(t("errorCreateImageBlob")));
    }, type, quality);
  });
}

export async function saveCurrentFrame(diffValue, detectorResult = null, signature = null) {
  const crop = state.cropVideo;
  const settings = getSettings();

  const scale = Math.min(1, settings.maxImageWidth / crop.w);
  let outW = Math.round(crop.w * scale);
  let outH = Math.round(crop.h * scale);

  els.workCanvas.width = outW;
  els.workCanvas.height = outH;

  workCtx.fillStyle = "#ffffff";
  workCtx.fillRect(0, 0, outW, outH);
  workCtx.drawImage(els.video, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);

  if (settings.enhance) enhanceImage(workCtx, outW, outH);
  if (settings.autoTrim) {
    const trimmed = trimCanvasToInk(els.workCanvas, settings.trimPadding);
    outW = trimmed.width;
    outH = trimmed.height;
  }

  const pngBlob = await canvasToBlob(els.workCanvas, "image/png");
  const blob = await canvasToBlob(els.workCanvas, "image/jpeg", 0.92);
  const url = URL.createObjectURL(blob);
  const frame = {
    id: crypto.randomUUID(),
    blob,
    pngBlob,
    url,
    width: outW,
    height: outH,
    createdAt: Date.now(),
    videoTime: els.video.currentTime,
    diff: diffValue,
    signature,
    score: detectorResult ? detectorResult.score : null,
    lineCount: detectorResult ? detectorResult.lineCount : null,
    label: ""
  };

  state.frames.push(frame);
  if (signature) state.savedSignatures.push(signature.slice());
  renderFrames();
}
