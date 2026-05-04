import { DEFAULT_SCORE_TITLE } from "./shared.js";
import { canvasToBlob } from "./processing.js";
import { normalizeWhitespace } from "./text.js";

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

function pdfEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

async function blobToUint8Array(blob) {
  return new Uint8Array(await blob.arrayBuffer());
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

  const lastIndex = lines.length - 1;
  if (lastIndex >= 0) {
    let last = lines[lastIndex];
    while (last.length > 3 && ctx.measureText(`${last}β€¦`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lastIndex] = last.length < lines[lastIndex].length ? `${last}β€¦` : last;
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

export async function buildPdf(frames, layout, mode = "compact", title = DEFAULT_SCORE_TITLE) {
  const isLandscape = layout === "landscape";
  const pageW = isLandscape ? 841.89 : 595.28;
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
  const pendingPages = [];

  function addPdfPage(content, xObjects) {
    pendingPages.push({ content, xObjects });
  }

  function buildFooterContent(pageNumber, totalPages) {
    const footerY = 14;
    const footerLabel = "Scoreon Addon";
    const footerPage = `${pageNumber} / ${totalPages}`;
    const pageX = Math.max(margin, pageW - margin - 26);

    return [
      "BT\n",
      "/F1 9 Tf\n",
      "0.45 0.45 0.45 rg\n",
      `1 0 0 1 ${margin.toFixed(2)} ${footerY.toFixed(2)} Tm\n`,
      `(${pdfEscape(footerLabel)}) Tj\n`,
      "ET\n",
      "BT\n",
      "/F1 9 Tf\n",
      "0.45 0.45 0.45 rg\n",
      `1 0 0 1 ${pageX.toFixed(2)} ${footerY.toFixed(2)} Tm\n`,
      `(${pdfEscape(footerPage)}) Tj\n`,
      "ET\n"
    ].join("");
  }

  function materializePdfPage(content, xObjects, pageNumber, totalPages) {
    const fullContent = `${content}${buildFooterContent(pageNumber, totalPages)}`;
    const contentBytes = textBytes(fullContent);
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

        content += ["q\n", `${titleDrawW.toFixed(2)} 0 0 ${titleDrawH.toFixed(2)} ${titleX.toFixed(2)} ${titleY.toFixed(2)} cm\n`, `/${titleRef.name} Do\n`, "Q\n"].join("");
        pageXObjects.push(titleRef);
        topY = titleY - 18;
        availableH -= titleDrawH + 18;
      }

      if (labelRef) {
        const labelDrawW = availableW;
        const labelDrawH = Math.min(32, labelRef.frame.height * (labelDrawW / labelRef.frame.width));
        const labelX = margin;
        const labelY = topY - labelDrawH;

        content += ["q\n", `${labelDrawW.toFixed(2)} 0 0 ${labelDrawH.toFixed(2)} ${labelX.toFixed(2)} ${labelY.toFixed(2)} cm\n`, `/${labelRef.name} Do\n`, "Q\n"].join("");
        pageXObjects.push(labelRef);
        topY = labelY - 8;
        availableH -= labelDrawH + 8;
      }

      const scale = Math.min(availableW / frame.width, availableH / frame.height);
      const drawW = frame.width * scale;
      const drawH = frame.height * scale;
      const x = (pageW - drawW) / 2;
      const y = margin + (availableH - drawH) / 2;

      content += ["q\n", `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n`, `/${img.name} Do\n`, "Q\n"].join("");
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

      content += ["q\n", `${titleDrawW.toFixed(2)} 0 0 ${titleDrawH.toFixed(2)} ${titleX.toFixed(2)} ${titleY.toFixed(2)} cm\n`, `/${titleRef.name} Do\n`, "Q\n"].join("");
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
        content += ["q\n", `${labelDrawW.toFixed(2)} 0 0 ${labelDrawH.toFixed(2)} ${labelX.toFixed(2)} ${labelY.toFixed(2)} cm\n`, `/${labelRef.name} Do\n`, "Q\n"].join("");
        xObjects.push(labelRef);
        currentY = labelY - labelGap;
      }

      const x = (pageW - drawW) / 2;
      const imageY = currentY - drawH;
      content += ["q\n", `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${imageY.toFixed(2)} cm\n`, `/${img.name} Do\n`, "Q\n"].join("");
      xObjects.push(img);
      yCursor = imageY - gap;
    }

    flushPage();
  }

  for (let i = 0; i < pendingPages.length; i++) {
    const page = pendingPages[i];
    materializePdfPage(page.content, page.xObjects, i + 1, pendingPages.length);
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
  const xrefLines = ["xref\n", `0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (let i = 1; i < offsets.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }

  xrefLines.push("trailer\n", `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`, "startxref\n", `${xrefOffset}\n`, "%%EOF\n");
  parts.push(textBytes(xrefLines.join("")));
  return new Blob([concatBytes(parts)], { type: "application/pdf" });
}
