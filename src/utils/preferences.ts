import { Application, Container, Graphics, Text } from 'pixi.js';
import { ColorMatrixFilter } from 'pixi.js';
import { BevelFilter, OutlineFilter } from 'pixi-filters';
import type { ColorMatrix } from 'pixi.js';
import type { Sprite } from 'pixi.js';
import type { Piece } from '../puzzle/types';

// ─── Types ────────────────────────────────────────────────────────────────────

const PREFS_KEY = 'jigg:preferences';

export type BackgroundPreset = 'off-white' | 'gray' | 'charcoal';

export type Preferences = {
  highContrast: boolean;
  greyscale: boolean;
  pieceLabels: boolean;
  reducedMotion: boolean;
  backgroundPreset: BackgroundPreset | null; // null = adaptive
};

const defaults: Preferences = {
  highContrast: false,
  greyscale: false,
  pieceLabels: false,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  backgroundPreset: null,
};

// ─── Persistence ──────────────────────────────────────────────────────────────

export function loadPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable — fail silently, prefs live in memory only
  }
}

// ─── App reference (set once from scene.ts) ───────────────────────────────────

let _app: Application | null = null;

export function initPreferencesApp(app: Application): void {
  _app = app;
}

// ─── Background ───────────────────────────────────────────────────────────────

export const BACKGROUND_PRESETS: Record<BackgroundPreset, number> = {
  'off-white': 0xf5f5f3,
  'gray':      0x808080,
  'charcoal':  0x2a2a2a,
};

export const BG_PRESETS_ORDER: BackgroundPreset[] = ['off-white', 'gray', 'charcoal'];

function deriveAdaptiveBackground(luminance: number): number {
  if (luminance < 100) return BACKGROUND_PRESETS['off-white']; // dark image → light bg
  if (luminance > 150) return BACKGROUND_PRESETS['charcoal'];  // light image → dark bg
  return BACKGROUND_PRESETS['gray'];                            // mid-range → neutral
}

function applyBackground(preset: BackgroundPreset | null, imageLuminance: number): void {
  if (!_app) return;
  const color = preset
    ? BACKGROUND_PRESETS[preset]
    : deriveAdaptiveBackground(imageLuminance);
  _app.renderer.background.color = color;
}

// ─── High contrast ────────────────────────────────────────────────────────────

// BevelFilter has no .contrast property — scale lightAlpha/shadowAlpha instead.
// BEVEL_CONTRAST_HIGH / BEVEL_CONTRAST_DEFAULT = 1.8 → multiply base alphas by 1.8.
const BEVEL_LIGHT_ALPHA_DEFAULT  = 0.2;
const BEVEL_SHADOW_ALPHA_DEFAULT = 0.2;
const BEVEL_LIGHT_ALPHA_HIGH     = 0.2 * 1.8; // 0.36
const BEVEL_SHADOW_ALPHA_HIGH    = 0.2 * 1.8; // 0.36

// ─── Sandwich stroke (AC-1) ───────────────────────────────────────────────────
// Two distinct OutlineFilter instances — inner white + outer black.
// STRICT MODE: must never be merged into a single filter. The sandwich effect
// requires two separate fragment shader passes.
const HC_INNER_OUTLINE_THICKNESS = 1.5;
const HC_INNER_OUTLINE_COLOR     = 0xffffff;
const HC_OUTER_OUTLINE_THICKNESS = 2.5;
const HC_OUTER_OUTLINE_COLOR     = 0x000000;
const HC_FILTER_TAG              = 'hc-sandwich';

function addSandwichStroke(sprite: Sprite): void {
  // Guard — never stack if already applied
  if (sprite.filters?.some((f) => (f as any)._tag === HC_FILTER_TAG)) return;

  const inner = new OutlineFilter({ thickness: HC_INNER_OUTLINE_THICKNESS, color: HC_INNER_OUTLINE_COLOR, quality: 0.15 });
  const outer = new OutlineFilter({ thickness: HC_OUTER_OUTLINE_THICKNESS, color: HC_OUTER_OUTLINE_COLOR, quality: 0.15 });

  // Tag both filters — required for clean removal and leak prevention
  (inner as any)._tag = HC_FILTER_TAG;
  (outer as any)._tag = HC_FILTER_TAG;

  // Filter order is mandatory:
  //   Index 0:   BevelFilter — internal piece depth, must render before outlines
  //   Index n-1: inner OutlineFilter (white, 1.5px)
  //   Index n:   outer OutlineFilter (black, 2.5px)
  // Append to end of existing array — never reorder BevelFilter.
  sprite.filters = [...(sprite.filters ?? []), inner, outer];
}

