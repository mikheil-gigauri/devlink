export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 900; // 30s

export const color = {
  bg: '#0a0c10',
  panel: '#14171c',
  panelEdge: 'rgba(255,255,255,0.08)',
  text: '#eceef1',
  muted: '#8b929c',
  faint: '#5b626c',
  teal: '#3fd7cf',
  green: '#3fb950',
  red: '#ff6b5e',
  blue: '#4c9dff',
};

export const font = {
  sans: '-apple-system, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  mono: '"SF Mono", Menlo, Monaco, monospace',
};

/** Seconds to frames. */
export const s = (seconds: number) => Math.round(seconds * FPS);

/**
 * The voiceover, cut at its pauses: each line plays at `at` (seconds on the timeline) from
 * `from`–`to` (seconds in vo.mp3). The long pauses ElevenLabs left are shortened to ~0.3s.
 */
export const VO = [
  { at: 0.0, from: 0.0, to: 5.7 }, // Testing a library change…
  { at: 6.0, from: 6.3, to: 13.12 }, // Dryfit installs your change…
  { at: 13.12, from: 13.82, to: 20.5 }, // Every save builds…
  { at: 20.1, from: 21.18, to: 22.88 }, // See it all from your menu bar.
  { at: 22.1, from: 23.44, to: 27.14 }, // When you're done…
  { at: 26.3, from: 28.18, to: 28.88 }, // Dryfit.
  { at: 27.35, from: 29.54, to: 31.2 }, // Try it before you ship it.
];

/** Scene boundaries on the timeline, in frames. */
export const SCENES = {
  problem: { from: 0, to: s(6.0) },
  link: { from: s(6.0), to: s(13.12) },
  watch: { from: s(13.12), to: s(20.0) },
  menu: { from: s(20.0), to: s(22.0) },
  restore: { from: s(22.0), to: s(26.15) },
  end: { from: s(26.15), to: DURATION },
};
