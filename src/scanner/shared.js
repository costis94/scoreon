const $ = (id) => document.getElementById(id);

export const t = window.t || ((key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key);

export const els = {
  status: $("status"),
  startCaptureBtn: $("startCaptureBtn"),
  startScanBtn: $("startScanBtn"),
  stopScanBtn: $("stopScanBtn"),
  manualCaptureBtn: $("manualCaptureBtn"),
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

export const state = {
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

export const selectionCtx = els.selectionCanvas.getContext("2d");
export const workCtx = els.workCanvas.getContext("2d", { willReadFrequently: true });
export const compareCtx = els.compareCanvas.getContext("2d", { willReadFrequently: true });
export const detectorCtx = els.detectorCanvas.getContext("2d", { willReadFrequently: true });

export const DEFAULT_SCORE_TITLE = t("defaultScoreTitle");