function removeSandwichStroke(sprite: Sprite): void {
  // Collect tagged filters before removal so they can be destroyed
  const toDestroy = sprite.filters?.filter((f) => (f as any)._tag === HC_FILTER_TAG) ?? [];

  // Remove from sprite
  sprite.filters = sprite.filters?.filter((f) => (f as any)._tag !== HC_FILTER_TAG) ?? [];

  // Destroy to release GPU resources — prevents memory leaks
  toDestroy.forEach((f) => f.destroy());
}

const BATCH_THRESHOLD = 200;

export function applyHighContrast(
  active: boolean,
  pieces: Piece[],
  spriteMap: Map<string, Sprite>,
): void {
  const lightAlpha  = active ? BEVEL_LIGHT_ALPHA_HIGH  : BEVEL_LIGHT_ALPHA_DEFAULT;
  const shadowAlpha = active ? BEVEL_SHADOW_ALPHA_HIGH : BEVEL_SHADOW_ALPHA_DEFAULT;

  const applyToOne = (piece: Piece) => {
    const sprite = spriteMap.get(piece.id);
    if (!sprite) return;
    if (sprite.filters) {
      for (const f of sprite.filters) {
        if (f instanceof BevelFilter) {
          f.lightAlpha  = lightAlpha;
          f.shadowAlpha = shadowAlpha;
        }
      }
    }
    if (active) addSandwichStroke(sprite);
    else removeSandwichStroke(sprite);
  };

  if (pieces.length <= BATCH_THRESHOLD) {
    pieces.forEach(applyToOne);
  } else {
    const half = Math.ceil(pieces.length / 2);
    requestAnimationFrame(() => {
      pieces.slice(0, half).forEach(applyToOne);
      requestAnimationFrame(() => {
        pieces.slice(half).forEach(applyToOne);
      });
    });
  }
}

// ─── Greyscale ────────────────────────────────────────────────────────────────

const GREYSCALE_MATRIX: ColorMatrix = [
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0.299, 0.587, 0.114, 0, 0,
  0,     0,     0,     1, 0,
];

const GREYSCALE_FILTER_TAG = 'greyscale';

export function applyGreyscale(
  active: boolean,
  pieces: Piece[],
  spriteMap: Map<string, Sprite>,
): void {
  pieces.forEach((piece) => {
    const sprite = spriteMap.get(piece.id);
    if (!sprite) return;

    const hasGreyscale = sprite.filters?.some((f) => (f as any)._tag === GREYSCALE_FILTER_TAG);

    if (active && !hasGreyscale) {
      const matrix = new ColorMatrixFilter();
      matrix.matrix = GREYSCALE_MATRIX;
      (matrix as any)._tag = GREYSCALE_FILTER_TAG;
      sprite.filters = [...(sprite.filters ?? []), matrix];
    } else if (!active) {
      // Remove only the named greyscale filter — BevelFilter and outline unaffected
      sprite.filters = sprite.filters?.filter(
        (f) => (f as any)._tag !== GREYSCALE_FILTER_TAG,
      ) ?? [];
    }
  });
}

// ─── Piece labels (Story 37b) ─────────────────────────────────────────────────

const LABEL_FONT_SIZE      = 14;
const LABEL_FILL           = 0xffffff;
const LABEL_STROKE         = 0x000000;
const LABEL_STROKE_THICK   = 2;
const LABEL_BG_ALPHA_DEFAULT = 0.45; // test against white-on-white (cloud/snow images)
const LABEL_BG_ALPHA_HC      = 0.8;  // solid enough in high contrast — AC-3
const LABEL_BG_PADDING       = 2;
export const LABEL_CONTAINER_NAME = 'pieceLabel';

