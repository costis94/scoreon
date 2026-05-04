import { DEFAULT_SCORE_TITLE } from "./shared.js";

export function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function cleanScoreTitle(rawTitle) {
  let title = normalizeWhitespace(rawTitle);
  if (!title) return "";

  title = title
    .replace(/\s*[\-|β€“|β€”|β€Ά|Β·|\|]\s*YouTube\s*$/i, "")
    .replace(/\s*[\-|β€“|β€”|β€Ά|Β·|\|]\s*YouTube Music\s*$/i, "")
    .replace(/^YouTube\s*[\-|β€“|β€”|β€Ά|Β·|\|]\s*/i, "")
    .replace(/\s*\([0-9]+\)\s*$/i, "")
    .trim();

  return title || DEFAULT_SCORE_TITLE;
}

export function sanitizeFilename(text) {
  const title = normalizeWhitespace(text) || DEFAULT_SCORE_TITLE;
  return title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[-_]{2,}/g, "-")
    .trim()
    .slice(0, 90) || "scoreon-score";
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const m = Math.floor((seconds / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}
