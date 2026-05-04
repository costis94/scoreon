import { DEFAULT_SCORE_TITLE, els, state, t } from "./shared.js";
import { cleanScoreTitle, formatTime, normalizeWhitespace } from "./text.js";

export function setStatus(text) {
  els.status.textContent = text;
}

export function updateSourceTitleHint() {
  if (!els.sourceTitleHint) return;

  if (state.sourceTabTitle) {
    els.sourceTitleHint.textContent = t("sourceTitleCaptured", [state.sourceTabTitle]);
  } else {
    els.sourceTitleHint.textContent = t("sourceTitleMissing");
  }
}

export function setScoreTitle(title, { auto = false } = {}) {
  const cleaned = cleanScoreTitle(title) || DEFAULT_SCORE_TITLE;
  els.scoreTitleInput.value = cleaned;
  els.scoreTitleInput.dataset.autofilled = auto ? "true" : "false";
}

export function readInitialTitleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.sourceTabTitle = normalizeWhitespace(params.get("sourceTitle") || "");
  state.sourceTabUrl = normalizeWhitespace(params.get("sourceUrl") || "");

  const initialTitle = cleanScoreTitle(state.sourceTabTitle) || DEFAULT_SCORE_TITLE;
  setScoreTitle(initialTitle, { auto: Boolean(state.sourceTabTitle) });
  updateSourceTitleHint();
}

export function maybeUseCaptureTrackLabel() {
  const track = state.stream?.getVideoTracks?.()[0];
  const label = normalizeWhitespace(track?.label || "");
  if (!label) return;

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

export function bindTitleControls() {
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
}

export function renderFrames() {
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
