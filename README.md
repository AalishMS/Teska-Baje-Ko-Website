# Teska Baje Ko Website

A small, installable photo and video editor for the Nepali **“Teska Baje Ko…”** trend. Upload one photo or video, finish the caption, pick a segment of the built-in song, and download or share the result.

- One photo or video, with drag-and-drop and a file picker.
- Original aspect ratio by default, plus 9:16, 1:1, 4:5, 16:9, and 4:3.
- Crop by dragging the media, zoom, and trim videos.
- Editable “Teska Baje Ko ” caption; four fonts, color picker, outline, shadow, and text alignment.
- Drag and resize the caption directly on the preview; alignment guides and snapping appear while dragging. Arrow keys move the caption, and Shift moves it farther.
- English and Nepali text, with bundled fonts and emoji fallback.
- Built-in audio with an adjustable start point and volume. Audio length follows the photo duration or video trim. Original video sound can be mixed in separately.
- Video export, still PNG export, and file sharing where supported. No watermark or account.
- Web app manifest, app icons, and installation support on phones.

All uploaded media and rendering stay in the browser. There is no upload server, database, analytics, or login. Drafts live only in memory; reloading the page clears the current work.

## Run locally

Use Node.js 22.12+ (or Node.js 24):

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

```sh
npm test       # Geometry, wrapping, duration, and time-format regression tests
npm run build # Type-check and production build
npm run preview
```

## Deploy to Vercel later

Import this GitHub repository into Vercel. The repository root is the app root; no subdirectory or environment variables are required. `vercel.json` supplies these settings:

| Setting          | Value           |
| ---------------- | --------------- |
| Framework        | Vite            |
| Build command    | `npm run build` |
| Output directory | `dist`          |

Vercel provides HTTPS, which enables phone installation and browser sharing. This repository does not configure or trigger any deployment itself.

## Browser behavior

Use a current Chrome, Edge, or Safari for video editing. MP4 with H.264 video and AAC audio is preferred; browsers without H.264 encoding use WebM. Older browsers use real-time recording when available. The built-in AAC encoder runs locally when the browser lacks native AAC encoding.

Export needs the page to stay open. Very large sources can be reduced to 1080p or 720p in **Frame → Export resolution**. Image input support depends on the browser; JPG, PNG, and WebP are the safest choices. Video decoding depends on the source codec as well as its file extension.

Native sharing depends on the browser and operating system. If encoding is needed, the first tap prepares the file; tap **Share file** once it is ready to open the system share sheet. Browsers without file sharing download the file instead.

On Android, use **Install app** or the browser’s install menu. On iPhone, open in Safari and choose **Share → Add to Home Screen**. The service worker caches previously loaded resources; full offline editing is not a release requirement.

## Project layout

- `src/App.tsx`: editor controls, media loading, playback, installation, and sharing.
- `src/editor.ts`: canvas composition, caption layout, aspect ratio, and crop geometry. The preview and export share this renderer.
- `src/export.ts`: frame-accurate video export, audio mixing, PNG export, and recording fallback. Loaded only when exporting.
- `src/styles.css`: neutral, square-cornered desktop and mobile editor.
- `public/audio/teska-baje.m4a`: audio extracted from the supplied `Teska_baje.mp4`.
- `public/manifest.webmanifest`, `public/sw.js`: installable app configuration.

The supplied audio was extracted as AAC from the reference video; the original 24 MB video is not shipped. The waveform is derived from the audio. To change the song, replace the M4A, regenerate `src/waveform.json`, and update the track label/default duration in `App.tsx`.

## Validation

The initial version was checked in Chromium at desktop and phone viewport sizes. Checks covered photo and video upload, playback, caption dragging with grid guides, corner resizing, Nepali text, PNG export, photo-to-MP4 export, and a trimmed/cropped video-to-MP4 export with mixed original audio. Exported files were independently decoded to verify dimensions, duration, and audio; the selected song offset was compared against the source waveform.

Actual iPhone/Android hardware and their native share sheets still need device testing after deployment.

## Credits

The built-in song/reference audio was supplied for this project. Its ownership remains with its respective rights holders. Dependencies retain their own licenses: React, Vite, Lucide, Mediabunny and its AAC encoder, and the bundled Fontsource fonts (Arimo, Libre Baskerville, Oswald, Kalam, Noto Sans Devanagari, and Noto Emoji). See `THIRD_PARTY_NOTICES.md`.
