/* tslint:disable */
/* eslint-disable */

/**
 * Canny edge detection.
 * Input: RGBA pixel buffer (width * height * 4 bytes).
 * Output: edge map, same dimensions, 255 = edge pixel, 0 = non-edge pixel.
 */
export function analyze_image(pixels: Uint8Array, width: number, height: number): Uint8Array;

/**
 * Generate interlocking cut paths for all interior grid edges.
 *
 * `edge_map`      — Canny output from `analyze_image` (0 or 255 per pixel).
 *                   Pass an empty slice to disable edge-aware routing.
 * `edge_influence` — 0.0 = classic seeded variation only;
 *                    1.0 = strong contour following, variation reduced to ±5%.
 *
 * Returns a JSON string (array of CutPath objects) because passing structured
 * data through wasm-bindgen without serde is cleanest as a serialised string.
 */
export function generate_cuts(cols: number, rows: number, piece_width: number, piece_height: number, seed: number, edge_map: Uint8Array, image_width: number, image_height: number, edge_influence: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly analyze_image: (a: number, b: number, c: number, d: number) => [number, number];
    readonly generate_cuts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
