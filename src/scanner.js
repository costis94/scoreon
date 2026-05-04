const $ = (id) => document.getElementById(id);
const t = window.t || ((key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key);

const els = {
  status: $("status"),
  startCaptureBtn: $("startCaptureBtn"),
  startScanBtn: $("startScanBtn"),
  stopScanBtn: $("stopScanBtn"),
  exportPdfBtn: $("exportPdfBtn"),
  exportPngZipBtn: $("exportPngZipBtn"),
  exportOmrPackageBtn: $("exportOmrPackageBtn"),
  clearFramesBtn: $("clearFramesBtn"),
  clearCropBtn: $("clearCropBtn"),
  videoShell: $("videoShell"),
  video: $("previewVideo"),
  selectionCanvas: $("selectionCanvas"),
  emptyHint: $("emptyHint"),
  cropInfo: $("cropInfo"),
  scoreTitleInput: $("scoreTitleInput"),
  useCapturedTitleBtn: $("useCapturedTitleBtn"),
  sourceTitleHint: $("sourceTitleHint"),
  framesList: $("framesList"),
  framesCount: $("framesCount"),
  lastDiff: $("lastDiff"),
  workCanvas: $("workCanvas"),
  compareCanvas: $("compareCanvas"),
  detectorCanvas: $("detectorCanvas"),
  intervalInput: $("intervalInput"),
  thresholdInput: $("thresholdInput"),
  minGapInput: $("minGapInput"),
  maxImageWidthInput: $("maxImageWidthInput"),
  scoreDetectorInput: $("scoreDetectorInput"),
  minScoreInput: $("minScoreInput"),
  enhanceInput: $("enhanceInput"),
  pdfLayoutInput: $("pdfLayoutInput"),
  pdfModeInput: $("pdfModeInput"),
  autoTrimInput: $("autoTrimInput"),
  trimPaddingInput: $("trimPaddingInput"),
  duplicateThresholdInput: $("duplicateThresholdInput"),
  lastScore: $("lastScore"),
  rejectedCount: $("rejectedCount")
};

const state = {
  stream: null,
  cropCss: null,
  cropVideo: null,
  isDragging: false,
  dragStart: null,
  scanTimer: null,
  scanning: false,
  lastSignature: null,
  lastSavedAt: 0,
  frames: [],
  savedSignatures: [],
  rejectedByDetector: 0,
  sourceTabTitle: "",
  sourceTabUrl: "",
  titleEdited: false
};

const selectionCtx = els.selectionCanvas.getContext("2d");
const workCtx = els.workCanvas.getContext("2d", { willReadFrequently: true });
const compareCtx = els.compareCanvas.getContext("2d", { willReadFrequently: true });
const detectorCtx = els.detectorCanvas.getContext("2d", { willReadFrequently: true });

const DEFAULT_SCORE_TITLE = t("defaultScoreTitle");

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function cleanScoreTitle(rawTitle) {
  let title = normalizeWhitespace(rawTitle);
  if (!title) return "";

  // Common YouTube/browser suffixes. Keep the actual song/video title clean.
  title = title
    .replace(/\s*[\-|–|—|•|·|\|]\s*YouTube\s*$/i, "")
    .replace(/\s*[\-|–|—|•|·|\|]\s*YouTube Music\s*$/i, "")
    .replace(/^YouTube\s*[\-|–|—|•|·|\|]\s*/i, "")
    .replace(/\s*\([0-9]+\)\s*$/i, "")
    .trim();

  return title || DEFAULT_SCORE_TITLE;
}

function sanitizeFilename(text) {
  const title = normalizeWhitespace(text) || DEFAULT_SCORE_TITLE;
  return title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[-_]{2,}/g, "-")
    .trim()
    .slice(0, 90) || "scoreon-score";
}

function updateSourceTitleHint() {
  if (!els.sourceTitleHint) return;

  if (state.sourceTabTitle) {
    els.sourceTitleHint.textContent = t("sourceTitleCaptured", [state.sourceTabTitle]);
  } else {
    els.sourceTitleHint.textContent = t("sourceTitleMissing");
  }
}

