import { els, selectionCtx, state, t } from "./shared.js";

export function resizeSelectionCanvas() {
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
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

function clampRectToVideoDisplay(cssRect) {
  const display = getVideoDisplayRect();
  const x1 = Math.max(cssRect.x, display.x);
  const y1 = Math.max(cssRect.y, display.y);
  const x2 = Math.min(cssRect.x + cssRect.w, display.x + display.width);
  const y2 = Math.min(cssRect.y + cssRect.h, display.y + display.height);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
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

export function updateCropInfo() {
  if (!state.cropVideo) {
    els.cropInfo.textContent = t("cropNone");
    return;
  }

  const { x, y, w, h } = state.cropVideo;
  els.cropInfo.textContent = t("cropInfo", [String(x), String(y), String(w), String(h)]);
}

export function drawSelection(tempRect = null) {
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
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function bindCropEvents() {
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
}