// TODO: swap PIXI.Text for BitmapText if piece count exceeds ~2000
// PIXI.Text generates one GPU texture per unique string — fine at current scale
function createPieceLabel(piece: Piece, bgAlpha: number): Container {
  const container = new Container();
  container.label = LABEL_CONTAINER_NAME;

  // TODO: implement non-scaling labels
  // At low viewport zoom (<0.3x) labels become unreadable
  // Fix: on each ticker frame, label.scale = 1 / viewport.scale.x for all visible labels
  // Only worth implementing if user feedback confirms this is a real pain point

  const text = new Text({
    text: String(piece.index),
    style: {
      fontSize: LABEL_FONT_SIZE,
      fill: LABEL_FILL,
      stroke: { color: LABEL_STROKE, width: LABEL_STROKE_THICK },
    },
  });
  text.anchor.set(0.5, 0.5);
  text.position.set(0, 0);

  // Backing box sized to text bounds — improves legibility on busy textures.
  // bg at index 0, text at index 1 — order is structural contract used by applyPieceLabels.
  const bg = new Graphics();
  const tw = text.width + LABEL_BG_PADDING * 2;
  const th = text.height + LABEL_BG_PADDING * 2;
  bg.roundRect(-tw / 2, -th / 2, tw, th, 2).fill({ color: 0x000000, alpha: bgAlpha });

  container.addChild(bg);
  container.addChild(text);
  return container;
}

/** Redraw the backing Graphics of an existing label container at a new alpha. */
function updateLabelBgAlpha(label: Container, bgAlpha: number): void {
  const bg   = label.getChildAt(0) as Graphics;
  const text = label.getChildAt(1) as Text;
  const tw = text.width  + LABEL_BG_PADDING * 2;
  const th = text.height + LABEL_BG_PADDING * 2;
  bg.clear();
  bg.roundRect(-tw / 2, -th / 2, tw, th, 2).fill({ color: 0x000000, alpha: bgAlpha });
}

export function applyPieceLabels(
  active: boolean,
  pieces: Piece[],
  spriteMap: Map<string, Sprite>,
  highContrast: boolean,
): void {
  const bgAlpha = highContrast ? LABEL_BG_ALPHA_HC : LABEL_BG_ALPHA_DEFAULT;

  pieces.forEach((piece) => {
    const sprite = spriteMap.get(piece.id);
    if (!sprite) return;

    const existing = sprite.getChildByLabel(LABEL_CONTAINER_NAME);

    if (active && !existing) {
      const label = createPieceLabel(piece, bgAlpha);
      if (piece.state === 'in-tray') {
        label.rotation = -(piece.actual.rotation * Math.PI) / 180;
        // Counter-scale so label renders at native size regardless of tray thumbnail scale
        if (sprite.scale.x > 0) label.scale.set(1 / sprite.scale.x);
      } else {
        label.rotation = -sprite.rotation;
      }
      // First child so snap highlight renders above; mask clips label to piece shape
      sprite.addChildAt(label, 0);

    } else if (!active && existing) {
      sprite.removeChild(existing);

    } else if (active && existing) {
      // Already has label — update counter-rotation and backing box alpha
      const label = existing as Container;
      label.rotation = piece.state === 'in-tray'
        ? -(piece.actual.rotation * Math.PI) / 180
        : -sprite.rotation;
      updateLabelBgAlpha(label, bgAlpha);
    }
  });
}

/** Keep a label upright after the sprite's rotation changes. No-op if no label. */
export function syncLabelRotation(sprite: Sprite): void {
  const label = sprite.getChildByLabel(LABEL_CONTAINER_NAME) as Container | null;
  if (label) label.rotation = -sprite.rotation;
}

/** Stub — implemented in Story 37c. */
export function applyReducedMotion(_active: boolean): void {
  // TODO: Story 37c
}

// ─── Single traversal point ───────────────────────────────────────────────────

export function applyPreferences(
  prefs: Preferences,
  pieces: Piece[],
  spriteMap: Map<string, Sprite>,
  imageLuminance: number,
): void {
  applyBackground(prefs.backgroundPreset, imageLuminance);
  applyHighContrast(prefs.highContrast, pieces, spriteMap);
  applyGreyscale(prefs.greyscale, pieces, spriteMap);
  applyPieceLabels(prefs.pieceLabels, pieces, spriteMap, prefs.highContrast);
  applyReducedMotion(prefs.reducedMotion);
}

// ─── Callback (store → scene.ts without circular import) ─────────────────────

let _applyFn: ((prefs: Preferences) => void) | null = null;

/**
 * Register the full apply callback. Called once from scene.ts after init.
 * The callback captures spriteMap and imageLuminance from scene.ts's closure.
 */
export function registerApplyFn(fn: (prefs: Preferences) => void): void {
  _applyFn = fn;
}

/** Fired by the store's setPreference — do not call directly elsewhere. */
export function fireApplyPreferences(prefs: Preferences): void {
  _applyFn?.(prefs);
}