function setScoreTitle(title, { auto = false } = {}) {
  const cleaned = cleanScoreTitle(title) || DEFAULT_SCORE_TITLE;
  els.scoreTitleInput.value = cleaned;
  els.scoreTitleInput.dataset.autofilled = auto ? "true" : "false";
}

function readInitialTitleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.sourceTabTitle = normalizeWhitespace(params.get("sourceTitle") || "");
  state.sourceTabUrl = normalizeWhitespace(params.get("sourceUrl") || "");

  const initialTitle = cleanScoreTitle(state.sourceTabTitle) || DEFAULT_SCORE_TITLE;
  setScoreTitle(initialTitle, { auto: Boolean(state.sourceTabTitle) });
  updateSourceTitleHint();
}

function maybeUseCaptureTrackLabel() {
  const track = state.stream?.getVideoTracks?.()[0];
  const label = normalizeWhitespace(track?.label || "");
  if (!label) return;

  // Some browsers expose a useful tab/window label, some expose only a generic screen label.
  const looksGeneric = /^(screen|window|tab|monitor|display)(\s|:|$)/i.test(label) && !/youtube/i.test(label);
  if (looksGeneric) return;

  if (!state.sourceTabTitle) {
    state.sourceTabTitle = label;
    updateSourceTitleHint();
  }

  if (!state.titleEdited && els.scoreTitleInput.dataset.autofilled === "true") {
    setScoreTitle(label, { auto: true });
  }
}

els.scoreTitleInput.addEventListener("input", () => {
  state.titleEdited = true;
  els.scoreTitleInput.dataset.autofilled = "false";
});

els.useCapturedTitleBtn.addEventListener("click", () => {
  if (!state.sourceTabTitle) {
    setStatus(t("sourceTitleUnavailable"));
    return;
  }

  state.titleEdited = false;
  setScoreTitle(state.sourceTabTitle, { auto: true });
  setStatus(t("sourceTitleApplied"));
});

