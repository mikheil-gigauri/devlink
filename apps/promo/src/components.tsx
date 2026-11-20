import type React from 'react';
import {
  Easing,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { color, font } from './theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 over [start, end] frames, eased. */
export const ease = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) });

/** Fades a scene in over its first frames and out over its last. */
export const SceneFade: React.FC<{
  duration: number;
  children: React.ReactNode;
  inFrames?: number;
  outFrames?: number;
}> = ({ duration, children, inFrames = 8, outFrames = 8 }) => {
  const frame = useCurrentFrame();
  const fadeIn = inFrames > 0 ? ease(frame, 0, inFrames) : 1;
  const fadeOut = outFrames > 0 ? ease(frame, duration - outFrames, duration) : 0;
  const opacity = Math.min(fadeIn, 1 - fadeOut);
  return <div style={{ position: 'absolute', inset: 0, opacity }}>{children}</div>;
};

/** The one line of text each scene carries, for people watching muted. */
export const Headline: React.FC<{ text: string; delay?: number; top?: number }> = ({
  text,
  delay = 0,
  top = 64,
}) => {
  const frame = useCurrentFrame();
  const t = ease(frame, delay, delay + 14);
  return (
    <div
      style={{
        position: 'absolute',
        top,
        width: '100%',
        textAlign: 'center',
        fontFamily: font.sans,
        fontSize: 54,
        fontWeight: 650,
        letterSpacing: -1.2,
        color: color.text,
        opacity: t,
        transform: `translateY(${(1 - t) * 18}px)`,
      }}
    >
      {text}
    </div>
  );
};

export type Line = { text: string; at: number; tone?: 'ok' | 'info' | 'err' | 'cmd' | 'dim' };

/** A terminal window: `command` is typed from `typeFrom`, then each line appears at its frame. */
export const Terminal: React.FC<{
  command: string;
  cwd?: string;
  typeFrom?: number;
  lines: Line[];
  width?: number;
  title?: string;
  fontSize?: number;
  style?: React.CSSProperties;
}> = ({
  command,
  cwd = '~/code/acme/ui',
  typeFrom = 0,
  lines,
  width = 1180,
  title = 'zsh',
  fontSize = 26,
  style,
}) => {
  const frame = useCurrentFrame();
  const typed = Math.max(0, Math.min(command.length, Math.floor((frame - typeFrom) * 1.6)));
  const typing = typed < command.length;
  const caret = Math.floor(frame / 8) % 2 === 0;
  const tone = (t?: Line['tone']) =>
    t === 'ok'
      ? color.green
      : t === 'err'
        ? color.red
        : t === 'dim'
          ? color.faint
          : t === 'info'
            ? color.muted
            : color.text;
  return (
    <Window width={width} title={title} style={style}>
      <div
        style={{
          padding: '26px 32px 32px',
          fontFamily: font.mono,
          fontSize,
          lineHeight: 1.55,
          color: color.text,
        }}
      >
        <div>
          <span style={{ color: color.teal }}>{cwd}</span>
          <span style={{ color: color.faint }}> % </span>
          {command.slice(0, typed)}
          {typing || lines.every((l) => frame < l.at) ? (
            <span style={{ opacity: caret ? 1 : 0, color: color.teal }}>▍</span>
          ) : null}
        </div>
        {lines.map((line) => {
          const t = ease(frame, line.at, line.at + 6);
          return frame >= line.at ? (
            <div
              key={line.text}
              style={{
                color: tone(line.tone),
                opacity: t,
                transform: `translateX(${(1 - t) * -8}px)`,
                whiteSpace: 'pre',
              }}
            >
              {line.text}
            </div>
          ) : null;
        })}
      </div>
    </Window>
  );
};

/** A dark macOS-style window frame for the terminal and the editor. */
export const Window: React.FC<{
  width: number;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, title, children, style }) => (
  <div
    style={{
      width,
      borderRadius: 18,
      background: 'rgba(22,25,31,0.96)',
      border: `1px solid ${color.panelEdge}`,
      boxShadow: '0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.6)',
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        height: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '0 18px',
        borderBottom: `1px solid ${color.panelEdge}`,
        position: 'relative',
      }}
    >
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
      ))}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: font.sans,
          fontSize: 17,
          color: color.muted,
        }}
      >
        {title}
      </div>
    </div>
    {children}
  </div>
);

/**
 * A real screen recording of dryfit's window (1920×1200, captured at 2x), shown at `width`.
 * `from` is the second in the recording to start at; `rate` speeds it up.
 */
export const AppRecording: React.FC<{
  src: string;
  from: number;
  rate?: number;
  width?: number;
  zoom?: { at: number; scale: number; originX: number; originY: number; until?: number };
  style?: React.CSSProperties;
}> = ({ src, from, rate = 1, width = 1340, zoom, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const z = zoom
    ? 1 +
      (zoom.scale - 1) *
        (ease(frame, zoom.at, zoom.at + 20) -
          (zoom.until === undefined ? 0 : ease(frame, zoom.until, zoom.until + 16)))
    : 1;
  const height = (width * 1200) / 1920;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: (width / 1920) * 24,
        overflow: 'hidden',
        boxShadow: '0 50px 140px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.07)',
        transform: `translateY(${(1 - enter) * 40}px) scale(${0.97 + enter * 0.03})`,
        opacity: enter,
        ...style,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${z})`,
          transformOrigin: zoom ? `${zoom.originX * 100}% ${zoom.originY * 100}%` : 'center',
        }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={Math.round(from * fps)}
          playbackRate={rate}
          muted
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

/** A small pill of text, used for the notes over recordings. */
export const Pill: React.FC<{ children: React.ReactNode; at: number; style?: React.CSSProperties }> = ({
  children,
  at,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 160 } });
  return (
    <div
      style={{
        position: 'absolute',
        padding: '16px 26px',
        borderRadius: 999,
        background: 'rgba(20,23,28,0.92)',
        border: `1px solid ${color.panelEdge}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        fontFamily: font.sans,
        fontSize: 28,
        color: color.text,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        opacity: frame >= at ? Math.min(1, t * 1.4) : 0,
        transform: `scale(${0.85 + 0.15 * t})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
