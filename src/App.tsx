import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Crop,
  Expand,
  ImagePlus,
  Info,
  LoaderCircle,
  Maximize,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Type,
  Upload,
  X,
} from "lucide-react";
import {
  clamp,
  defaults,
  dimensions,
  durationOf,
  fonts,
  formatTime,
  render,
  type Edit,
  type FontId,
  type Media,
  type Ratio,
  type TextBox,
} from "./editor";
import waveform from "./waveform.json";

type Tab = "text" | "frame" | "audio";
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type Result = { blob: Blob; url: string; file: File };
const ratios: { value: Ratio; label: string; hint: string }[] = [
  { value: "original", label: "Original", hint: "Keep your size" },
  { value: "9:16", label: "9:16", hint: "Stories & reels" },
  { value: "1:1", label: "1:1", hint: "Square" },
  { value: "4:5", label: "4:5", hint: "Portrait" },
  { value: "16:9", label: "16:9", hint: "Landscape" },
  { value: "4:3", label: "4:3", hint: "Classic" },
];
const colors = [
  "#ffffff",
  "#171717",
  "#ffe45c",
  "#f55959",
  "#f197cc",
  "#78b9fa",
];
function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  display?: string;
}) {
  return (
    <label className="slider-field">
      <span>
        <span>{label}</span>
        <output>{display ?? value}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export default function App() {
  const [edit, setEdit] = useState<Edit>({ ...defaults });
  const [media, setMedia] = useState<Media | null>(null);
  const [tab, setTab] = useState<Tab>("text");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [songDuration, setSongDuration] = useState(256.05);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [help, setHelp] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(
    window.matchMedia("(display-mode: standalone)").matches,
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [format, setFormat] = useState<"video" | "image">("video");
  const [result, setResult] = useState<Result | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    audioRef = useRef<HTMLAudioElement>(null);
  const sourceRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null),
    mediaRef = useRef<Media | null>(null),
    binRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<TextBox | null>(null),
    controllerRef = useRef<AbortController | null>(null),
    loadId = useRef(0),
    playingRef = useRef(false);
  const resultRef = useRef<Result | null>(null);
  const pointerRef = useRef<{
    kind: "text" | "resize" | "pan";
    x: number;
    y: number;
    edit: Edit;
    box: TextBox;
  } | null>(null);
  const duration = durationOf(edit, media),
    size = dimensions(edit, media);
  const previewScale = Math.min(1, 1200 / Math.max(size.width, size.height));
  const pw = Math.round(size.width * previewScale),
    ph = Math.round(size.height * previewScale);
  const video =
    sourceRef.current instanceof HTMLVideoElement ? sourceRef.current : null;

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    if (sourceRef.current instanceof HTMLVideoElement)
      sourceRef.current.pause();
  }, []);
  const invalidate = useCallback(() => {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = null;
    setResult(null);
    setNotice("");
  }, []);
  const change = useCallback(
    (patch: Partial<Edit>) => {
      stop();
      setEdit((e) => ({ ...e, ...patch }));
      invalidate();
      setError("");
    },
    [stop, invalidate],
  );

  useEffect(() => {
    const before = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };
    const installedHandler = () => {
      setInstalled(true);
      setInstallEvent(null);
      setInstallHelp(false);
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);
  useEffect(() => {
    let live = true;
    document.fonts
      .load(
        `700 24px ${fonts[edit.font].family}`,
        edit.caption || "Teska Baje Ko",
      )
      .then(() => {
        if (live) setFontsReady((version) => version + 1);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [edit.font, edit.caption]);
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      audioRef.current?.pause();
      if (mediaRef.current) URL.revokeObjectURL(mediaRef.current.url);
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [busy]);
  useEffect(() => {
    stop();
    setTime(0);
    if (sourceRef.current instanceof HTMLVideoElement)
      sourceRef.current.currentTime = edit.trimStart;
    const maxStart = Math.max(
      0,
      songDuration - Math.min(duration, songDuration),
    );
    setEdit((current) =>
      current.audioStart > maxStart
        ? { ...current, audioStart: maxStart }
        : current,
    );
  }, [
    media,
    edit.trimStart,
    edit.trimEnd,
    edit.photoDuration,
    songDuration,
    duration,
    stop,
  ]);
  useEffect(() => {
    let animation = 0,
      live = true;
    const ctx = canvasRef.current?.getContext("2d");
    const startTime = performance.now(),
      startOffset = time;
    const draw = () => {
      if (!ctx || !live) return;
      boxRef.current = render(
        ctx,
        sourceRef.current,
        media?.width || 1080,
        media?.height || 1920,
        edit,
        dragging,
        tab === "text" && !busy,
      );
      if (playingRef.current) {
        const source = sourceRef.current;
        const t =
          source instanceof HTMLVideoElement
            ? source.currentTime - edit.trimStart
            : startOffset + (performance.now() - startTime) / 1000;
        if (
          t >= duration - 0.025 ||
          (source instanceof HTMLVideoElement && source.ended)
        ) {
          stop();
          setTime(duration);
          return;
        }
        setTime(Math.max(0, t));
        const audio = audioRef.current;
        if (audio && edit.songVolume > 0 && audio.readyState >= 2) {
          const expected = (edit.audioStart + t) % songDuration;
          if (Math.abs(audio.currentTime - expected) > 0.3)
            audio.currentTime = expected;
        }
        animation = requestAnimationFrame(draw);
      }
    };
    const clip =
      sourceRef.current instanceof HTMLVideoElement ? sourceRef.current : null;
    const onSeek = () => {
      if (!playingRef.current) draw();
    };
    clip?.addEventListener("seeked", onSeek);
    draw();
    return () => {
      live = false;
      cancelAnimationFrame(animation);
      clip?.removeEventListener("seeked", onSeek);
    };
    // Time is advanced by the animation; restarting it every frame would reset the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    edit,
    media,
    playing,
    dragging,
    tab,
    busy,
    fontsReady,
    duration,
    pw,
    ph,
    stop,
    songDuration,
  ]);

  async function loadFile(file: File | undefined) {
    if (!file || busy) return;
    const kind =
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name)
        ? "image"
        : file.type.startsWith("video/") ||
            /\.(mp4|mov|webm|m4v)$/i.test(file.name)
          ? "video"
          : null;
    if (!kind) {
      setError("Choose a photo (JPG, PNG, WebP) or a video (MP4, MOV, WebM).");
      return;
    }
    const id = ++loadId.current;
    stop();
    setLoading(true);
    setError("");
    setNotice("");
    const url = URL.createObjectURL(file);
    let source: HTMLImageElement | HTMLVideoElement | null = null;
    try {
      let width: number,
        height: number,
        length = 0;
      if (kind === "image") {
        const image = new Image();
        image.src = url;
        await image.decode();
        source = image;
        width = image.naturalWidth;
        height = image.naturalHeight;
      } else {
        const clip = document.createElement("video");
        clip.playsInline = true;
        clip.preload = "auto";
        clip.muted = true;
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            cleanup();
            reject(
              new Error("The video took too long to open. Try a smaller MP4."),
            );
          }, 20000);
          const cleanup = () => {
            clearTimeout(timer);
            clip.onloadeddata = null;
            clip.onerror = null;
          };
          clip.onloadeddata = () => {
            cleanup();
            resolve();
          };
          clip.onerror = () => {
            cleanup();
            reject(
              new Error(
                "Your browser cannot open this video. Try an MP4 with H.264 video.",
              ),
            );
          };
          clip.src = url;
        });
        source = clip;
        width = clip.videoWidth;
        height = clip.videoHeight;
        length = clip.duration;
        if (!Number.isFinite(length) || length <= 0)
          throw new Error(
            "This video has no readable duration. Try another file.",
          );
      }
      if (width <= 0 || height <= 0)
        throw new Error(
          "This file has no readable image. Try another photo or video.",
        );
      if (id !== loadId.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (sourceRef.current instanceof HTMLVideoElement) {
        sourceRef.current.pause();
        sourceRef.current.removeAttribute("src");
        sourceRef.current.load();
      }
      if (mediaRef.current) URL.revokeObjectURL(mediaRef.current.url);
      const next: Media = { file, url, kind, width, height, duration: length };
      sourceRef.current = source;
      mediaRef.current = next;
      setMedia(next);
      setTime(0);
      invalidate();
      if (source instanceof HTMLVideoElement)
        binRef.current?.replaceChildren(source);
      else binRef.current?.replaceChildren();
      setEdit((e) => ({
        ...e,
        ratio: "original",
        zoom: 1,
        panX: 0.5,
        panY: 0.5,
        trimStart: 0,
        trimEnd: length || 10,
      }));
      if (kind === "video") setFormat("video");
    } catch (err) {
      URL.revokeObjectURL(url);
      if (source instanceof HTMLVideoElement) {
        source.removeAttribute("src");
        source.load();
      }
      if (id === loadId.current)
        setError(
          err instanceof Error
            ? err.message
            : "This file could not be opened. Try a JPG or MP4.",
        );
    } finally {
      if (id === loadId.current) {
        setLoading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }
  async function togglePlay() {
    if (!media || busy) return;
    if (playingRef.current) {
      stop();
      return;
    }
    const offset = time >= duration - 0.05 ? 0 : time;
    setTime(offset);
    setError("");
    try {
      const promises: Promise<void>[] = [];
      if (video) {
        video.currentTime = edit.trimStart + offset;
        video.volume = edit.originalVolume;
        video.muted = edit.originalVolume === 0;
        promises.push(video.play());
      }
      if (audioRef.current && edit.songVolume > 0) {
        const audio = audioRef.current;
        audio.currentTime = (edit.audioStart + offset) % songDuration;
        audio.volume = edit.songVolume;
        promises.push(audio.play());
      }
      await Promise.all(promises);
      playingRef.current = true;
      setPlaying(true);
    } catch {
      stop();
      setError(
        "Playback could not start. Try pressing play again or check that this file plays on your device.",
      );
    }
  }
  function scrub(value: number) {
    stop();
    setTime(value);
    if (video) video.currentTime = edit.trimStart + value;
    if (audioRef.current && audioRef.current.readyState >= 1)
      audioRef.current.currentTime = (edit.audioStart + value) % songDuration;
  }
  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * pw,
      y: ((event.clientY - rect.top) / rect.height) * ph,
    };
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!media || busy || !boxRef.current) return;
    const p = point(event),
      box = boxRef.current,
      touch = pw * 0.045;
    const resize =
      tab === "text" &&
      Math.abs(p.x - box.x - box.width) < touch &&
      Math.abs(p.y - box.y - box.height) < touch;
    const text =
      p.x >= box.x - touch &&
      p.x <= box.x + box.width + touch &&
      p.y >= box.y - touch &&
      p.y <= box.y + box.height + touch &&
      edit.caption.trim();
    const kind = resize
      ? "resize"
      : text && tab !== "frame"
        ? "text"
        : tab === "frame"
          ? "pan"
          : null;
    if (!kind) return;
    stop();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { kind, ...p, edit: { ...edit }, box };
    setDragging(true);
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = pointerRef.current;
    if (!drag || !media) return;
    const p = point(event),
      dx = p.x - drag.x,
      dy = p.y - drag.y;
    if (drag.kind === "text") {
      let x = (drag.box.x + drag.box.width / 2 + dx) / pw,
        y = (drag.box.y + drag.box.height / 2 + dy) / ph;
      for (const line of [1 / 3, 0.5, 2 / 3]) {
        if (Math.abs(x - line) < 0.015) x = line;
        if (Math.abs(y - line) < 0.015) y = line;
      }
      change({
        textX: clamp(x, drag.box.width / pw / 2, 1 - drag.box.width / pw / 2),
        textY: clamp(
          y,
          Math.min(0.5, drag.box.height / ph / 2),
          Math.max(0.5, 1 - drag.box.height / ph / 2),
        ),
      });
    } else if (drag.kind === "resize")
      change({
        size: clamp(
          drag.edit.size *
            (1 +
              Math.max(
                dx / Math.max(drag.box.width, 1),
                dy / Math.max(drag.box.height, 1),
              )),
          2,
          15,
        ),
      });
    else {
      const scale =
        Math.max(pw / media.width, ph / media.height) * drag.edit.zoom;
      const overflowX = media.width * scale - pw,
        overflowY = media.height * scale - ph;
      change({
        panX:
          overflowX > 0 ? clamp(drag.edit.panX - dx / overflowX, 0, 1) : 0.5,
        panY:
          overflowY > 0 ? clamp(drag.edit.panY - dy / overflowY, 0, 1) : 0.5,
      });
    }
  }
  function pointerUp() {
    pointerRef.current = null;
    setDragging(false);
  }
  function reset() {
    stop();
    setEdit({ ...defaults, trimEnd: media?.duration || 10 });
    setTime(0);
    invalidate();
    setError("");
    if (video) video.currentTime = 0;
  }
  function download(value: Result) {
    const a = document.createElement("a");
    a.href = value.url;
    a.download = value.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  async function shareFile(value: Result) {
    if (navigator.canShare?.({ files: [value.file] })) {
      try {
        await navigator.share({ files: [value.file] });
        setNotice("Shared. Make another whenever you like.");
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError"))
          setNotice(
            "Sharing is unavailable here. Use Download to save the file.",
          );
      }
    } else {
      download(value);
      setNotice("File downloaded. You can upload it to your favourite app.");
    }
  }
  async function make(action: "download" | "share") {
    if (!media || busy || loading) return;
    if (result) {
      if (action === "share") await shareFile(result);
      else download(result);
      return;
    }
    stop();
    setBusy(true);
    setProgress(0);
    setError("");
    setNotice("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const exporter = await import("./export");
      const image =
        sourceRef.current instanceof HTMLImageElement
          ? sourceRef.current
          : null;
      const blob =
        format === "image" && sourceRef.current
          ? await exporter.exportImage(media, edit, sourceRef.current)
          : await exporter.exportVideo(
              media,
              edit,
              image,
              controller.signal,
              setProgress,
            );
      if (controller.signal.aborted)
        throw new DOMException("Export cancelled", "AbortError");
      const extension = blob.type.includes("png")
        ? "png"
        : blob.type.includes("mp4")
          ? "mp4"
          : "webm";
      const file = new File([blob], `teska-baje.${extension}`, {
        type: blob.type,
      });
      const value = { blob, file, url: URL.createObjectURL(blob) };
      resultRef.current = value;
      setResult(value);
      if (action === "download") {
        download(value);
        setNotice(
          `${extension.toUpperCase()} ready. Download it again or share it.`,
        );
      } else setNotice("Your file is ready. Tap Share file to send it.");
    } catch (err) {
      if (controller.signal.aborted)
        setNotice("Export cancelled. Your edits are still here.");
      else
        setError(
          err instanceof Error
            ? err.message
            : "Export failed. Try 720p in Frame settings.",
        );
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  }
  async function install() {
    if (!installEvent) {
      setInstallHelp((value) => !value);
      setHelp(false);
      return;
    }
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }
  const shareAvailable = typeof navigator.share === "function";
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="Teska Baje home">
            <span className="brand-icon">
              <Crop size={23} strokeWidth={1.5} />
            </span>
            <span>
              Teska Baje<span className="brand-ko"> ko</span>
            </span>
          </a>
          <div className="header-actions">
            <button
              className="quiet-button help-button"
              aria-label="How it works"
              onClick={() => {
                setHelp((v) => !v);
                setInstallHelp(false);
              }}
              aria-expanded={help}
            >
              <Info size={16} />
              <span>How it works</span>
            </button>
            <button
              className="install-button"
              onClick={install}
              disabled={installed}
            >
              {installed ? <Check size={15} /> : <ArrowDownToLine size={15} />}
              <span>{installed ? "Installed" : "Install app"}</span>
            </button>
          </div>
        </div>
      </header>
      {(help || installHelp) && (
        <aside className="help-panel">
          <div>
            <strong>
              {help
                ? "A little local flex, in three moves."
                : "Keep it on your home screen."}
            </strong>
            <p>
              {help
                ? "Add one photo or video. Finish “Teska Baje Ko”, frame it, and choose a part of the song. Then download or share your video. For a photo without audio, choose Still image."
                : "On iPhone: open this page in Safari, tap Share, then Add to Home Screen. On Android: open the browser menu and choose Install app or Add to home screen. Installation needs a secure HTTPS address."}
            </p>
            {help && (
              <p>
                Your photo or video stays on this device. Exports have no
                watermark. MP4 is used when supported; some browsers export
                WebM.
              </p>
            )}
          </div>
          <button
            className="icon-button"
            aria-label="Close help"
            onClick={() => {
              setHelp(false);
              setInstallHelp(false);
            }}
          >
            <X size={18} />
          </button>
        </aside>
      )}
      <main>
        <div className="page-heading">
          <div>
            <h1>Make a Teska Baje.</h1>
            <p>Your photo. Your caption. A little local flex.</p>
          </div>
          <button
            className="quiet-button reset-button"
            onClick={reset}
            disabled={busy || loading}
          >
            <RotateCcw size={14} />
            Reset edits
          </button>
        </div>
        <div className="editor-layout">
          <section className="preview-panel" aria-label="Meme preview">
            <div className="preview-toolbar">
              <span className="preview-label">Preview</span>
              <label className="ratio-select">
                <Maximize size={13} />
                <select
                  aria-label="Preview aspect ratio"
                  value={edit.ratio}
                  disabled={busy}
                  onChange={(e) =>
                    change({
                      ratio: e.target.value as Ratio,
                      panX: 0.5,
                      panY: 0.5,
                    })
                  }
                >
                  {ratios.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              <span className="dimensions">
                {media ? `${size.width} × ${size.height}` : "Your canvas"}
              </span>
            </div>
            <div
              className={`preview-stage ${dragOver ? "drag-over" : ""} ${tab === "frame" && media ? "crop-mode" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragOver(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void loadFile(e.dataTransfer.files[0]);
              }}
            >
              <div
                className={`canvas-wrap ${!media ? "empty-canvas" : ""}`}
                style={{ aspectRatio: `${pw} / ${ph}` }}
              >
                <canvas
                  ref={canvasRef}
                  width={pw}
                  height={ph}
                  className={media ? "has-media" : ""}
                  aria-label="Meme preview. Drag the caption to move it, or use arrow keys. In Frame, drag the media to crop."
                  tabIndex={media ? 0 : -1}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={pointerUp}
                  onKeyDown={(e) => {
                    if (
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key) ||
                      busy
                    )
                      return;
                    e.preventDefault();
                    const step = e.shiftKey ? 0.03 : 0.005;
                    if (tab === "frame")
                      change({
                        panX: clamp(
                          edit.panX +
                            (e.key === "ArrowLeft"
                              ? -step
                              : e.key === "ArrowRight"
                                ? step
                                : 0),
                          0,
                          1,
                        ),
                        panY: clamp(
                          edit.panY +
                            (e.key === "ArrowUp"
                              ? -step
                              : e.key === "ArrowDown"
                                ? step
                                : 0),
                          0,
                          1,
                        ),
                      });
                    else
                      change({
                        textX: clamp(
                          edit.textX +
                            (e.key === "ArrowLeft"
                              ? -step
                              : e.key === "ArrowRight"
                                ? step
                                : 0),
                          0,
                          1,
                        ),
                        textY: clamp(
                          edit.textY +
                            (e.key === "ArrowUp"
                              ? -step
                              : e.key === "ArrowDown"
                                ? step
                                : 0),
                          0,
                          1,
                        ),
                      });
                  }}
                />
                {!media && (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <ImagePlus size={31} strokeWidth={1.2} />
                    </div>
                    <h2>
                      Start with your
                      <br />
                      kind of local.
                    </h2>
                    <p>Drop a photo or video here.</p>
                    <button
                      className="primary-button upload-primary"
                      onClick={() => inputRef.current?.click()}
                      disabled={loading}
                    >
                      <Upload size={15} />
                      {loading ? "Opening…" : "Choose a file"}
                    </button>
                    <span className="file-types">JPG, PNG, WebP, MP4, MOV</span>
                  </div>
                )}
                {loading && media && (
                  <div className="loading-overlay">
                    <LoaderCircle size={24} className="spin" />
                    <span>Opening your file…</span>
                  </div>
                )}
              </div>
              {dragOver && (
                <div className="drop-overlay">
                  <Upload size={24} />
                  <strong>Drop to replace</strong>
                </div>
              )}
            </div>
            <div className="preview-instruction">
              {media ? (
                tab === "frame" ? (
                  <>
                    <Crop size={13} />
                    Drag the photo or video to reframe it.
                  </>
                ) : (
                  <>
                    <Expand size={13} />
                    Drag the caption. Pull the corner to resize.
                  </>
                )
              ) : (
                <>
                  <span className="small-square" />
                  One photo or video. No watermark.
                </>
              )}
            </div>
            <div className="playback">
              <button
                className="play-button"
                onClick={togglePlay}
                disabled={!media || busy || loading}
                aria-label={playing ? "Pause preview" : "Play preview"}
              >
                {playing ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
              </button>
              <input
                aria-label="Preview position"
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={Math.min(time, duration)}
                disabled={!media || busy || loading}
                onChange={(e) => scrub(Number(e.target.value))}
              />
              <span className="timecode">
                {formatTime(time)}
                <span> / {formatTime(duration)}</span>
              </span>
            </div>
          </section>
          <section className="controls-panel" aria-label="Editor controls">
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              className="visually-hidden"
              aria-label="Upload a photo or video"
              onChange={(e) => void loadFile(e.target.files?.[0])}
              disabled={busy}
            />
            <div className="media-slot">
              <span className="file-icon">
                {media ? (
                  media.kind === "image" ? (
                    <ImagePlus size={19} />
                  ) : (
                    <Play size={19} />
                  )
                ) : (
                  <Upload size={19} />
                )}
              </span>
              <div>
                <strong title={media?.file.name}>
                  {loading
                    ? "Opening file…"
                    : media
                      ? media.file.name
                      : "Add your media"}
                </strong>
                <span>
                  {media
                    ? `${media.kind === "image" ? "Photo" : "Video"} · ${(media.file.size / 1024 / 1024).toFixed(1)} MB`
                    : "One photo or video to get started"}
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => inputRef.current?.click()}
                disabled={busy || loading}
              >
                {media ? "Replace" : "Browse"}
              </button>
            </div>
            <div
              className="editor-tabs"
              role="tablist"
              aria-label="Editing tools"
            >
              {(
                [
                  { id: "text", icon: Type, name: "Text" },
                  { id: "frame", icon: Crop, name: "Frame" },
                  { id: "audio", icon: Music2, name: "Audio" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        e.key,
                      )
                    )
                      return;
                    e.preventDefault();
                    const order: Tab[] = ["text", "frame", "audio"];
                    const index =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 2
                          : (order.indexOf(tab) +
                              (e.key === "ArrowRight" ? 1 : 2)) %
                            3;
                    setTab(order[index]);
                    document.getElementById(`tab-${order[index]}`)?.focus();
                  }}
                >
                  <t.icon size={16} />
                  {t.name}
                </button>
              ))}
            </div>
            <div
              id={`panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              className="tool-panel"
            >
              <fieldset disabled={busy || loading}>
                {tab === "text" && (
                  <>
                    <label className="field-label" htmlFor="caption">
                      Your caption
                    </label>
                    <textarea
                      id="caption"
                      value={edit.caption}
                      onChange={(e) => change({ caption: e.target.value })}
                      maxLength={400}
                      spellCheck={false}
                      rows={3}
                      placeholder="Teska Baje Ko…"
                    />
                    <p className="field-note">
                      Finish the line. English, नेपाली, or a bit of both.
                    </p>
                    <span className="field-label font-label">Font</span>
                    <div className="font-options">
                      {(Object.keys(fonts) as FontId[]).map((id) => (
                        <button
                          key={id}
                          className={edit.font === id ? "selected" : ""}
                          style={{ fontFamily: fonts[id].family }}
                          onClick={() => change({ font: id })}
                          aria-pressed={edit.font === id}
                        >
                          {fonts[id].name}
                        </button>
                      ))}
                    </div>
                    <div className="color-heading">
                      <span className="field-label">Text color</span>
                      <span className="hex-value">
                        {edit.color.toUpperCase()}
                      </span>
                    </div>
                    <div className="color-options">
                      {colors.map((color) => (
                        <button
                          key={color}
                          className={`color-swatch ${edit.color === color ? "selected" : ""}`}
                          style={{ backgroundColor: color }}
                          aria-label={`Text color ${color}`}
                          aria-pressed={edit.color === color}
                          onClick={() => change({ color })}
                        >
                          {edit.color === color && (
                            <Check
                              size={14}
                              style={{
                                color: color === "#171717" ? "#fff" : "#222",
                              }}
                            />
                          )}
                        </button>
                      ))}
                      <label
                        className="custom-color"
                        title="Choose another color"
                      >
                        <input
                          type="color"
                          aria-label="Custom text color"
                          value={edit.color}
                          onChange={(e) => change({ color: e.target.value })}
                        />
                        <span>+</span>
                      </label>
                    </div>
                    <Slider
                      label="Text size"
                      min={2}
                      max={15}
                      step={0.1}
                      value={edit.size}
                      display={`${Math.round((edit.size * size.width) / 100)} px`}
                      onChange={(value) => change({ size: value })}
                    />
                    <div className="text-options-row">
                      <div className="segmented" aria-label="Text alignment">
                        {(
                          [
                            { value: "left", icon: AlignLeft },
                            { value: "center", icon: AlignCenter },
                            { value: "right", icon: AlignRight },
                          ] as const
                        ).map((a) => (
                          <button
                            key={a.value}
                            aria-label={`Align ${a.value}`}
                            aria-pressed={edit.align === a.value}
                            className={edit.align === a.value ? "selected" : ""}
                            onClick={() => change({ align: a.value })}
                          >
                            <a.icon size={16} />
                          </button>
                        ))}
                      </div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={edit.outline}
                          onChange={(e) =>
                            change({ outline: e.target.checked })
                          }
                        />
                        Outline
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={edit.shadow}
                          onChange={(e) => change({ shadow: e.target.checked })}
                        />
                        Shadow
                      </label>
                    </div>
                    <div className="placement-row">
                      <span>Position</span>
                      <div className="position-buttons">
                        {[
                          { name: "Top", y: 0.18 },
                          { name: "Middle", y: 0.5 },
                          { name: "Bottom", y: 0.82 },
                        ].map((p) => (
                          <button
                            key={p.name}
                            onClick={() => change({ textX: 0.5, textY: p.y })}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {tab === "frame" && (
                  <>
                    <span className="field-label">Canvas size</span>
                    <div className="ratio-options">
                      {ratios.map((r) => (
                        <button
                          key={r.value}
                          className={edit.ratio === r.value ? "selected" : ""}
                          aria-pressed={edit.ratio === r.value}
                          onClick={() =>
                            change({ ratio: r.value, panX: 0.5, panY: 0.5 })
                          }
                        >
                          <span
                            className={`ratio-glyph ratio-${r.value.replace(":", "-")}`}
                          />
                          <strong>{r.label}</strong>
                          <span>{r.hint}</span>
                        </button>
                      ))}
                    </div>
                    <Slider
                      label="Zoom"
                      min={1}
                      max={3}
                      step={0.01}
                      value={edit.zoom}
                      display={`${Math.round(edit.zoom * 100)}%`}
                      onChange={(value) => change({ zoom: value })}
                    />
                    <p className="field-note crop-note">
                      Drag your media in the preview to choose the crop. Guides
                      appear while you move.
                    </p>
                    <button
                      className="text-button reset-crop"
                      onClick={() => change({ zoom: 1, panX: 0.5, panY: 0.5 })}
                    >
                      <RotateCcw size={13} />
                      Reset crop
                    </button>
                    {media?.kind === "video" ? (
                      <div className="trim-section">
                        <span className="field-label">Trim video</span>
                        <div className="two-fields">
                          <label>
                            Start{" "}
                            <span>
                              <input
                                aria-label="Video trim start"
                                type="number"
                                min={0}
                                max={edit.trimEnd - 0.1}
                                step={0.1}
                                value={Number(edit.trimStart.toFixed(2))}
                                onChange={(e) => {
                                  const value = clamp(
                                    Number(e.target.value),
                                    0,
                                    edit.trimEnd - 0.1,
                                  );
                                  change({ trimStart: value });
                                  scrub(0);
                                }}
                              />
                              sec
                            </span>
                          </label>
                          <label>
                            End{" "}
                            <span>
                              <input
                                aria-label="Video trim end"
                                type="number"
                                min={edit.trimStart + 0.1}
                                max={media.duration}
                                step={0.1}
                                value={Number(edit.trimEnd.toFixed(2))}
                                onChange={(e) => {
                                  change({
                                    trimEnd: clamp(
                                      Number(e.target.value),
                                      edit.trimStart + 0.1,
                                      media.duration,
                                    ),
                                  });
                                  setTime(0);
                                }}
                              />
                              sec
                            </span>
                          </label>
                        </div>
                        <Slider
                          label="Clip start"
                          min={0}
                          max={Math.max(0, media.duration - 0.1)}
                          step={0.1}
                          value={edit.trimStart}
                          display={formatTime(edit.trimStart, true)}
                          onChange={(v) => {
                            change({
                              trimStart: Math.min(v, edit.trimEnd - 0.1),
                            });
                            setTime(0);
                            if (video)
                              video.currentTime = Math.min(
                                v,
                                edit.trimEnd - 0.1,
                              );
                          }}
                        />
                        <Slider
                          label="Clip end"
                          min={0.1}
                          max={media.duration}
                          step={0.1}
                          value={edit.trimEnd}
                          display={formatTime(edit.trimEnd, true)}
                          onChange={(v) => {
                            change({
                              trimEnd: Math.max(v, edit.trimStart + 0.1),
                            });
                            setTime(0);
                          }}
                        />
                        <p className="field-note">
                          {formatTime(duration, true)} selected of{" "}
                          {formatTime(media.duration, true)}.
                        </p>
                      </div>
                    ) : (
                      <div className="duration-section">
                        <Slider
                          label="Photo duration"
                          min={1}
                          max={60}
                          step={1}
                          value={edit.photoDuration}
                          display={`${edit.photoDuration} seconds`}
                          onChange={(value) => {
                            change({ photoDuration: value });
                            setTime(0);
                          }}
                        />
                      </div>
                    )}
                    <label
                      className="field-label resolution-label"
                      htmlFor="resolution"
                    >
                      Export resolution
                    </label>
                    <select
                      className="full-select"
                      id="resolution"
                      value={edit.resolution}
                      onChange={(e) =>
                        change({
                          resolution: e.target.value as Edit["resolution"],
                        })
                      }
                    >
                      <option value="source">Source size</option>
                      <option value="1080">1080p</option>
                      <option value="720">720p · smaller file</option>
                    </select>
                  </>
                )}
                {tab === "audio" && (
                  <>
                    <div className="track-heading">
                      <span className="track-icon">
                        <Music2 size={19} />
                      </span>
                      <div>
                        <strong>Teska Baje audio</strong>
                        <span>Hamri Aama Sahrhai Nai Baathee Chhin</span>
                      </div>
                      <span className="track-duration">
                        {formatTime(songDuration)}
                      </span>
                    </div>
                    <div className="waveform">
                      <svg
                        viewBox="0 0 360 66"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Song waveform and selected segment"
                      >
                        {waveform.map((peak, i) => {
                          const t = (i / waveform.length) * songDuration,
                            selected =
                              t >= edit.audioStart &&
                              t <= edit.audioStart + duration;
                          return (
                            <rect
                              key={i}
                              x={(i / waveform.length) * 360}
                              y={33 - peak * 29}
                              width={2}
                              height={Math.max(2, peak * 58)}
                              fill={selected ? "#242523" : "#cccec6"}
                            />
                          );
                        })}
                        <rect
                          x={(edit.audioStart / songDuration) * 360}
                          y={0}
                          width={
                            (Math.min(
                              duration,
                              songDuration - edit.audioStart,
                            ) /
                              songDuration) *
                            360
                          }
                          height={66}
                          fill="none"
                          stroke="#242523"
                          strokeWidth={1}
                        />
                      </svg>
                    </div>
                    <Slider
                      label="Song starts at"
                      min={0}
                      max={Math.max(
                        0,
                        songDuration - Math.min(duration, songDuration),
                      )}
                      step={0.1}
                      value={Math.min(
                        edit.audioStart,
                        Math.max(
                          0,
                          songDuration - Math.min(duration, songDuration),
                        ),
                      )}
                      display={formatTime(edit.audioStart, true)}
                      onChange={(value) => change({ audioStart: value })}
                    />
                    <div className="two-fields audio-fields">
                      <label>
                        Start time
                        <span>
                          <input
                            aria-label="Audio start time"
                            type="number"
                            min={0}
                            max={Math.max(
                              0,
                              songDuration - Math.min(duration, songDuration),
                            )}
                            step={0.1}
                            value={Number(edit.audioStart.toFixed(1))}
                            onChange={(e) =>
                              change({
                                audioStart: clamp(
                                  Number(e.target.value),
                                  0,
                                  Math.max(
                                    0,
                                    songDuration -
                                      Math.min(duration, songDuration),
                                  ),
                                ),
                              })
                            }
                          />
                          sec
                        </span>
                      </label>
                      <div className="selected-length">
                        <span>Selected length</span>
                        <strong>{formatTime(duration, true)}</strong>
                      </div>
                    </div>
                    <p className="field-note">
                      {duration > songDuration
                        ? "The track will loop to fill this clip."
                        : "Audio follows your photo duration or video trim."}{" "}
                      Change the length in Frame.
                    </p>
                    <div className="audio-levels">
                      <Slider
                        label="Song volume"
                        value={edit.songVolume}
                        display={`${Math.round(edit.songVolume * 100)}%`}
                        onChange={(value) => change({ songVolume: value })}
                      />
                      {media?.kind === "video" && (
                        <>
                          <Slider
                            label="Original video sound"
                            value={edit.originalVolume}
                            display={`${Math.round(edit.originalVolume * 100)}%`}
                            onChange={(value) =>
                              change({ originalVolume: value })
                            }
                          />
                          <p className="field-note">
                            Mix in your clip’s sound, if it has any.
                          </p>
                        </>
                      )}
                    </div>
                    <div className="audio-tip">
                      <Play size={14} />
                      <span>
                        Use play below the preview to hear your selection.
                      </span>
                    </div>
                  </>
                )}
              </fieldset>
            </div>
            <div className="export-panel">
              <div className="export-heading">
                <span>Ready when you are.</span>
                <select
                  aria-label="Download format"
                  disabled={busy}
                  value={format}
                  onChange={(e) => {
                    stop();
                    setFormat(e.target.value as "video" | "image");
                    invalidate();
                  }}
                >
                  <option value="video">Video with audio</option>
                  <option value="image">Still image · PNG</option>
                </select>
              </div>
              {busy ? (
                <div className="export-progress" role="status">
                  <div>
                    <LoaderCircle size={15} className="spin" />
                    <span>
                      {progress < 0.1
                        ? "Preparing audio…"
                        : `Making your ${format === "video" ? "video" : "image"}… ${Math.round(progress * 100)}%`}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => controllerRef.current?.abort()}
                    >
                      Cancel
                    </button>
                  </div>
                  <progress max={1} value={progress} />
                  <p>Keep this page open until your file is ready.</p>
                </div>
              ) : (
                <div className="export-actions">
                  <button
                    className="primary-button download-button"
                    disabled={!media || loading}
                    onClick={() => void make("download")}
                  >
                    <ArrowDownToLine size={17} />
                    Download {format === "video" ? "video" : "image"}
                  </button>
                  <button
                    className="share-button"
                    disabled={!media || loading}
                    onClick={() => void make("share")}
                    title={
                      shareAvailable ? "Share file" : "Save a file to share"
                    }
                  >
                    <Share2 size={16} />
                    <span>{result ? "Share file" : "Share"}</span>
                  </button>
                </div>
              )}
              <div className="export-footnote">
                <span className="privacy-dot" />
                Made here. Saved to your device.
              </div>
            </div>
          </section>
        </div>
        {(error || notice) && (
          <div
            className={`message ${error ? "error-message" : ""}`}
            role={error ? "alert" : "status"}
          >
            <span>{error || notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <footer>
          <span>Who needs fancy, anyway?</span>
          <span>No account. No watermark. Just make it.</span>
        </footer>
      </main>
      <audio
        ref={audioRef}
        src="/audio/teska-baje.m4a"
        preload="metadata"
        loop
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setSongDuration(e.currentTarget.duration);
        }}
        onError={() =>
          setError(
            "The built-in audio could not load. Check your connection and reload.",
          )
        }
      />
      <div ref={binRef} className="media-bin" aria-hidden="true" />
    </>
  );
}