function setStatus(text) {
  els.status.textContent = text;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const m = Math.floor((seconds / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function resizeSelectionCanvas() {
  const rect = els.videoShell.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.selectionCanvas.width = Math.round(rect.width * dpr);
  els.selectionCanvas.height = Math.round(rect.height * dpr);
  els.selectionCanvas.style.width = `${rect.width}px`;
  els.selectionCanvas.style.height = `${rect.height}px`;
  selectionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSelection();
}

function getVideoDisplayRect() {
  const shell = els.videoShell.getBoundingClientRect();
  const vw = els.video.videoWidth || 16;
  const vh = els.video.videoHeight || 9;
  const shellRatio = shell.width / shell.height;
  const videoRatio = vw / vh;

  let width;
  let height;
  let x;
  let y;

  if (shellRatio > videoRatio) {
    height = shell.height;
    width = height * videoRatio;
    x = (shell.width - width) / 2;
    y = 0;
  } else {
    width = shell.width;
    height = width / videoRatio;
    x = 0;
    y = (shell.height - height) / 2;
  }

  return { x, y, width, height };
}

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return { x, y, w, h };
}

function clampRectToVideoDisplay(cssRect) {
  const display = getVideoDisplayRect();
  const x1 = Math.max(cssRect.x, display.x);
  const y1 = Math.max(cssRect.y, display.y);
  const x2 = Math.min(cssRect.x + cssRect.w, display.x + display.width);
  const y2 = Math.min(cssRect.y + cssRect.h, display.y + display.height);
  return {
    x: x1,
    y: y1,
    w: Math.max(0, x2 - x1),
    h: Math.max(0, y2 - y1)
  };
}

function cssRectToVideoRect(cssRect) {
  const display = getVideoDisplayRect();
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;

  const x = Math.round(((cssRect.x - display.x) / display.width) * vw);
  const y = Math.round(((cssRect.y - display.y) / display.height) * vh);
  const w = Math.round((cssRect.w / display.width) * vw);
  const h = Math.round((cssRect.h / display.height) * vh);

  return {
    x: Math.max(0, Math.min(vw - 1, x)),
    y: Math.max(0, Math.min(vh - 1, y)),
    w: Math.max(1, Math.min(vw - x, w)),
    h: Math.max(1, Math.min(vh - y, h))
  };
}

function updateCropInfo() {
  if (!state.cropVideo) {
    els.cropInfo.textContent = t("cropNone");
    return;
  }

  const { x, y, w, h } = state.cropVideo;
  els.cropInfo.textContent = t("cropInfo", [String(x), String(y), String(w), String(h)]);
}

function drawSelection(tempRect = null) {
  const rect = els.videoShell.getBoundingClientRect();
  selectionCtx.clearRect(0, 0, rect.width, rect.height);

  const drawRect = tempRect || state.cropCss;
  if (!drawRect || drawRect.w < 5 || drawRect.h < 5) return;

  selectionCtx.fillStyle = "rgba(0, 0, 0, 0.35)";
  selectionCtx.fillRect(0, 0, rect.width, rect.height);

  selectionCtx.clearRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
  selectionCtx.strokeStyle = "#22c55e";
  selectionCtx.lineWidth = 2;
  selectionCtx.strokeRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);

  selectionCtx.fillStyle = "rgba(34, 197, 94, 0.18)";
  selectionCtx.fillRect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
}

function getMousePos(event) {
  const rect = els.selectionCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

els.selectionCanvas.addEventListener("pointerdown", (event) => {
  if (!els.video.videoWidth) return;
  state.isDragging = true;
  state.dragStart = getMousePos(event);
  els.selectionCanvas.setPointerCapture(event.pointerId);
});

els.selectionCanvas.addEventListener("pointermove", (event) => {
  if (!state.isDragging || !state.dragStart) return;
  const current = getMousePos(event);
  const cssRect = clampRectToVideoDisplay(normalizeRect(state.dragStart, current));
  drawSelection(cssRect);
});

els.selectionCanvas.addEventListener("pointerup", (event) => {
  if (!state.isDragging || !state.dragStart) return;
  state.isDragging = false;

  const current = getMousePos(event);
  const cssRect = clampRectToVideoDisplay(normalizeRect(state.dragStart, current));

  if (cssRect.w < 20 || cssRect.h < 20) {
    state.cropCss = null;
    state.cropVideo = null;
  } else {
    state.cropCss = cssRect;
    state.cropVideo = cssRectToVideoRect(cssRect);
  }

  state.dragStart = null;
  updateCropInfo();
  drawSelection();
});

els.clearCropBtn.addEventListener("click", () => {
  state.cropCss = null;
  state.cropVideo = null;
  updateCropInfo();
  drawSelection();
});

window.addEventListener("resize", resizeSelectionCanvas);

els.startCaptureBtn.addEventListener("click", async () => {
  try {
    setStatus(t("statusRequestingCapture"));

    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }

    state.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    els.video.srcObject = state.stream;
    els.emptyHint.style.display = "none";

    await els.video.play();
    maybeUseCaptureTrackLabel();

    state.stream.getVideoTracks()[0].addEventListener("ended", () => {
      stopScan();
      setStatus(t("statusCaptureStopped"));
    });

    setStatus(t("statusCaptureActive", [String(els.video.videoWidth), String(els.video.videoHeight)]));
    resizeSelectionCanvas();
  } catch (error) {
    console.error(error);
    setStatus(t("statusCaptureFailed"));
  }
});

els.video.addEventListener("loadedmetadata", () => {
  resizeSelectionCanvas();
  updateCropInfo();
});

function getSettings() {
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

function buildSignature() {
  const crop = state.cropVideo;
  if (!crop) return null;

  const sigW = 96;
  const sigH = Math.max(16, Math.round(sigW * crop.h / crop.w));

  els.compareCanvas.width = sigW;
  els.compareCanvas.height = sigH;
  compareCtx.drawImage(
    els.video,
    crop.x, crop.y, crop.w, crop.h,
    0, 0, sigW, sigH
  );

  const imageData = compareCtx.getImageData(0, 0, sigW, sigH);
  const data = imageData.data;
  const grays = new Uint8Array(sigW * sigH);
  let sum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grays[p] = gray;
    sum += gray;
  }

  // Adaptive ink signature: compare mainly black notes/staff lines, not changing video background.
  // This helps reject duplicates where only a transparent overlay/background changed.
  const mean = sum / grays.length;
  const inkThreshold = Math.max(80, Math.min(155, mean - 35));
  const signature = new Uint8Array(sigW * sigH);

  for (let i = 0; i < grays.length; i++) {
    signature[i] = grays[i] < inkThreshold ? 255 : 0;
  }

  return signature;
}

function signatureDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / a.length;
}


