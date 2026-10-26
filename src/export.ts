import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import {
  dimensions,
  durationOf,
  render,
  type Drawable,
  type Edit,
  type Media,
} from "./editor";

let musicPromise: Promise<AudioBuffer> | undefined;
async function musicBuffer() {
  if (!musicPromise)
    musicPromise = (async () => {
      const res = await fetch("/audio/teska-baje.m4a");
      if (!res.ok)
        throw new Error(
          "The song could not load. Check your connection and try again.",
        );
      const ctx = new AudioContext();
      try {
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } finally {
        await ctx.close();
      }
    })().catch((error) => {
      musicPromise = undefined;
      throw error;
    });
  return musicPromise;
}
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
}
async function mixedAudio(edit: Edit, media: Media, signal: AbortSignal) {
  if (
    edit.songVolume === 0 &&
    (media.kind !== "video" || edit.originalVolume === 0)
  )
    return null;
  const duration = durationOf(edit, media);
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
  if (edit.songVolume > 0) {
    const music = await musicBuffer();
    checkAbort(signal);
    const src = ctx.createBufferSource();
    src.buffer = music;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = edit.songVolume;
    src.connect(gain).connect(ctx.destination);
    src.start(0, edit.audioStart % music.duration);
    src.stop(duration);
  }
  if (media.kind === "video" && edit.originalVolume > 0) {
    const input = new Input({
      source: new BlobSource(media.file),
      formats: ALL_FORMATS,
    });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (track) {
        if (!(await track.canDecode())) {
          // HTML audio decoding also works on HTTP, where WebCodecs is unavailable.
          const decoder = new AudioContext();
          let buffer: AudioBuffer;
          try {
            buffer = await decoder.decodeAudioData(
              await media.file.arrayBuffer(),
            );
          } catch {
            throw new Error(
              "Cannot read the video sound. Set its volume to zero and try again.",
            );
          } finally {
            await decoder.close();
          }
          checkAbort(signal);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.value = edit.originalVolume;
          source.connect(gain).connect(ctx.destination);
          if (edit.trimStart < buffer.duration)
            source.start(
              0,
              edit.trimStart,
              Math.min(duration, buffer.duration - edit.trimStart),
            );
        } else {
          const sink = new AudioBufferSink(track);
          const gain = ctx.createGain();
          gain.gain.value = edit.originalVolume;
          gain.connect(ctx.destination);
          for await (const wrapped of sink.buffers(
            edit.trimStart,
            edit.trimEnd,
          )) {
            checkAbort(signal);
            const start = Math.max(edit.trimStart, wrapped.timestamp),
              end = Math.min(
                edit.trimEnd,
                wrapped.timestamp + wrapped.buffer.duration,
              );
            if (end <= start) continue;
            const src = ctx.createBufferSource();
            src.buffer = wrapped.buffer;
            src.connect(gain);
            src.start(
              start - edit.trimStart,
              start - wrapped.timestamp,
              end - start,
            );
          }
        }
      }
    } finally {
      input.dispose();
    }
  }
  checkAbort(signal);
  return ctx.startRendering();
}
function seek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("The video could not be read. Try an MP4 file."));
    }, 12000);
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("The video could not be read. Try an MP4 file."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = time;
  });
}
async function sourceVideo(media: Media) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () =>
      reject(
        new Error(
          "This video format cannot be read by your browser. Try an MP4 file.",
        ),
      );
    video.src = media.url;
  });
  return video;
}
// Still photos have no motion; one frame per second preserves the image
// while avoiding 24 identical encodes per second. Videos retain 24 fps.
function frameRateFor(media: Media) {
  return media.kind === "image" ? 1 : 24;
}
async function* sourceFrames(
  media: Media,
  edit: Edit,
  image: HTMLImageElement | null,
  count: number,
  signal: AbortSignal,
): AsyncGenerator<Drawable> {
  const frameRate = frameRateFor(media);
  let input: Input | null = null,
    video: HTMLVideoElement | null = null;
  let iterator: AsyncGenerator<
    { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
    void,
    unknown
  > | null = null;
  try {
    if (media.kind === "video") {
      input = new Input({
        source: new BlobSource(media.file),
        formats: ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const first = await track.getFirstTimestamp();
        iterator = new CanvasSink(track, { poolSize: 2 }).canvasesAtTimestamps(
          Array.from({ length: count }, (_, i) =>
            Math.max(
              first,
              Math.min(edit.trimEnd - 0.001, edit.trimStart + i / frameRate),
            ),
          ),
        );
      } else video = await sourceVideo(media);
    }
    for (let i = 0; i < count; i++) {
      checkAbort(signal);
      if (iterator) {
        const next = await iterator.next();
        if (next.done || !next.value)
          throw new Error("Cannot read this video frame. Try a different MP4.");
        yield next.value.canvas;
      } else if (video) {
        await seek(
          video,
          Math.min(edit.trimEnd - 0.001, edit.trimStart + i / frameRate),
        );
        yield video;
      } else if (image) yield image;
      else throw new Error("No photo or video is available to export.");
    }
  } finally {
    await iterator?.return();
    input?.dispose();
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }
}
async function softwareVideo(
  canvas: HTMLCanvasElement,
  media: Media,
  edit: Edit,
  image: HTMLImageElement | null,
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  // Loaded only if native H.264 encoding is unavailable, including HTTP phone previews.
  const frameRate = frameRateFor(media);
  const HME = await import("h264-mp4-encoder");
  const encoder = await HME.createH264MP4Encoder();
  const count = Math.ceil(durationOf(edit, media) * frameRate);
  try {
    encoder.width = canvas.width;
    encoder.height = canvas.height;
    encoder.frameRate = frameRate;
    encoder.quantizationParameter = 22;
    encoder.speed = 5;
    encoder.groupOfPictures = frameRate * 2;
    encoder.initialize();
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let i = 0;
    let pixels: Uint8ClampedArray | null = null;
    for await (const source of sourceFrames(
      media,
      edit,
      image,
      count,
      signal,
    )) {
      checkAbort(signal);
      if (!pixels || media.kind === "video") {
        render(ctx, source, media.width, media.height, edit);
        pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      encoder.addFrameRgba(pixels);
      progress(0.1 + (0.75 * ++i) / count);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkAbort(signal);
    encoder.finalize();
    return new Blob(
      [new Uint8Array(encoder.FS.readFile(encoder.outputFilename)).buffer],
      { type: "video/mp4" },
    );
  } finally {
    try {
      encoder.FS.unlink(encoder.outputFilename);
    } catch {
      /* Failed initialization may not create a file. */
    }
    encoder.delete();
  }
}
export async function exportVideo(
  media: Media,
  edit: Edit,
  image: HTMLImageElement | null,
  signal: AbortSignal,
  progress: (value: number) => void,
  onStatus: (message: string) => void = () => {},
): Promise<Blob> {
  await document.fonts.ready;
  checkAbort(signal);
  const { width, height } = dimensions(edit, media);
  if (width > 4096 || height > 4096)
    throw new Error("Choose 1080p or 720p in Frame to export this file.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const frameRate = frameRateFor(media);
  onStatus("Checking video support…");
  const native = await canEncodeVideo("avc", { width, height, frameRate });
  onStatus(
    native
      ? "Preparing audio…"
      : "Preparing audio · software encoding will take longer…",
  );
  progress(0.02);
  const audio = await mixedAudio(edit, media, signal);
  checkAbort(signal);
  progress(0.1);
  if (audio && !(await canEncodeAudio("aac"))) registerAacEncoder();
  const duration = durationOf(edit, media),
    count = Math.ceil(duration * frameRate);
  onStatus(
    native
      ? "Making your video…"
      : "Software encoding · this takes longer…",
  );
  let encoded: Blob | null = null;
  if (!native)
    encoded = await softwareVideo(canvas, media, edit, image, signal, progress);
  checkAbort(signal);
  const target = new BufferTarget();
  const output = new Output({
    target,
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
  });
  const frames = native
    ? new CanvasSource(canvas, {
        codec: "avc",
        quality: new Quality("high"),
        keyFrameInterval: 2,
      })
    : null;
  const packets = frames ? null : new EncodedVideoPacketSource("avc");
  output.addVideoTrack(frames || packets!, { frameRate });
  const audioSource = audio
    ? new AudioBufferSource({
        codec: "aac",
        quality: new Quality({ bitrate: 128000 }),
      })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  let input: Input | null = null,
    completed = false;
  try {
    await output.start();
    if (audio && audioSource) {
      await audioSource.add(audio);
      audioSource.close();
    }
    if (frames) {
      const ctx = canvas.getContext("2d")!;
      let i = 0;
      for await (const source of sourceFrames(
        media,
        edit,
        image,
        count,
        signal,
      )) {
        checkAbort(signal);
        if (i === 0 || media.kind === "video")
          render(ctx, source, media.width, media.height, edit);
        await frames.add(
          i / frameRate,
          Math.min(1 / frameRate, duration - i / frameRate),
        );
        progress(0.1 + (0.85 * ++i) / count);
        if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      frames.close();
    } else {
      input = new Input({
        source: new BlobSource(encoded!),
        formats: ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("MP4 encoding failed. Try saving again.");
      const decoderConfig = await track.getDecoderConfig();
      if (!decoderConfig)
        throw new Error("MP4 encoding failed. Try saving again.");
      for await (const packet of new EncodedPacketSink(track).packets()) {
        checkAbort(signal);
        await packets!.add(
          packet.clone({
            duration: Math.min(
              packet.duration,
              Math.max(0, duration - packet.timestamp),
            ),
          }),
          { decoderConfig },
        );
      }
      packets!.close();
      progress(0.95);
    }
    checkAbort(signal);
    onStatus("Finishing MP4…");
    await output.finalize();
    completed = true;
    progress(1);
    return new Blob([target.buffer!], { type: "video/mp4" });
  } finally {
    input?.dispose();
    if (!completed) await output.cancel().catch(() => {});
  }
}
export async function exportImage(media: Media, edit: Edit, source: Drawable) {
  await document.fonts.ready;
  const { width, height } = dimensions(edit, media);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  render(canvas.getContext("2d")!, source, media.width, media.height, edit);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Image export failed. Try a smaller size.")),
      "image/png",
    ),
  );
}
