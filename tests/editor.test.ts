import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cropRect,
  defaults,
  dimensions,
  durationOf,
  formatTime,
  textLayout,
  type Edit,
} from "../src/editor.ts";

test("Original canvas keeps the uploaded dimensions; presets remain even and correctly proportioned", () => {
  assert.deepEqual(dimensions(defaults, { width: 1200, height: 1600 }), {
    width: 1200,
    height: 1600,
  });
  const ratio = dimensions(
    { ...defaults, ratio: "9:16", resolution: "1080" },
    { width: 1920, height: 1080 },
  );
  assert.equal(ratio.height, 1080);
  assert.ok(Math.abs(ratio.width / ratio.height - 9 / 16) < 0.001);
  assert.equal(ratio.width % 2, 0);
  assert.equal(ratio.height % 2, 0);
});
test("Every pan position fills the canvas without revealing a blank edge", () => {
  for (const [sw, sh] of [
    [1920, 1080],
    [400, 1600],
    [1200, 1200],
  ]) {
    for (const zoom of [1, 1.5, 3])
      for (const panX of [0, 0.5, 1])
        for (const panY of [0, 0.5, 1]) {
          const r = cropRect(1080, 1920, sw, sh, {
            ...defaults,
            zoom,
            panX,
            panY,
          });
          assert.ok(r.x <= 0.001 && r.y <= 0.001);
          assert.ok(r.x + r.width >= 1079.999 && r.y + r.height >= 1919.999);
        }
  }
});
test("Video selection controls export duration independently of photo duration", () => {
  const edit = {
    ...defaults,
    trimStart: 3.25,
    trimEnd: 8.75,
    photoDuration: 12,
  };
  assert.equal(
    durationOf(edit, { kind: "video" } as Parameters<typeof durationOf>[1]),
    5.5,
  );
  assert.equal(durationOf(edit, null), 12);
});
test("Long words, newlines, and Nepali captions wrap without overflowing", () => {
  const ctx = {
    font: "",
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
  } as unknown as CanvasRenderingContext2D;
  for (const caption of [
    "Teska Baje Ko Sparkling water",
    "नेपालको चिसो पानी",
    "A".repeat(100),
    "Line one\nLine two",
  ]) {
    const edit: Edit = { ...defaults, caption, textX: 0, textY: 0 };
    const box = textLayout(ctx, 200, 1000, edit);
    assert.ok(box.lines.length >= 1);
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.x + box.width <= 200);
    for (const line of box.lines)
      assert.ok(ctx.measureText(line).width <= 200 * 0.86);
  }
});
test("Time display handles boundaries and invalid metadata", () => {
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(256.05), "4:16");
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime(Infinity), "0:00");
  assert.equal(formatTime(3.5, true), "0:03.5");
});