function minDiffFromSavedSignatures(signature) {
  if (!signature || state.savedSignatures.length === 0) return Infinity;
  let min = Infinity;
  for (const saved of state.savedSignatures) {
    const d = signatureDiff(signature, saved);
    if (d < min) min = d;
  }
  return min;
}

function analyzeScoreLikeArea() {
  const crop = state.cropVideo;
  if (!crop) {
    return { score: 0, lineCount: 0, density: 0, contrast: 0, avgRunRatio: 0 };
  }

  // Downscale the selected area so the detector stays fast and stable.
  const analysisW = Math.min(360, Math.max(120, crop.w));
  const analysisH = Math.min(220, Math.max(50, Math.round(analysisW * crop.h / crop.w)));

  els.detectorCanvas.width = analysisW;
  els.detectorCanvas.height = analysisH;
  detectorCtx.drawImage(
    els.video,
    crop.x, crop.y, crop.w, crop.h,
    0, 0, analysisW, analysisH
  );

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
    const d = grays[i] - mean;
    varianceSum += d * d;
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

    // Staff/tab lines usually create long, thin horizontal dark runs.
    const looksLikeHorizontalRule = runRatio >= 0.26 && darkRatio >= 0.035;
    rowCandidates.push(looksLikeHorizontalRule);

    if (looksLikeHorizontalRule) {
      maxRunRatioSum += runRatio;
      candidateRows++;
    }
  }

  // Merge adjacent candidate rows into line groups, so a 2px-thick line counts as one line.
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

  // Avoid counting extremely thick horizontal blocks as staff/tab lines.
  const filteredGroups = lineGroups.filter((g) => (g.end - g.start + 1) <= 5);

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

  // Too blank or too dark is suspicious. Sheet/tab screenshots usually have modest ink density.
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

function updateDetectorMetrics(result = null) {
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

  // Ignore thick full-width black bars, e.g. progress/video border bars near the bottom.
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

  // Avoid accidental destructive trims.
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

async function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(t("errorCreateImageBlob")));
    }, type, quality);
  });
}

