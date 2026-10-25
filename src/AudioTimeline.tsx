import { useState } from "react";
import { Music2, Volume2 } from "lucide-react";
import { clamp, formatTime } from "./editor";
import waveform from "./waveform.json";

interface Props {
  start: number;
  duration: number;
  trackDuration: number;
  time: number;
  disabled: boolean;
  songVolume: number;
  originalVolume: number;
  hasVideo: boolean;
  onChange: (patch: {
    audioStart?: number;
    songVolume?: number;
    originalVolume?: number;
  }) => void;
}
export default function AudioTimeline(props: Props) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const { start, duration, trackDuration, time, disabled, onChange } = props;
  const end = Math.min(trackDuration, start + duration);
  return (
    <div className="audio-timeline" aria-label="Audio timeline">
      <div className="audio-timeline-heading">
        <span>
          <Music2 size={16} />
          Audio
        </span>
        <output>
          {formatTime(start, true)} – {formatTime(end, true)}
        </output>
        <button
          className="icon-button"
          aria-label="Audio volume"
          aria-expanded={volumeOpen}
          aria-controls="volume-controls"
          disabled={disabled}
          onClick={() => setVolumeOpen((value) => !value)}
        >
          <Volume2 size={17} />
        </button>
      </div>
      <label className="audio-track">
        <svg viewBox="0 0 600 48" preserveAspectRatio="none" aria-hidden="true">
          {waveform.map((peak, i) => {
            const t = (i / waveform.length) * trackDuration;
            return (
              <rect
                key={i}
                x={(i / waveform.length) * 600}
                y={24 - peak * 19}
                width={3}
                height={Math.max(2, peak * 38)}
                fill={t >= start && t < end ? "#242523" : "#bfc2b8"}
              />
            );
          })}
          <rect
            x={(start / trackDuration) * 600}
            y={1}
            width={((end - start) / trackDuration) * 600}
            height={46}
            fill="#242523"
            fillOpacity={0.06}
            stroke="#242523"
            strokeWidth={2}
          />
          <line
            x1={(((start + time) % trackDuration) / trackDuration) * 600}
            x2={(((start + time) % trackDuration) / trackDuration) * 600}
            y1={2}
            y2={46}
            stroke="#242523"
            strokeWidth={2}
          />
        </svg>
        <input
          type="range"
          aria-label="Audio start"
          aria-valuetext={`${formatTime(start, true)} to ${formatTime(end, true)}`}
          min={0}
          max={Math.max(0, trackDuration - Math.min(duration, trackDuration))}
          step={0.1}
          value={clamp(start, 0, Math.max(0, trackDuration - duration))}
          disabled={disabled}
          onChange={(e) => onChange({ audioStart: Number(e.target.value) })}
        />
      </label>
      {volumeOpen && (
        <fieldset
          className="timeline-volumes"
          id="volume-controls"
          disabled={disabled}
        >
          <label>
            <span>Music</span>
            <input
              aria-label="Song volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={props.songVolume}
              onChange={(e) => onChange({ songVolume: Number(e.target.value) })}
            />
            <output>{Math.round(props.songVolume * 100)}%</output>
          </label>
          {props.hasVideo && (
            <label>
              <span>Video</span>
              <input
                aria-label="Original video sound"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={props.originalVolume}
                onChange={(e) =>
                  onChange({ originalVolume: Number(e.target.value) })
                }
              />
              <output>{Math.round(props.originalVolume * 100)}%</output>
            </label>
          )}
        </fieldset>
      )}
    </div>
  );
}
