export type Ratio = "original" | "9:16" | "1:1" | "4:5" | "16:9" | "4:3";
export type FontId = "classic" | "serif" | "condensed" | "hand";
export const fonts: Record<FontId, { name: string; family: string }> = {
  classic: {
    name: "Classic",
    family:
      'Arimo, "Noto Sans Devanagari", "Apple Color Emoji", "Segoe UI Emoji", "Noto Emoji", sans-serif',
  },
  serif: {
    name: "Serif",
    family:
      '"Libre Baskerville", "Noto Sans Devanagari", "Apple Color Emoji", "Segoe UI Emoji", "Noto Emoji", serif',
  },
  condensed: {
    name: "Condensed",
    family:
      'Oswald, "Noto Sans Devanagari", "Apple Color Emoji", "Segoe UI Emoji", "Noto Emoji", sans-serif',
  },
  hand: {
    name: "Handwritten",
    family:
      'Kalam, "Noto Sans Devanagari", "Apple Color Emoji", "Segoe UI Emoji", "Noto Emoji", cursive',
  },
};
export interface Edit {
  caption: string;
  font: FontId;
  color: string;
  size: number;
  outline: boolean;
  shadow: boolean;
  align: "left" | "center" | "right";
  textX: number;
  textY: number;
  ratio: Ratio;
  zoom: number;
  panX: number;
  panY: number;
  photoDuration: number;
  trimStart: number;
  trimEnd: number;
  audioStart: number;
  songVolume: number;
  originalVolume: number;
  resolution: "source" | "1080" | "720";
}
export const defaults: Edit = {
  caption: "Teska Baje Ko ",
  font: "classic",
  color: "#ffffff",
  size: 6.5,
  outline: true,
  shadow: false,
  align: "center",
  textX: 0.5,
  textY: 0.24,
  ratio: "original",
  zoom: 1,
  panX: 0.5,
  panY: 0.5,
  photoDuration: 10,
  trimStart: 0,
  trimEnd: 10,
  audioStart: 0,
  songVolume: 1,
  originalVolume: 0,
  resolution: "source",
};
export interface Media {
  file: File;
  url: string;
  kind: "image" | "video";
  width: number;
  height: number;
  duration: number;
}
export type Drawable =
  HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas;
export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export const durationOf = (edit: Edit, media: Media | null) =>
  media?.kind === "video"
    ? Math.max(0.1, edit.trimEnd - edit.trimStart)
    : edit.photoDuration;
export function formatTime(seconds: number, decimal = false) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}${decimal ? "." + Math.floor((s * 10) % 10) : ""}`;
}
export function dimensions(
  edit: Edit,
  media: Pick<Media, "width" | "height"> | null,
) {
  const original = media || { width: 1080, height: 1920 };
  const ratio =
    edit.ratio === "original"
      ? original.width / original.height
      : Number(edit.ratio.split(":")[0]) / Number(edit.ratio.split(":")[1]);
  const longEdge =
    edit.resolution === "source"
      ? Math.max(original.width, original.height)
      : Number(edit.resolution);
  // Video encoders need even pixel dimensions.
  return {
    width: Math.max(
      2,
      Math.round((ratio >= 1 ? longEdge : longEdge * ratio) / 2) * 2,
    ),
    height: Math.max(
      2,
      Math.round((ratio >= 1 ? longEdge / ratio : longEdge) / 2) * 2,
    ),
  };
}
export function cropRect(
  w: number,
  h: number,
  sw: number,
  sh: number,
  edit: Edit,
) {
  const scale = Math.max(w / sw, h / sh) * edit.zoom;
  const width = sw * scale,
    height = sh * scale;
  return {
    x: -(width - w) * edit.panX,
    y: -(height - h) * edit.panY,
    width,
    height,
  };
}
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lines: string[];
}
export function textLayout(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  edit: Edit,
): TextBox {
  const fontSize = (width * edit.size) / 100;
  ctx.font = `700 ${fontSize}px ${fonts[edit.font].family}`;
  const maxWidth = width * 0.86;
  const lines: string[] = [];
  for (const paragraph of edit.caption.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/u)) {
      if (ctx.measureText((line ? line + " " : "") + word).width <= maxWidth) {
        line += (line ? " " : "") + word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  const actualWidth = Math.min(
    width * 0.94,
    Math.max(fontSize, ...lines.map((line) => ctx.measureText(line).width)) +
      fontSize * 0.3,
  );
  const actualHeight = lines.length * fontSize * 1.3;
  return {
    x: clamp(
      edit.textX * width - actualWidth / 2,
      0,
      Math.max(0, width - actualWidth),
    ),
    y: clamp(
      edit.textY * height - actualHeight / 2,
      0,
      Math.max(0, height - actualHeight),
    ),
    width: actualWidth,
    height: actualHeight,
    fontSize,
    lines,
  };
}
export function render(
  ctx: CanvasRenderingContext2D,
  source: Drawable | null,
  sw: number,
  sh: number,
  edit: Edit,
  guides = false,
  selected = false,
  hideCaption = false,
): TextBox {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#e9e9e6";
  ctx.fillRect(0, 0, w, h);
  if (source) {
    const r = cropRect(w, h, sw, sh, edit);
    ctx.drawImage(source, r.x, r.y, r.width, r.height);
  }
  const box = textLayout(ctx, w, h, edit);
  if (source && edit.caption.trim() && !hideCaption) {
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = edit.align;
    ctx.lineJoin = "round";
    ctx.fillStyle = edit.color;
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = box.fontSize * 0.09;
    if (edit.shadow) {
      ctx.shadowColor = "rgba(0,0,0,.7)";
      ctx.shadowBlur = box.fontSize * 0.2;
      ctx.shadowOffsetY = box.fontSize * 0.06;
    }
    const x =
      edit.align === "left"
        ? box.x + box.fontSize * 0.15
        : edit.align === "right"
          ? box.x + box.width - box.fontSize * 0.15
          : box.x + box.width / 2;
    box.lines.forEach((line, i) => {
      const y = box.y + box.fontSize * 1.3 * (i + 0.5);
      if (edit.outline) ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
    });
    ctx.restore();
  }
  if (guides) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.lineWidth = w / 550;
    ctx.setLineDash([w / 80, w / 100]);
    for (const p of [1 / 3, 0.5, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(w * p, 0);
      ctx.lineTo(w * p, h);
      ctx.moveTo(0, h * p);
      ctx.lineTo(w, h * p);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (selected && source && edit.caption.trim()) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = w / 550;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    const s = w / 50;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#333";
    ctx.fillRect(box.x + box.width - s / 2, box.y + box.height - s / 2, s, s);
    ctx.strokeRect(box.x + box.width - s / 2, box.y + box.height - s / 2, s, s);
    ctx.restore();
  }
  return box;
}