async function saveCurrentFrame(diffValue, detectorResult = null, signature = null) {
  const crop = state.cropVideo;
  const settings = getSettings();

  const scale = Math.min(1, settings.maxImageWidth / crop.w);
  let outW = Math.round(crop.w * scale);
  let outH = Math.round(crop.h * scale);

  els.workCanvas.width = outW;
  els.workCanvas.height = outH;

  workCtx.fillStyle = "#ffffff";
  workCtx.fillRect(0, 0, outW, outH);
  workCtx.drawImage(
    els.video,
    crop.x, crop.y, crop.w, crop.h,
    0, 0, outW, outH
  );

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

async function scanTick() {
  if (!state.scanning) return;
  if (!els.video.videoWidth || !state.cropVideo) return;

  const settings = getSettings();
  const now = Date.now();
  const detectorResult = analyzeScoreLikeArea();
  updateDetectorMetrics(detectorResult);

  if (settings.scoreDetector && detectorResult.score < settings.minScore) {
    state.rejectedByDetector++;
    updateDetectorMetrics(detectorResult);
    if (state.rejectedByDetector % 10 === 1) {
      setStatus(t("statusRejectedFrame", [String(detectorResult.score)]));
    }
    return;
  }

  const signature = buildSignature();
  const diff = signatureDiff(signature, state.lastSignature);
  const minSavedDiff = minDiffFromSavedSignatures(signature);

  els.lastDiff.textContent = Number.isFinite(diff) ? diff.toFixed(1) : t("metricNew");

  const enoughGap = now - state.lastSavedAt >= settings.minGapMs;
  const looksNewEnough = state.savedSignatures.length === 0 || minSavedDiff >= settings.duplicateThreshold;
  const shouldSave = state.savedSignatures.length === 0 || (diff >= settings.threshold && enoughGap && looksNewEnough);

  if (shouldSave) {
    state.lastSignature = signature;
    state.lastSavedAt = now;
    await saveCurrentFrame(diff, detectorResult, signature);
    setStatus(t("statusSavedFrame", [String(state.frames.length), String(detectorResult.score)]));
  } else if (!looksNewEnough) {
    setStatus(t("statusSkippedDuplicate", [minSavedDiff.toFixed(1)]));
  }
}

function startScan() {
  if (!state.stream || !els.video.videoWidth) {
    setStatus(t("statusStartCaptureFirst"));
    return;
  }

  if (!state.cropVideo) {
    setStatus(t("statusSelectScoreArea"));
    return;
  }

  const settings = getSettings();
  state.scanning = true;
  state.lastSignature = null;
  state.lastSavedAt = 0;
  state.rejectedByDetector = 0;
  updateDetectorMetrics();

  els.startScanBtn.disabled = true;
  els.stopScanBtn.disabled = false;
  setStatus(t("statusScanRunning"));

  scanTick();
  state.scanTimer = setInterval(scanTick, settings.intervalMs);
}

function stopScan() {
  state.scanning = false;
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
    state.scanTimer = null;
  }

  els.startScanBtn.disabled = false;
  els.stopScanBtn.disabled = true;
  setStatus(t("statusScanStopped"));
}

els.startScanBtn.addEventListener("click", startScan);
els.stopScanBtn.addEventListener("click", stopScan);

function renderFrames() {
  els.framesCount.textContent = state.frames.length.toString();
  const noFrames = state.frames.length === 0;
  els.exportPdfBtn.disabled = noFrames;
  els.exportPngZipBtn.disabled = noFrames;
  els.exportOmrPackageBtn.disabled = noFrames;
  els.clearFramesBtn.disabled = noFrames;

  els.framesList.innerHTML = "";

  for (const [index, frame] of state.frames.entries()) {
    const card = document.createElement("article");
    card.className = "frameCard";

    const img = document.createElement("img");
    img.src = frame.url;
    img.alt = t("frameAlt", [String(index + 1)]);

    const body = document.createElement("div");
    body.className = "frameBody";

    const labelRow = document.createElement("label");
    labelRow.className = "frameLabelInput";
    labelRow.textContent = t("frameLabelInput");

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = t("frameLabelPlaceholder");
    labelInput.value = frame.label || "";
    labelInput.addEventListener("input", () => {
      frame.label = labelInput.value;
    });

    labelRow.append(labelInput);

    const meta = document.createElement("div");
    meta.className = "frameMeta";

    const info = document.createElement("span");
    const scoreText = frame.score === null || frame.score === undefined
      ? t("frameScoreEmpty")
      : t("frameScoreValue", [String(frame.score)]);
    info.textContent = t("frameInfo", [
      String(index + 1),
      formatTime(frame.videoTime),
      Number.isFinite(frame.diff) ? frame.diff.toFixed(1) : t("metricNew"),
      scoreText
    ]);

    const del = document.createElement("button");
    del.textContent = t("delete");
    del.addEventListener("click", () => {
      URL.revokeObjectURL(frame.url);
      state.frames = state.frames.filter((f) => f.id !== frame.id);
      state.savedSignatures = state.frames.map((f) => f.signature).filter(Boolean);
      renderFrames();
    });

    meta.append(info, del);
    body.append(labelRow, meta);
    card.append(img, body);
    els.framesList.append(card);
  }
}

