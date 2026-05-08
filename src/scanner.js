import { els, state, t } from "./scanner/shared.js";
import { bindCropEvents, resizeSelectionCanvas, updateCropInfo } from "./scanner/crop.js";
import {
  analyzeScoreLikeArea,
  buildSignature,
  getSettings,
  minDiffFromSavedSignatures,
  saveCurrentFrame,
  signatureDiff,
  updateDetectorMetrics
} from "./scanner/processing.js";
import { bindExportHandlers } from "./scanner/package-export.js";
import {
  bindTitleControls,
  maybeUseCaptureTrackLabel,
  readInitialTitleFromUrl,
  renderFrames,
  setStatus
} from "./scanner/ui.js";

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

async function manualCaptureFrame() {
  if (!state.stream || !els.video.videoWidth) {
    setStatus(t("statusStartCaptureFirst"));
    return;
  }

  if (!state.cropVideo) {
    setStatus(t("statusSelectScoreArea"));
    return;
  }

  const detectorResult = analyzeScoreLikeArea();
  updateDetectorMetrics(detectorResult);

  const signature = buildSignature();
  const diff = signatureDiff(signature, state.lastSignature);
  els.lastDiff.textContent = Number.isFinite(diff) ? diff.toFixed(1) : t("metricNew");

  state.lastSignature = signature;
  state.lastSavedAt = Date.now();
  await saveCurrentFrame(diff, detectorResult, signature);
  setStatus(t("statusManualFrameSaved", [String(state.frames.length), String(detectorResult.score)]));
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

function bindCaptureControls() {
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
}

function bindScanControls() {
  els.startScanBtn.addEventListener("click", startScan);
  els.stopScanBtn.addEventListener("click", stopScan);
  els.manualCaptureBtn.addEventListener("click", () => {
    void manualCaptureFrame();
  });
}

function bindClearFramesControl() {
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
}

bindTitleControls();
bindCropEvents();
bindCaptureControls();
bindScanControls();
bindClearFramesControl();
bindExportHandlers(setStatus);

readInitialTitleFromUrl();
renderFrames();
updateDetectorMetrics();
resizeSelectionCanvas();
