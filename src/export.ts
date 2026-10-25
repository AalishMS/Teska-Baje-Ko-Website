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
  WebMOutputFormat,
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
        if (!(await track.canDecode()))
          throw new Error(
            "This browser cannot read the original video sound. Set its volume to zero, or try a different browser.",
          );
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
async function recordFallback(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement | null,
  edit: Edit,
  media: Media,
  audio: AudioBuffer | null,
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  const mime = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ].find(
    (t) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
  );
  if (!mime || !canvas.captureStream)
    throw new Error(
      "Video export is unavailable in this browser. Try the latest Chrome, Edge, or Safari.",
    );
  const ctx = canvas.getContext("2d")!,
    stream = canvas.captureStream(24),
    duration = durationOf(edit, media);
  let audioCtx: AudioContext | null = null,
    audioSrc: globalThis.AudioBufferSourceNode | null = null,
    video: HTMLVideoElement | null = null;
  let recorder: MediaRecorder | null = null;
  try {
    if (audio) {
      audioCtx = new AudioContext();
      await audioCtx.resume();
      const dest = audioCtx.createMediaStreamDestination();
      audioSrc = audioCtx.createBufferSource();
      audioSrc.buffer = audio;
      audioSrc.connect(dest);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    }
    if (media.kind === "video") {
      video = await sourceVideo(media);
      await seek(video, edit.trimStart);
    }
    render(ctx, video || image, media.width, media.height, edit);
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 6_000_000,
    });
    const done = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder!.onstop = () =>
        resolve(new Blob(chunks, { type: mime.split(";")[0] }));
      recorder!.onerror = () =>
        reject(new Error("Recording failed. Please try again."));
    });
    recorder.start();
    audioSrc?.start();
    if (video) await video.play();
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const frame = () => {
        if (signal.aborted) {
          reject(new DOMException("Export cancelled", "AbortError"));
          return;
        }
        const elapsed = (performance.now() - start) / 1000;
        render(ctx, video || image, media.width, media.height, edit);
        progress(0.1 + 0.85 * Math.min(1, elapsed / duration));
        if (elapsed >= duration) resolve();
        else requestAnimationFrame(frame);
      };
      frame();
    });
    recorder.stop();
    return await done;
  } finally {
    if (recorder?.state === "recording") recorder.stop();
    video?.pause();
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
    stream.getTracks().forEach((track) => track.stop());
    if (audioCtx) await audioCtx.close();
  }
}
export async function exportVideo(
  media: Media,
  edit: Edit,
  image: HTMLImageElement | null,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<Blob> {
  await document.fonts.ready;
  checkAbort(signal);
  const { width, height } = dimensions(edit, media);
  if (width > 4096 || height > 4096)
    throw new Error(
      "Choose 1080p or 720p in Frame settings to export this large file.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  progress(0.02);
  const audio = await mixedAudio(edit, media, signal);
  checkAbort(signal);
  progress(0.1);
  const isMp4 = await canEncodeVideo("avc", { width, height, frameRate: 24 });
  const hasWebm = isMp4
    ? false
    : await canEncodeVideo("vp9", { width, height, frameRate: 24 });
  if (!isMp4 && !hasWebm)
    return recordFallback(canvas, image, edit, media, audio, signal, progress);
  if (isMp4 && audio && !(await canEncodeAudio("aac"))) registerAacEncoder();
  const target = new BufferTarget();
  const output = new Output({
    target,
    format: isMp4
      ? new Mp4OutputFormat({ fastStart: "in-memory" })
      : new WebMOutputFormat(),
  });
  const frames = new CanvasSource(canvas, {
    codec: isMp4 ? "avc" : "vp9",
    quality: new Quality("high"),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(frames, { frameRate: 24 });
  let audioSource: AudioBufferSource | null = null;
  if (audio) {
    audioSource = new AudioBufferSource({
      codec: isMp4 ? "aac" : "opus",
      quality: new Quality({ bitrate: 128000 }),
    });
    output.addAudioTrack(audioSource);
  }
  let input: Input | null = null,
    fallback: HTMLVideoElement | null = null;
  let iterator: AsyncGenerator<
    { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
    void,
    unknown
  > | null = null;
  let completed = false;
  try {
    const duration = durationOf(edit, media),
      count = Math.ceil(duration * 24);
    if (media.kind === "video") {
      input = new Input({
        source: new BlobSource(media.file),
        formats: ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const sink = new CanvasSink(track, { poolSize: 2 });
        iterator = sink.canvasesAtTimestamps(
          Array.from({ length: count }, (_, i) =>
            Math.min(edit.trimEnd - 0.001, edit.trimStart + i / 24),
          ),
        );
      } else {
        fallback = await sourceVideo(media);
      }
    }
    await output.start();
    if (audioSource && audio) {
      await audioSource.add(audio);
      audioSource.close();
    }
    for (let i = 0; i < count; i++) {
      checkAbort(signal);
      let source: Drawable | null = image;
      if (iterator) {
        const next = await iterator.next();
        if (next.done || !next.value)
          throw new Error(
            "A video frame could not be decoded. Try trimming the clip or using a different MP4.",
          );
        source = next.value.canvas;
      } else if (fallback) {
        await seek(
          fallback,
          Math.min(edit.trimEnd - 0.001, edit.trimStart + i / 24),
        );
        source = fallback;
      }
      if (i === 0 || media.kind === "video")
        render(ctx, source, media.width, media.height, edit);
      await frames.add(i / 24, Math.min(1 / 24, duration - i / 24));
      if (i % 4 === 0) {
        progress(0.1 + (0.85 * i) / count);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    frames.close();
    checkAbort(signal);
    await output.finalize();
    completed = true;
    progress(1);
    return new Blob([target.buffer!], {
      type: isMp4 ? "video/mp4" : "video/webm",
    });
  } finally {
    await iterator?.return();
    input?.dispose();
    if (fallback) {
      fallback.pause();
      fallback.removeAttribute("src");
      fallback.load();
    }
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