els.clearFramesBtn.addEventListener("click", () => {
  for (const frame of state.frames) URL.revokeObjectURL(frame.url);
  state.frames = [];
  state.savedSignatures = [];
  state.lastSignature = null;
  state.rejectedByDetector = 0;
  updateDetectorMetrics();
  renderFrames();
  setStatus(t("statusFramesCleared"));
});

function textBytes(text) {
  return new TextEncoder().encode(text);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function blobToUint8Array(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function pdfEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 2) {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !current) {
      current = test;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }

  if (current) lines.push(current);

  if (lines.length > maxLines) lines.length = maxLines;

  // Add ellipsis if the last line still overflows badly.
  const lastIndex = lines.length - 1;
  if (lastIndex >= 0) {
    let last = lines[lastIndex];
    while (last.length > 3 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lastIndex] = last.length < lines[lastIndex].length ? `${last}…` : last;
  }

  return lines;
}

async function createTitleHeaderBlob(title) {
  const canvas = document.createElement("canvas");
  const width = 1800;
  const height = 260;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#111827";
  ctx.font = "700 58px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapCanvasText(ctx, title || DEFAULT_SCORE_TITLE, width - 160, 2);
  const lineHeight = 72;
  const totalHeight = lines.length * lineHeight;
  let y = height / 2 - totalHeight / 2 + lineHeight / 2 - 12;

  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += lineHeight;
  }

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, height - 34);
  ctx.lineTo(width - 120, height - 34);
  ctx.stroke();

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.94);
  return { blob, width, height };
}


async function createFrameLabelBlob(label) {
  const canvas = document.createElement("canvas");
  const width = 1800;
  const height = 92;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#111827";
  ctx.font = "700 38px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const lines = wrapCanvasText(ctx, label, width - 120, 1);
  ctx.fillText(lines[0] || "", 60, height / 2 + 1);

  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, height - 12);
  ctx.lineTo(width - 60, height - 12);
  ctx.stroke();

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.94);
  return { blob, width, height };
}

async function buildPdf(frames, layout, mode = "compact", title = DEFAULT_SCORE_TITLE) {
  const isLandscape = layout === "landscape";
  const pageW = isLandscape ? 841.89 : 595.28; // A4 points
  const pageH = isLandscape ? 595.28 : 841.89;
  const margin = 24;
  const gap = 14;

  const objects = [];

  function addObject(contentParts) {
    objects.push(contentParts);
    return objects.length;
  }

  addObject([textBytes("<< /Type /Catalog /Pages 2 0 R >>\n")]);
  const pagesId = addObject([textBytes("__PAGES_PLACEHOLDER__")]);

  let titleRef = null;
  const pdfTitle = normalizeWhitespace(title) || DEFAULT_SCORE_TITLE;
  if (pdfTitle) {
    const titleImage = await createTitleHeaderBlob(pdfTitle);
    const titleBytes = await blobToUint8Array(titleImage.blob);
    const titleImageId = addObject([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${titleImage.width} /Height ${titleImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${titleBytes.length} >>\nstream\n`),
      titleBytes,
      textBytes("\nendstream\n")
    ]);
    titleRef = { imageId: titleImageId, name: "TitleHeader", frame: titleImage };
  }

  const imageRefs = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const imageBytes = await blobToUint8Array(frame.blob);
    const imageId = addObject([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${frame.width} /Height ${frame.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      textBytes("\nendstream\n")
    ]);

    imageRefs.push({ imageId, name: `Im${i + 1}`, frame });
  }

  const labelRefs = [];
  for (let i = 0; i < frames.length; i++) {
    const label = normalizeWhitespace(frames[i].label || "");
    if (!label) {
      labelRefs.push(null);
      continue;
    }

    const labelImage = await createFrameLabelBlob(label);
    const labelBytes = await blobToUint8Array(labelImage.blob);
    const labelImageId = addObject([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${labelImage.width} /Height ${labelImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${labelBytes.length} >>\nstream\n`),
      labelBytes,
      textBytes("\nendstream\n")
    ]);

    labelRefs.push({ imageId: labelImageId, name: `Lbl${i + 1}`, frame: labelImage });
  }

  const pageIds = [];

  function addPdfPage(content, xObjects) {
    const contentBytes = textBytes(content);
    const contentId = addObject([
      textBytes(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      textBytes("endstream\n")
    ]);

    const xObjectEntries = xObjects.map((x) => `/${x.name} ${x.imageId} 0 R`).join(" ");
    const pageId = addObject([
      textBytes(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
        `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> ` +
        `/XObject << ${xObjectEntries} >> >> /Contents ${contentId} 0 R >>\n`
      )
    ]);
    pageIds.push(pageId);
  }

  if (mode === "single") {
    for (let i = 0; i < imageRefs.length; i++) {
      const img = imageRefs[i];
      const frame = img.frame;
      const labelRef = labelRefs[i];
      const availableW = pageW - margin * 2;
      let availableH = pageH - margin * 2;
      let topY = pageH - margin;
      let content = "";
      const pageXObjects = [img];

      if (i === 0 && titleRef) {
        const titleDrawW = availableW;
        const titleDrawH = Math.min(92, titleRef.frame.height * (titleDrawW / titleRef.frame.width));
        const titleX = margin;
        const titleY = topY - titleDrawH;

        content += [
          "q\n",
          `${titleDrawW.toFixed(2)} 0 0 ${titleDrawH.toFixed(2)} ${titleX.toFixed(2)} ${titleY.toFixed(2)} cm\n`,
          `/${titleRef.name} Do\n`,
          "Q\n"
        ].join("");

        pageXObjects.push(titleRef);
        topY = titleY - 18;
        availableH -= titleDrawH + 18;
      }

      let labelDrawH = 0;
      if (labelRef) {
        const labelDrawW = availableW;
        labelDrawH = Math.min(32, labelRef.frame.height * (labelDrawW / labelRef.frame.width));
        const labelX = margin;
        const labelY = topY - labelDrawH;

        content += [
          "q\n",
          `${labelDrawW.toFixed(2)} 0 0 ${labelDrawH.toFixed(2)} ${labelX.toFixed(2)} ${labelY.toFixed(2)} cm\n`,
          `/${labelRef.name} Do\n`,
          "Q\n"
        ].join("");

        pageXObjects.push(labelRef);
        topY = labelY - 8;
        availableH -= labelDrawH + 8;
      }

      const scale = Math.min(availableW / frame.width, availableH / frame.height);
      const drawW = frame.width * scale;
      const drawH = frame.height * scale;
      const x = (pageW - drawW) / 2;
      const y = margin + (availableH - drawH) / 2;

      content += [
        "q\n",
        `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n`,
        `/${img.name} Do\n`,
        "Q\n"
      ].join("");

      addPdfPage(content, pageXObjects);
    }
  } else {
    let content = "";
    let xObjects = [];
    let yCursor = pageH - margin;
    let titleAdded = false;

    function addTitleHeaderIfNeeded() {
      if (!titleRef || titleAdded) return;

      const availableW = pageW - margin * 2;
      const titleDrawW = availableW;
      const titleDrawH = Math.min(92, titleRef.frame.height * (titleDrawW / titleRef.frame.width));
      const titleX = margin;
      const titleY = yCursor - titleDrawH;

      content += [
        "q\n",
        `${titleDrawW.toFixed(2)} 0 0 ${titleDrawH.toFixed(2)} ${titleX.toFixed(2)} ${titleY.toFixed(2)} cm\n`,
        `/${titleRef.name} Do\n`,
        "Q\n"
      ].join("");

      xObjects.push(titleRef);
      yCursor = titleY - 22;
      titleAdded = true;
    }

    addTitleHeaderIfNeeded();

    function flushPage() {
      if (!content) return;
      addPdfPage(content, xObjects);
      content = "";
      xObjects = [];
      yCursor = pageH - margin;
    }

    for (let i = 0; i < imageRefs.length; i++) {
      const img = imageRefs[i];
      const frame = img.frame;
      const labelRef = labelRefs[i];
      const availableW = pageW - margin * 2;
      const maxItemH = pageH - margin * 2;
      const labelDrawW = availableW;
      const labelDrawH = labelRef ? Math.min(32, labelRef.frame.height * (labelDrawW / labelRef.frame.width)) : 0;
      const labelGap = labelRef ? 6 : 0;
      const imageMaxH = Math.max(40, maxItemH - labelDrawH - labelGap);
      const scale = Math.min(availableW / frame.width, imageMaxH / frame.height);
      const drawW = frame.width * scale;
      const drawH = frame.height * scale;
      const itemH = labelDrawH + labelGap + drawH + gap;

      if (content && yCursor - itemH < margin) flushPage();

      let currentY = yCursor;

      if (labelRef) {
        const labelX = margin;
        const labelY = currentY - labelDrawH;
        content += [
          "q\n",
          `${labelDrawW.toFixed(2)} 0 0 ${labelDrawH.toFixed(2)} ${labelX.toFixed(2)} ${labelY.toFixed(2)} cm\n`,
          `/${labelRef.name} Do\n`,
          "Q\n"
        ].join("");
        xObjects.push(labelRef);
        currentY = labelY - labelGap;
      }

      const x = (pageW - drawW) / 2;
      const imageY = currentY - drawH;

      content += [
        "q\n",
        `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${imageY.toFixed(2)} cm\n`,
        `/${img.name} Do\n`,
        "Q\n"
      ].join("");

      xObjects.push(img);
      yCursor = imageY - gap;
    }

    flushPage();
  }


  objects[pagesId - 1] = [
    textBytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>\n`)
  ];

  const parts = [textBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let lengthSoFar = parts[0].length;

  for (let i = 0; i < objects.length; i++) {
    offsets.push(lengthSoFar);
    const header = textBytes(`${i + 1} 0 obj\n`);
    const footer = textBytes("endobj\n");
    const objBytes = concatBytes([header, ...objects[i], footer]);
    parts.push(objBytes);
    lengthSoFar += objBytes.length;
  }

  const xrefOffset = lengthSoFar;
  const xrefLines = [
    "xref\n",
    `0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n"
  ];

  for (let i = 1; i < offsets.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }

  xrefLines.push(
    "trailer\n",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    "startxref\n",
    `${xrefOffset}\n`,
    "%%EOF\n"
  );

  parts.push(textBytes(xrefLines.join("")));
  return new Blob([concatBytes(parts)], { type: "application/pdf" });
}


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

async function createOmrReadyPngBlob(frame) {
  const sourceBlob = await frameToPngBlob(frame);
  const img = await loadImageFromBlob(sourceBlob);
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const histogram = new Uint32Array(256);
  const grays = new Uint8Array(canvas.width * canvas.height);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grays[p] = gray;
    histogram[gray]++;
  }

  // OMR engines prefer clean black staff/notes on white background.
  // Otsu works well for many scanned/screenshot sheet images.
  const threshold = otsuThresholdFromHistogram(histogram, grays.length);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const out = grays[p] < threshold ? 0 : 255;
    data[i] = out;
    data[i + 1] = out;
    data[i + 2] = out;
    data[i + 3] = 255;
  }

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
    const flags = 0x0800; // UTF-8 filenames.

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
      entries.push({
        path: `${base}.png`,
        data: await frameToPngBlob(frame)
      });
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
      entries.push({
        path: `${root}/original/${base}-original.png`,
        data: await frameToPngBlob(frame)
      });
      entries.push({
        path: `${root}/omr/${base}-omr.png`,
        data: await createOmrReadyPngBlob(frame)
      });
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

readInitialTitleFromUrl();
renderFrames();
updateDetectorMetrics();
resizeSelectionCanvas();
