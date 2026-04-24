<!-- audience: Dev, Agent -->

# Technical Decisions — Project Choice History

*Product, process, and architectural choices made during Jigg development with rationale and context.*

## V1 / V2 Split

V1 is the free tier MVP — strictly frontend, no auth, no backend. Persistence is browser storage (IndexedDB) or portable via `.jigg` export. This makes the app frictionless to start: no account, no signup, works immediately. The architectural constraints below (no accounts, no backend) are deliberate V1 decisions, not omissions.

V2 introduces a paid subscription tier: user auth, backend, cross-device sync, and anything that requires server state. Nothing in V1 should take on backend dependencies that block this transition.

## Board/Table asymmetry

The board and the table are **not equivalent surfaces**. They share an interaction (pieces can be placed on both via drag/drop or snap) but have different roles, and that separation is intentional.

- **Board** is the primary play surface. Its job is **correctness and clarity** — piece visibility, consistent playability. It is **system-controlled and image-aware**: color is derived deterministically from the loaded image at load time. **No user override, ever.**
- **Table** is the staging surface. Its job is **flexibility and preference** — aesthetic comfort, environment. It stays **user-controlled** via the existing presets (Shift+B cycle per Story 37a).

### Invariants

- Board color is derived from the image at load time. Deterministic, no override.
- Table appearance is independent of board color and user-controlled.
- Given the same image, the board appearance is consistent across sessions.
- The two surfaces are intentionally asymmetric despite the shared drop/snap interaction.

### Why no board presets

Allowing board customization would:
- reintroduce the visibility failures that motivated Story 47 in the first place (pieces disappearing into surfaces)
- add unnecessary user decisions to a surface that benefits from being predictable
- weaken consistency across puzzles — the board should read the same way every session for the same image

V1 prioritizes **"always readable by default"** over **"user-configurable"** on the board. This is a permanent product principle, not a V1-punt: there is no V2 path that opens the board to user color choice. The table is the customization surface; the board stays clean.

### Board color algorithm (Story 47b)

Three presets chosen deterministically at image-load time:

| Preset | Hex | Rationale |
|--------|-----|-----------|
| Light  | `#f5f5f3` | Matches Story 37a off-white workspace preset |
| Mid    | `#808080` | Neutral midpoint — survives both extremes |
| Dark   | `#2a2a2a` | Matches Story 37a charcoal workspace preset |

Selection uses WCAG relative luminance (linearised sRGB: `L = 0.2126R + 0.7152G + 0.0722B`) sampled across the full image at stride 8:

1. If `spread > 0.60` **and** `0.3 < mean < 0.7` → **mid** (image has extreme light and dark; binary choice sacrifices half the pieces)
2. Else if `mean > 0.5` → **dark** (dominant bright image)
3. Else → **light** (dominant dark image)

Thresholds: spread cutoff `0.60`, mean window `0.3–0.7`, binary cutoff `0.5`. Three branches, no tie-breakers, no k-means, no per-piece analysis. Implemented in `src/canvas/board.ts` as `computeBoardColor(imageData: ImageData): number`.

### When the board needs to feel more "stage-like"

The right lever is **visual hierarchy** (edge definition, drop shadow, elevation) — not user choice. Reserved for follow-up stories that tune the board's perceptual weight without exposing knobs.

## Stack
- **PixiJS over Canvas 2D** — performance ceiling with 200 pieces, shadows, and shaders
- **PixiJS over Three.js / Babylon.js** — full 3D engines are overkill for pseudo-3D effects
- **Zustand over Redux** — outside-React access pattern is a hard requirement
- **Rust/WASM over OpenCV.js** — bundle size 7MB+; we only need edge detection
- **No accounts** — IndexedDB is the intentional persistence layer, cross-device sync is v2
- **No backend** — fully client-side is architecturally honest for the no-account promise
- **GSAP isolated to completion sequence** — PixiJS Ticker handles the game loop

## Puzzle Model
- **Freeform group assembly** — pieces snap to each other anywhere in world space, not just on the board. Groups move as a unit. Single unconnected piece = group of one. Decided before Story 7.
- **Rotation in 90° increments** — double-tap to rotate, simpler snap logic, works on mobile and desktop
- **Grid-based correct positions** — each piece has a fixed world space correct position set once on creation. Board snap is distance-from-anchor. Piece-to-piece snap is neighbour lookup via gridCoord.

## Drag & Input
- **Single hit layer for drag** — one transparent `Graphics` overlay with `eventMode='static'` handles all pointer events; sprites stay permanently `eventMode='none'`. Avoids per-sprite event listener accumulation and toggling overhead.
- **Spatial hash for hit detection** — groups indexed into cell grid (CELL_SIZE=128); pointerdown queries only cells under the pointer rather than iterating all groups.
- **Monotonic settleCounter for z-index** — each drop increments a module-level counter and assigns it to all sprites in the group. No constants, no cycling. Initialised to `spriteMap.size` so first drop clears all initial per-index values.
- **Rotation-aware hit test** — transform pointer into sprite local space via inverse rotation, then check against `texture.frame` half-extents. `s.width` is wrong for rotated sprites.
- **activePointerId pointer lock** — prevents two groups being dragged simultaneously; checked on every pointermove and pointerup.
- **pointerupoutside on stage** — prevents stuck-drag when pointer leaves canvas.
- **baseScale captured at drag start** — not at init time, so scale is correct if pieces have been resized.
- **DRAG_SCALE solo-only** — scale lift on drag only applied when group has exactly 1 piece. Multi-piece groups scale individual sprites around their own centers, creating visible gaps at inner edges.

## Completion Detection
- **Completion check inlined in store, not imported from `completion.ts`** — avoids a circular dependency (`puzzleStore` → `completion` → `puzzleStore`). The check is three lines and belongs conceptually in `markGroupPlaced` anyway. `isComplete` still lives in `completion.ts` as a pure utility for external callers.
- **`onComplete` receives `totalCount` as a param** — avoids `completion.ts` importing `usePuzzleStore`. `scene.ts` is the natural owner of both `app`, `hitLayer`, and store access; it passes what's needed.
- **Completion message is screen-space PixiJS, not DOM** — UI container at `zIndex: 9999` with `app.screen` coordinates stays centred regardless of zoom/pan. No DOM elements for in-puzzle UI (consistent with the PixiJS-owns-canvas principle).
- **Hit layer disabled on completion, not pieces individually** — setting `hitLayer.eventMode = 'none'` is a single call that stops all interaction. Per-piece toggling would be error-prone as piece count grows.

## WASM / Worker
- **Direct wasm-pkg import over dynamic `/wasm/` path import**: Workers import `init` and exported functions from `../wasm-pkg/jigg_analysis.js` directly rather than the earlier `import(/* @vite-ignore */ '/wasm/...')` pattern. Direct import is statically typed (no manual casts), tree-shaken by Vite, and avoids maintaining a separate `public/wasm/` copy. `wasm-pkg/` files are generated artifacts — committed but not hand-edited.
- **Edge overlay starts hidden, toggled with E**: Always-on overlay is too noisy during normal play. Debug overlays default to `visible=false`; developer toggles with a key. Consistent pattern for all future debug layers.

## Jigsaw Tab Shape
- **6-segment (19-point) cubic Bezier path per cut**: 5 segments (16 pts) could not produce a geometrically correct dome head — the single cap segment always produced a flat-topped bump. Splitting the cap into two quarter-circle arcs (K=0.5523 Bezier constant) gives G1-continuous joins at entry, tip, and exit, and a true dome shape regardless of tab size.
- **K=0.5523 for quarter-circle arcs**: this constant (`4/3*(√2-1)`) is the standard Bezier approximation for a 90° arc. Each quarter arc is a single cubic segment; two arcs = semicircular dome. Applied symmetrically so the tab and blank are exact inverses.
- **neck_y = cut_y + tab_dy − sgn·r**: this formula places the dome entry such that `tip_y − neck_y = r` always, giving a dome of radius r regardless of piece aspect ratio. The head is always a true semicircle.
- **`cutter.ts` reads cut-point arrays generically** (loop step 3 from index 1): any `1+3n` point count works. Adding or removing segments in Rust requires no TypeScript changes.
- **`textureRegion` is the authoritative grid size**: expanded texture frames (for tab padding) must not be used to derive grid piece dimensions in snap or hit-test logic. Always read `piece.textureRegion.w/h`.

## Edge-Aware Cut Routing (Story 15)
- **Worker stores edgeMap copy, not re-runs analyze_image**: `ANALYZE_IMAGE` and `GENERATE_CUTS` are sent simultaneously. The worker stores `edgeMap.slice()` at module scope during ANALYZE_IMAGE so GENERATE_CUTS can reuse it. This works because JavaScript's microtask queue guarantees ANALYZE_IMAGE's continuation runs before GENERATE_CUTS's when both `await` the same already-resolved `initPromise` — messages are processed in receive order.
- **Worker not terminated after both jobs complete**: The worker stays alive after ANALYZE_IMAGE and GENERATE_CUTS finish. Small idle cost, acceptable. Debug keys (1/2/3) that originally motivated this were removed in Story 16; the worker simply remains alive as settled behaviour — no `terminateIfDone` call.
- **`EDGE_INFLUENCE = 0.5` lives only in `cutter.ts`**: This constant is the single partition point for cut style configuration. Scene.ts imports and passes it; the worker receives it in the payload; the WASM call uses it. Future config UI or presets change only `cutter.ts`.
- **Endpoint pinning, not control-point adjustment**: When edge influence shifts a cut's baseline, only the INTERIOR of the path moves. `pts[0]` and `pts[18]` are pinned back to `cut_y_grid`/`cut_x_grid` after path generation. Adjusting the adjacent control points for a smooth transition would be complex and is not worth it — the kink at the endpoints is at the piece corner and is hidden by adjacent pieces' masks.
- **`roundPixels: true` as the mask antialias fix**: PixiJS v8 has no `antialias: false` on Graphics. StencilMask is binary, so alpha fringe isn't the issue. The gap comes from sub-pixel stencil boundaries leaving a pixel unclaimed. `roundPixels: true` snaps stencil vertices to integer device pixels, making shared boundaries deterministic.
- **`scene.ts` touched despite "touch only" spec**: Debug key bindings (1/2/3 for edge influence) and pipeline wiring (passing `edgeInfluence`/`imageWidth`/`imageHeight` in the GENERATE_CUTS payload) require scene.ts changes. The "touch only" constraint applied to production logic; the debug feature explicitly requires scene.ts.

## Workspace Background
- **Off-white WebGL clear color over Graphics rect**: Previously used a dark charcoal `Graphics` rect with `SimplexNoiseFilter`. Story 18b switched to off-white `#f5f5f3`. A `Graphics` rect produced triangle-seam artifacts on retina displays (see gotchas.md), so the background is now handled entirely by the WebGL clear color (`app.init({ background: '#f5f5f3' })`). Zero geometry, no possible seams. Body CSS background also set to `#f5f5f3` to prevent black gaps at canvas edges.

## Piece Shadows (DropShadowFilter)
- **Disabled after experimentation**: Container-wrapped DropShadowFilter was implemented (resting/dragging/placed states) but produced two issues: (1) `resolution: DPR` caused a thin vertical seam on retina displays, (2) at `resolution: 1` the effect was too subtle at low alpha values (0.04–0.10) to justify the rendering overhead and code complexity. Shadows disabled for now. Container wrapper architecture remains in place for future use. If re-enabled, use `resolution: 1` and mutate filter properties in place (never replace the `filters` array).

## Rendering / Shaders
- **lightAngle hardcoded to 45° (top-left)** — no UI for light direction, universal jigsaw convention. `BevelFilter rotation: 225` (= lightAngle + 180 in BevelFilter's convention). Revisit if surface texture story needs it.

## Tray Architecture (Story 32)

- **Unified strip toggle for open AND close**: A single `_stripHitArea` transparent-fill Graphics rect covers the tray strip and calls `setTrayOpen(!trayOpen)` regardless of current state. Two separate handlers (open vs close) were tried but caused the close path to silently fail when the chevron was stroke-only. Unified handler is simpler and always correct.
- **`_piecesContainer` with Graphics mask for overflow clipping**: Piece containers live inside `_piecesContainer` (a child of `_trayContainer`) rather than directly in the tray container. A `Graphics` mask on `_piecesContainer` clips pieces to the tray body, preventing overflow during layout. The mask rect is redrawn on every `redrawBackground()` call.
- **2-row wrap with `piecesPerRow`**: Single flat row would overflow to 1200px+ for 16 pieces. Two rows (`TRAY_ROWS = 2`) with `piecesPerRow = Math.floor((screenW() - PAD) / slotW)` adapts to viewport width. Wrap is recalculated on every `layoutTrayPieces()` call.
- **`screenW()` utility**: `Math.max(app.screen.width, window.innerWidth)` — always returns the larger of the two because `app.screen.width` lags one frame after `window.resize`. Avoids a class of resize bugs where tray doesn't extend full width on first resize event.
- **Dual resize listeners**: Both `window.addEventListener('resize')` and `app.renderer.on('resize')` call `onTrayResize`. Window fires first (with `window.innerWidth` correct), renderer fires after (with `app.screen.width` correct). Either event alone would miss one scenario; both together handle fullscreen, DPR changes, and normal resize.
- **`_trayDisplayOrder` shuffled array separate from store order**: Module-level `_trayDisplayOrder: string[]` is Fisher-Yates shuffled on `initTray`. Filtered on each layout pass to show only `state === 'in-tray'` pieces. Store piece array order is never mutated for display randomisation — keeps store as the authority for puzzle state, tray as the authority for display order.
- **Archimedean spiral origin locks on first click, resets on viewport pan**: Spiral origin (`spiralOriginX/Y`) is set once when the first piece is click-extracted and held until the viewport moves. This lets rapid successive clicks build a coherent cluster rather than spreading to random world positions. Viewport `moved` event resets the origin so the next spiral starts at the new screen center.

## Filter Strip (Story 34)

- **`flatSides >= 2` for corner, not `=== 2`**: for any puzzle with rows ≥ 2 and cols ≥ 2, corner pieces always have exactly 2 flat sides. Using `>= 2` gracefully handles degenerate grids (1×1, 1×N) where pieces can have 3–4 flat sides; they classify as corners, which is the least surprising behaviour. No production puzzles hit this branch.
- **`activeFilter` lives in Zustand store, not tray module state**: filter is puzzle-session data, not UI-only state. Storing it in the store means it resets cleanly on `setPieces` (new puzzle start), can be persisted in Story 54, and is accessible from outside `tray.ts` without a getter. Tray module state would have required an exported getter or reset hook.
- **Filter strip is a non-scrolling sibling of `_gridContainer` inside `_piecesContainer`**: placing `_filterContainer` at `y=0` inside `_piecesContainer` (with `_gridContainer` offset to `y=FILTER_STRIP_HEIGHT`) means the filter buttons are clipped by the same mask as the piece grid (correct), but are unaffected by `_gridContainer.x = -_scrollX` (also correct). The alternative — placing the strip directly in `_trayContainer` above `_piecesContainer` — would have required adjusting `_piecesContainer.y` and recomputing the mask, with more moving parts.
- **`renderFilterStrip()` recreates children on every call**: filter buttons are rebuilt from scratch each time `layoutTrayPieces()` runs (on piece extraction, filter change, resize). The call frequency is low enough that recreation cost is negligible. The alternative — mutating existing button Graphics/Text in place — would require tracking per-button references and adds complexity for no measurable gain.
- **Empty state message only for `allInTray.length === 0`**: when a filter produces an empty view but pieces remain in the tray, the empty grid space is the message — the zero counts on the filter buttons explain it. Showing "No pieces match filter" text would require a second text object, conditional logic, and a different message per scenario. The counts make it self-explanatory.
- **`T` key added to existing `keydown` handler in `scene.ts`**: keeps all keyboard shortcuts co-located (F for FPS, T for tray). Adding a second `keydown` listener in `tray.ts` would work but scatter shortcuts across files without benefit. Guard (`INPUT`/`TEXTAREA`/`SELECT` tag check) added to all key handling since it was missing — it applies to both T and F now.

## Color Zone Filter (Story 35)

- **k-means runs synchronously inside `gridCut()`, not deferred via setTimeout**: at 4×4=16 pieces the clustering is under 1ms. The spec noted deferral as an option only if profiling revealed a problem. It didn't, so we kept it synchronous — simpler call path, zones are available before `initTray` runs, no intermediate state where pieces have no zone.
- **`pixelData` is an optional param on `gridCut()`**: if absent, `colorVector` defaults to `[128, 128, 128]` and k-means is skipped. Backwards compatible; future tests or environments without pixel access still work. The optional param also makes the call site's intent explicit (`gridCut(..., imageData.data)` — you chose to pass colour data).
- **Swatch fill = mean colorVector of ALL pieces, not just in-tray pieces**: the zone colour represents the image region, not the current tray state. If computed from in-tray pieces, swatch colour would drift as pieces are extracted — a swatch for a sky-blue zone would slowly grey as sky pieces left the tray. Fixed fill is the right semantic.
- **OffscreenCanvas extracted once in `loadScene`, reused for k-means and WASM worker**: the previous code created the OffscreenCanvas and drew the texture twice — once implicitly (earlier attempt) and explicitly for the worker. Extracting it once at the top of `loadScene` and reusing the `imageData.data` reference eliminates the duplicate canvas alloc, reduces peak memory, and makes the data-extraction site unambiguous.
- **Color zone and edge type filters share one `activeFilter` in the store**: no second filter slot needed. The filter is mutually exclusive by design (selecting a swatch clears the edge button highlight and vice versa). A single `activeFilter: TrayFilter` handles both; `visibleInTray()` switches on whether the filter starts with `'zone-'` or matches an edge type. If future stories need multi-select or combined filters, a separate slot can be introduced then.
- **Swatch area reserved on the right, text buttons occupy the remainder**: rather than dividing the strip into 9 equal buttons (4 text + 5 swatches), the right `SWATCH_AREA_W = 148px` is reserved for swatches and the text button area scales with viewport width. Swatches are a fixed visual size regardless of screen width; text buttons need space for their label + count. Mixed fixed/fluid layout is the correct split here.
- **`edgeType` remains grid-position-only**: Story 36b defers content-aware edge detection (checking alpha at borders for shaped/circular images) to a separate story. `gridCut()` computing it from pixel content would conflate two concerns and slow the simpler rectangular case.

## Accessibility Preferences (Story 37a)

- **`OutlineFilter` over `DropShadowFilter` for high contrast edge stroke** — spec proposed DSF at `offset:{x:0,y:0}` / `blur:0` to follow the alpha mask. At zero offset and zero blur, the shadow renders directly beneath the sprite and is completely invisible. `OutlineFilter` from `pixi-filters` is purpose-built for this: it samples the alpha mask boundary and renders an explicit ring. Produces a correct, visible stroke with no Bezier tracing required.
- **`fireApplyPreferences` outside Zustand `set` updater** — UI callbacks that call `getState()` (e.g. `syncBgPresetUI`) must fire after `set` returns, when the new state is committed. Firing inside the updater reads stale state. `newPrefs` is built inside the updater (has access to old state for the merge), but `fireApplyPreferences(newPrefs)` is the line after `set(...)`.
- **Callback pattern for `setPreference` → `applyPreferences`** — `setPreference` in the store needs to trigger `applyPreferences`, which requires `spriteMap` (a scene.ts closure variable). The store cannot import scene.ts (circular dep). Solution: `preferences.ts` exports `registerApplyFn(fn)` / `fireApplyPreferences(prefs)`; scene.ts registers a callback after init that captures `spriteMap`. No global state, no circular imports.
- **Shift+B for background preset cycle, not plain B** — plain B is a common screen reader shortcut (jump to next button in browse mode). Shift+B is inert in most AT contexts. Hotkeys that conflict with AT defaults should use modifiers.
- **Adaptive background thresholds: luminance < 100 → off-white, > 150 → charcoal** — narrower window than first-pass spec (80/180). Mid-range threshold 80–180 was too wide and matched stone/concrete/outdoor images as "mid-range gray" which looked wrong. 100/150 leaves only genuinely flat-toned images in the gray bucket.
- **`applyPreferences` re-applied in CUTS_COMPLETE** — bevel filters are attached asynchronously when the worker returns cuts. Calling `applyPreferences` on init works for background/greyscale/ARIA, but high contrast bevel adjustment has no filters to update yet. Re-applying inside the `CUTS_COMPLETE` handler ensures bevel contrast and edge stroke are applied to freshly attached `BevelFilter` instances.
- **Named filter tag (`_tag`) to prevent filter accumulation** — `OutlineFilter` and `ColorMatrixFilter` for greyscale/high-contrast are added to `sprite.filters` dynamically. Rapid toggles can accumulate duplicate filters if add-logic doesn't check for existing ones. A `_tag` string property (e.g. `'highContrastOutline'`, `'greyscale'`) is set on the filter object at creation; add-checks and remove-filters use `(f as any)._tag` to distinguish managed filters from permanent ones (BevelFilter). Strictly non-destructive: neither function touches filters it didn't create.

## High Contrast Repair (Story 37d)

- **Two `OutlineFilter` instances (sandwich stroke) over one** — a single outline around a jigsaw piece against a similarly-coloured background can disappear (e.g. white outline against white image). Two separate fragment-shader passes (white 1.5px inner then black 2.5px outer) ensure at least one is always visible regardless of image content. Both tagged `hc-sandwich` so add/remove is idempotent and GPU memory is freed on removal (`f.destroy()`). Merging into one filter is not possible — the sandwich requires two distinct shader evaluations.
- **BevelFilter always at index 0, outlines appended to end** — `addSandwichStroke` spreads the existing filter array and pushes inner+outer to the tail. This is the only safe insertion point: the BevelFilter must render before outline passes so the depth illusion is visible through the outline, not occluded by it. Any prepend or splice risks reordering the BevelFilter.
- **Normal-mode tray alpha 0.85 ("glass tray") vs HC alpha 1.0 ("solid tray")** — 37d intentionally introduced a glass effect for normal mode (`0x1a1a1a` at α 0.85) while making HC fully opaque (`0x000000` at α 1.0). Previous behaviour was implicit α 1.0 for both. The glass effect is a design improvement; the fully-opaque HC is an accessibility requirement (no canvas bleed-through for users who need maximum contrast).
- **`usePuzzleStore.subscribe` in `initTray` for HC tray redraw, not deferred via `applyFn` chain** — the `applyFn` callback path (`registerApplyFn` / `fireApplyPreferences`) executes after Zustand `set` returns and calls `applyPreferences`, which then calls `applyHighContrast` on sprites. The tray background is a separate `Graphics` rect with no sprite — it is not in the `spriteMap`. A direct Zustand subscription in `initTray` fires synchronously on every toggle and does not depend on the callback chain. `_unsubscribeHC?.()` before resubscription keeps it idempotent.
- **`SNAP_HIGHLIGHT_THICKNESS_HC = 4` defined but deferred** — the constant is declared and reserved for a future Graphics stroke overlay on the snap region. Only `_snapHighlightColor` and `_snapHighlightAlpha` are applied to the board-snap pulse today. Wiring thickness requires a separate Graphics overlay pass that doesn't exist yet; the constant documents the intent without blocking the rest of AC-4.

## Reduced Motion (Story 37c)

- **`initPreferencesViewport` pattern mirrors `initPreferencesApp`** — `preferences.ts` cannot import `scene.ts` (circular dep). A reference-at-init pattern (`_viewport` module var set via exported `initPreferencesViewport(v)`) is the established approach used for `_app`. `scene.ts` calls it once after the viewport is created and plugins added.
- **Decelerate plugin `.friction` requires `(decelerate as any).friction`** — `plugins.get('decelerate')` returns `Plugin | null`. The `Plugin` base type exposes no animation properties. `DeceleratePlugin` has `.friction` at runtime but the TypeScript type is not parameterised. Cast to `any` is correct — the property exists and is mutable; this is a pixi-viewport typing gap, not a real `any` smell.
- **`DECELERATE_FRICTION_DEFAULT = 0.95` mirrors `.decelerate({ friction: 0.95 })` in `scene.ts`** — the constant is co-located with `initPreferencesViewport` in `preferences.ts` so the default is visible next to the restoration path. If `scene.ts` ever changes the default, `preferences.ts` must be updated in the same commit. A TODO comment cross-links them.
- **Scale before `moveCenter` in precision teleport** — `viewport.moveCenter(x, y)` places world-point y at the raw screen centre. If `scale.set(...)` is called after, the scale change shifts the visual centre. Setting scale first means `viewport.scale.y` equals the final zoom level when the trayOffset is computed, giving a correct pixel offset regardless of the starting zoom.
- **`trayOffset = currentTrayHeight / 2 / viewport.scale.y`** — the playable area is `(screenH - trayH)` pixels tall. Its visual centre is `trayH/2` pixels above the raw screen centre. Dividing by `viewport.scale.y` converts screen pixels to world units. Adding this offset to `piece.canonical.y` as the `moveCenter` target shifts the viewport so the piece lands at the playable centre, not the raw screen centre.
- **`decelerate.reset()` after teleport** — `moveCenter` gives the viewport an implicit velocity of zero, but the decelerate plugin may have residual momentum from a prior pan. Calling `.reset()` ensures the viewport is stationary after a teleport.
- **Active swatch conditions split: unconditional radius/dot vs HC-conditional magenta** — `drawRadius` (13 vs 10) and the white centre dot apply whenever `isActive`, regardless of HC mode. The magenta outer ring is an additional signal inside the existing `if (hcSwatches)` block and only changes the outer stroke colour. Mixing HC and active conditions for the radius/dot would break the selection state for non-HC users.
- **Non-HC active ring offset uses `drawRadius + 3` not a constant** — the non-HC ring is drawn at `circle(cx, cy, drawRadius + 3)`, keeping it a fixed 3px outside the fill regardless of active/inactive radius. Hardcoding `SWATCH_RADIUS + 3` (= 13) would make the ring coincide with the fill circle when `isActive` (fill is also radius 13), making it invisible. Dynamic offset is mandatory.

## Piece Label Rotation (Story 37b follow-up)

- **`syncLabelRotation(sprite)` helper in `preferences.ts`, not inlined at call sites** — three separate sites mutate `sprite.rotation` on canvas pieces: `rotateGroup` (rotate.ts), `tweenRotation` ticker (drag.ts), and extraction paths in tray.ts. Centralising the counter-rotation (`label.rotation = -sprite.rotation` after `getChildByLabel`) in one exported function means all three stay in sync with zero duplication. If the label structure changes, one function to update.
- **Labels always upright via `label.rotation = -sprite.rotation`** — the invariant is unconditional: regardless of piece state, a label's rotation in local space always equals the negative of the sprite's rotation, so it appears upright in world space. The tray counter-rotation formula (`-(actual.rotation * PI)/180`) is equivalent at creation time (sprite rotation in tray equals `actual.rotation` in radians), but `syncLabelRotation` uses `sprite.rotation` directly so it works for any intermediate angle during tweens.

## Type Alignment — spec import strategy

- **`@jigg-spec/*` wildcard alias (Story 39)**: single canonical form — `"@jigg-spec/*": ["./jigg-spec/*"]` in tsconfig and `'@jigg-spec': path.resolve(__dirname, './jigg-spec')` in vite. Wildcard is more flexible than a file-specific alias and works for any file in the submodule. All imports use `from '@jigg-spec/types'`. The earlier `@jigg/spec` alias was removed to avoid dual-alias confusion.
- **`path.resolve(__dirname, ...)` with `@types/node` in vite.config.ts** (Story 39): `@types/node` was added as a devDependency to enable `path.resolve`. Single `'@jigg-spec': path.resolve(__dirname, './jigg-spec')` alias replaces the earlier `new URL(..., import.meta.url).pathname` approach. `@types/node` does not pollute browser typechecking because `vite.config.ts` is a build-time file — it is in `tsconfig.json` `include` but `skipLibCheck: true` prevents Node type conflicts with DOM types in source files.
- **`baseUrl: "."` always paired with `paths`**: TypeScript requires `baseUrl` when `paths` is set. Without it the alias silently doesn't resolve.
- **`PieceLifecycle` (renamed from `PieceState`) for the local store alias**: `type PieceState = Piece['state']` in puzzleStore.ts shadowed the spec's `PieceState` interface. Renaming to `PieceLifecycle` is a preventive rename — no current import conflict, but would cause confusion the moment spec's `PieceState` is imported in the same file for the persistence epic.
- **`CutPoint` deleted, replaced with spec `Point`**: `CutPoint { x; y }` was structurally identical to spec `Point { x; y }`. No semantic difference; no reason for a local alias. Removing the duplicate keeps `Point` as the single named type for all 2D coordinates.
- **Persistence epic boundary (Story 38 audit)**: Six runtime fields deferred — `Piece.groupId`, `Piece.actual`, `Transform.rotation` (radians vs spec degrees), `PieceGroup` (whole type), `Piece.colorVector` ([r,g,b] vs HexCode), `Piece.state` lifecycle vs `stageId`. Resolved in Story 39 (see below).
- **`Piece extends PieceDefinition, PieceState` completed (Story 39)**: All six deferred fields resolved. `actual` → `pos?: Point` + `rot: number` (degrees); `groupId` → `clusterId`; `colorVector` → `meanColor: HexCode`; `state` → `stageId + placed`; `canonical` aligned (`rot: 0`, no scale). `pos` currently stores local group offset (not global coord as spec intends) — will converge to global in persistence epic. `PieceGroup.rotation` stays in radians (used in trig within snap.ts); Pixi `sprite.rotation` receives `piece.rot * Math.PI / 180` conversion.

## Keyboard Navigation (Story 40)

- **`]`/`[` for filter cycling, not ArrowRight/ArrowLeft** — Arrow keys are reserved for Story 41b piece movement on the canvas table. Bracket keys have no existing AT or browser meaning inside an `application` landmark and don't conflict with Screen Reader virtual-cursor navigation.
- **`]`/`[` handled at `window` level, not per-button** — filter cycling must fire regardless of where focus is (canvas, strip handle, landmark itself). A per-button keydown handler only fires when a bench button is focused; if focus is anywhere else the key is silent. Moving it to the existing `window` keydown handler in `scene.ts` gives unconditional global scope while bench is open.
- **`_trackedPieceId` in aria.ts persists through `blur`, used only for extraction/placement cleanup** — `document.activeElement` becomes `body` silently any time `syncButtonDOMOrder` calls `appendChild` to reorder DOM (browser fires `blur` on the moved element). Storing the last focused piece in a module variable that is NOT cleared on `blur` gives a stable reference for `handleExtractionFocusHandoff` (did the extracted piece have keyboard focus?) and the store subscription (clear tracking when a piece is placed). It is NOT used to influence filter change focus — `handleFilterChangeFocus` always clears it and jumps to first visible unconditionally. Cleared on: `initLandmarks` (puzzle reset), piece extraction, and piece placement.
- **`handleFilterChangeFocus()` always jumps to first visible piece** — the original "does piece survive filter" check added complexity and depended on `_trackedPieceId` being accurately set (unreliable in background tabs where `focus()` fires no event). Deterministic behaviour — always land on first visible — is simpler, predictable, and correct. The "keep focus on surviving piece" optimisation was not worth the fragility.
- **`handleFilterChangeFocus()` lives in `bench.ts`, not `scene.ts`** — focus logic after a filter change depends on `tabIndex` state that is only settled after `layoutTrayPieces` completes. Putting the focus call after `layoutTrayPieces` inside `applyBenchFilter` (bench.ts) keeps cause and effect adjacent. `scene.ts` `]`/`[` handler becomes a trivial `cycleFilter(direction)` call with no focus logic.
- **Arrow keys reserved for Story 41b** — ArrowLeft/Right/Up/Down in the table context will move a selected piece by one snap unit. They must not be bound to bench filter cycling or any other action that fires globally, as that would silently swallow movement keys when focus is on the table.

## Deterministic bench order + rotation (Story 40c)

One seed per session. One master order per session. Filters are views — they never reshuffle.

- **Seed source:** `JiggGlue.uri` (session URI, unique per playthrough). Dev sentinel `'dev:session:hardcoded'` until Story 53.
- **Order seed:** `hash(sessionUri)` — drives `deriveBenchOrder`, stored in `_trayDisplayOrder` once at load.
- **Rotation seed:** `hash(sessionUri + ':rot:' + pieceId)` — completely independent of order derivation.
- **`getVisibleBenchOrder(filter)`** replaces the old `visibleInTray()` logic as the canonical filter view. `visibleInTray()` delegates to it.
- **Filter behaviour:** `.filter()` view over `_trayDisplayOrder` — switching filters never reorders. Corner pieces in Corners filter appear in the same relative positions as in All filter.
- **Rotation behaviour:** `rotationEnabled: true` → seeded cardinal rotation per piece (0/90/180/270). `rotationEnabled: false` → all pieces upright. Currently hardcoded `false` with TODO pointing to Story 52.
- **Rotation carries over on extraction** — neither `spiralPlace`, `extractToCanvas`, nor `zoomToPlacePiece` reset `sprite.rotation`. `piece.initialRotation` set at bench load for label counter-rotation.
- **`mulberry32` implemented directly in `bench.ts`** — not imported from any other module. djb2 `hashString` also internal to `bench.ts`.
- **Why session URI not puzzle URI:** same puzzle, new game → fresh bench order (new session URI). Resume same game → identical bench order (same session URI). Correct scope: bench order belongs to the playthrough, not the puzzle.

Note: `JiggGlue.uri` not yet available (Persistence, Story 53). Search for `dev:session:hardcoded` at Story 53 time to confirm sentinel removal.

## Keyboard Mode Switching — `inert` model (Story 40b)

- **Symmetric inert derivation — `mode !== 'bench'` / `mode !== 'table'`** — the spec draft used `_benchCollapsed || mode !== 'bench'` for the bench inert expression. This is redundant: once `_benchCollapsed` is true, `setKeyboardMode('table')` is called immediately, making `_keyboardMode === 'table'` permanent. `mode !== 'bench'` is already permanently true. The simplified form `benchLandmark.inert = mode !== 'bench'` is identical in behaviour and is harder to misread. Rule: only derive `inert` from `_keyboardMode`. `_benchCollapsed` guards the T key, not the inert assignment.
- **`_benchCollapsed` role: T key guard only** — `_benchCollapsed = true` once the last piece leaves the bench (permanent, irreversible). Its sole purpose is to prevent the T key from switching back to bench mode after collapse (`if (benchHasPieces) setKeyboardMode('bench')` — `benchHasPieces` naturally returns false after collapse; `_benchCollapsed` makes the permanent nature explicit and prevents any future bypass).
- **`setKeyboardMode` is the single inert mutation point** — `inert` is never set directly anywhere else. All mode transitions go through `setKeyboardMode`. This ensures `inert` state is always consistent with `_keyboardMode`.
- **Bench collapse detected in all three extraction paths** — `spiralPlace`, drag extraction, and `completeZoomAnimation` each check `if (_trayDisplayOrder.length === 0) _onBenchCollapse()` after updating `_trayDisplayOrder`. The Zustand `subscribeToStore` subscriber also removes pieces from `_trayDisplayOrder` synchronously during `extractPieceToCanvas`, so the length check is correct even though the piece is removed twice (second removal is a no-op).
- **Circular dep bench.ts ↔ scene.ts avoided with callback registration** — bench.ts cannot import from scene.ts (scene.ts already imports bench.ts). The same `registerBenchCollapseHandler(fn)` pattern used for bench button handlers is extended: scene.ts registers `() => { setBenchCollapsed(); setKeyboardMode('table'); }` after `initLandmarks`. bench.ts calls `_onBenchCollapse()`. No module-level circular import.
- **`t`/`T` key: tray open = bench mode, tray close = table mode** — `t`/`T` continues to toggle tray open/close (original Story 40 behaviour). Symmetric: open tray → bench active; close tray → table active. Splitting lowercase/uppercase `t`/`T` for different behaviours was tried and broke user muscle memory — reverted. The "close deferred to Story 42" approach was also tried but left `table.inert` permanently true — fixed by symmetric coupling.
- **`trayOpen` Zustand subscriber drives `setKeyboardMode`, not the key handler** — `setKeyboardMode` is called inside a `usePuzzleStore.subscribe` callback that watches `trayOpen`, not inside the T key handler. The T key handler calls `setTrayOpen(!isOpen)` and returns — the subscriber fires synchronously and updates keyboard mode. This ensures every `trayOpen` mutation (T key, PixiJS strip click, DOM strip button) triggers the mode switch. Wiring `setKeyboardMode` only to the T key handler silently missed the click path — the Zustand subscriber closes that gap by reacting to state, not to the caller.

## Empty filter state (Story 40d)

- **`getBenchFilterCounts` — single pass, never cached** — one loop over `_trayDisplayOrder`, increments 9 counters. Called fresh inside `renderFilterStrip` on every layout pass. Not a separate `filter().length` call per filter.
- **All filters follow the same empty-state rules — no special cases** — "All" reflects total pieces in `STAGE_BENCH` and may reach zero when bench is empty. It follows the same empty-state rules as all other filters. No privileged filters.
- **`getFilterDefs` always returns all 9 entries** — previously excluded palette zones with 0 count. Now all 5 zones always appear. ARIA radiogroup button count is fixed at 9; `updateFilterButtonLabels` always receives 9.
- **Empty treatment: visual + pointer + AT must agree** — empty inactive: 35%/40% alpha, `eventMode: 'none'`, `disabled=true`. Empty active: 55% alpha, `eventMode: 'static'`, `disabled=false`, "currently selected" in label. Visual, pointer, and AT states are set in the same rendering pass.
- **Active filter stays active when it empties — no auto-switch** — if the user is on Corners and extracts the last corner piece, the filter stays on Corners. User drives all transitions.
- **`cycleFilter` skips empty filters** — builds `available` list of non-empty filters from `getBenchFilterCounts`. If `available.length <= 1`, returns immediately. If active filter is empty, `]`/`[` moves to the next non-empty filter.
- **When bench is completely empty** — all filters show `(0)` or slash; `available.length === 0`; `]`/`[` does nothing; active filter stays active and remains interactive (no-op).
- **Diagonal slash on empty swatches — softened contrast** — `0x777777` at `alpha: 0.6`, 1px width. Signals "temporarily empty", not "removed" or "invalid". No strikethrough on text filters — same reasoning.
- **`FilterDef` extended** — added `count: number` and `isActive: boolean`. Both `initFilterButtons` and `updateFilterButtonLabels` in `aria.ts` derive `disabled` and `aria-label` from these fields directly.

## File picker — pre-created input element (Story 47)

- **`<input type="file">` pre-created and appended to `document.body`, not created per-click** — creating a detached `<input>` and triggering `.click()` on it works in modern browsers, but some browsers add a perceivable delay before the picker opens. Appending the input to the DOM before clicking removes that delay by keeping the element in a live document. The element is hidden (`display: none`) and persists for the lifetime of the tab.
- **`fileInput.value = ''` after each selection** — without the reset, selecting the same file a second time fires no `change` event (the browser sees no diff). The reset makes every pick explicit and allows the same file to be re-loaded after editing it on disk.
- **`handleImageFile` is the single entry point for both drag-and-drop and button-click** — extracted in Story 46; Story 47 simply calls it from the new picker path. Both paths share the exact `normalizeImage → sessionStorage → reload` pipeline with no duplication.

## Drag-and-drop image load (Story 44)

- **`FileReader.readAsDataURL` over `URL.createObjectURL`** — the story prompt suggested blob URLs. Blob URLs are bound to the originating document; after `window.location.reload()` the resource is gone and `Assets.load` returns null. Data URLs are self-contained strings — they cost more memory (base64 overhead) and hit the 5 MB `sessionStorage` quota for large images, but they survive the reload without any lifecycle management. The quota risk is acceptable for a dev-tool story; Story 45 will normalise image dimensions before this matters in production.
- **`sessionStorage` over `IndexedDB` for the pending URL** — sessionStorage is synchronous, requires no schema, and scopes naturally to the tab. The image URL survives a reload within the tab, which is exactly the lifetime we need. Cross-tab or cross-session persistence is not required (and would be wrong — this is per-session state).
- **Page reload over in-place teardown** — there is no scene teardown path. Reloading avoids writing one prematurely. Story 46 shipped without adding a teardown path — this is an explicit deferral, not an oversight. The reload-based rebuild is the permanent approach until a dedicated "clean rebuild" story is queued.

## Image Normalization (Story 45)

- **`createImageBitmap(file, { imageOrientation: 'from-image' })` for EXIF correction** — the `imageOrientation` option is the only browser-native way to apply EXIF orientation before drawing to canvas. Without it, iPhone portrait photos decode sideways (raw sensor pixels are landscape; EXIF says rotate). The option is supported in all modern browsers and requires no third-party EXIF library. Passing the raw `File` directly (not a data URL or blob URL) means the browser handles HEIC/HEIF decode on platforms that support it for free.
- **`OffscreenCanvas.convertToBlob` over `canvas.toDataURL`** — `convertToBlob` is async and returns a `Blob`, which can then be read as a data URL via `FileReader`. `toDataURL` is synchronous and blocks the main thread for large images; `convertToBlob` does not. Also normalizes PNG input to JPEG, giving predictable output size regardless of input format.
- **`normalizeImage` as a pure function — no side effects, no DOM access** — the caller (`main.ts`) owns storage and reload. Keeping the function pure means it is trivially testable in isolation and makes the boundary between "image processing" and "app lifecycle" explicit. The story constraint was explicit on this; we followed it.
- **`bitmap.close()` after drawing** — `ImageBitmap` holds a GPU-side resource that is not released by GC. Calling `.close()` after `ctx.drawImage` frees it immediately. Omitting this leaks GPU memory for the lifetime of the tab, which is especially bad for large phone photos.
- **Extreme aspect ratios warned, not rejected** — the story explicitly defers the policy decision to Story 46. Logging and proceeding surfaces real failure modes (warped pieces, layout breakage) that inform what Story 46 needs to fix. A silent rejection would hide them.

## Grid sizing algorithm (Story 46)

- **`computeGrid` co-located with `gridCut` in `cutter.ts`** — both functions operate on image dimensions and feed the same pipeline. Keeping them in the same file avoids a module that exists only to export one function and a handful of constants.
- **TARGET_PIECES=160, not MAX_PIECES=200, as the aiming point** — targeting the cap means any rounding pushes the product over it. The 40-piece gap (160→200) absorbs rounding noise from `Math.round` and still produces a full-feeling puzzle. Using 200 as both cap and target would require clamping after every round.
- **MIN_PIECE_SIDE=60 is a soft floor, not a guarantee** — it raises the piece side when the natural size would be below 60px (small images). For extreme panoramas where MIN_GRID forces more rows than the natural side allows, MIN_GRID wins and pieces go below the floor. This is intentional: MIN_GRID enforces puzzle variety (corner/edge classification needs ≥2 on both axes); MIN_PIECE_SIDE is a comfort heuristic.
- **MIN_GRID=2 enforced before the cap loop** — the cap loop (`while rows * cols > MAX_PIECES`) must never decrement below MIN_GRID. Because 2×2=4 ≤ 200, the loop is guaranteed to terminate regardless of input.
- **"Reduce the larger dimension first" for cap enforcement** — when `rows * cols > 200`, shrinking the larger dimension keeps the grid closer to square. Any systematic preference (e.g. always reduce cols) would produce unexpectedly tall or wide grids for square inputs.

## Piece label clipping (Story 46d — deferred)

Story 46d investigated label clipping caused by the piece-shape mask. The root cause: labels are sprite children clipped by the mask; tab blanks intrude `raw_h ≈ 0.25 × dimension` (worst case 0.2875×) from each edge, leaving a safe interior of only `≈ 0.43 × minDimension`. At fontSize=14 a 3-digit label bg is ~30px wide; on a 61px piece the safe half-width is ~13px, so the label clips the right-edge blank with only sub-pixel clearance.

- **Approach A (dynamic container scale) attempted and abandoned** — scaling the container down to fit keeps the label inside the safe zone on average pieces but requires K so small that labels on small pieces become visually poor. On 60–80px pieces with 3-digit indices the fitScale drops to ~0.7 and the label looks "shrunken". Worse, this architecture does not scale to 1000+ piece puzzles where pieces may be 30px — no readable label fits inside the safe zone at any scale.
- **Approach B chosen for the real fix (future story)** — move labels to a sibling overlay container above the sprite layer, synced per-frame via ticker (position + rotation). No mask clipping possible. Labels always render at full size regardless of piece dimensions. Cost: per-frame sync and a new overlay container in scene.ts. Queued for BA.

## Bench piece clipping fix (Story 46b)

- **Option B (shrink THUMBNAIL_SIZE) over Option A (pad mask)** — Option A (expand `_piecesMask` rect) fails for the bottom row: with the tray positioned flush at the screen bottom, the bottom of the piece cell is already off-canvas (`tray.y + piecesContainer.y + cell_bottom = screenH + 18`). Expanding the mask only allows PixiJS to render content that is already beyond the canvas boundary — the WebGL viewport still clips it. Option C (per-button scissor) would have been major rework. Option B (reduce `THUMBNAIL_SIZE`) brings the entire cell within the visible canvas and within the existing mask, fixing both the tab clip and the off-screen focus ring simultaneously.
- **Root cause was a latent bug from Story 34** — `THUMBNAIL_SIZE = TRAY_HEIGHT_OPEN * 0.7 = 154` was correct before Story 34 added the 36px filter strip. After the strip, the available height for piece cells dropped from ~172px to 136px, making `THUMBNAIL_SIZE` 18px taller than the available space. The formula was never updated.
- **New THUMBNAIL_SIZE derived from available geometry** — `TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING - BENCH_RING_CLEARANCE = 128`. The `BENCH_RING_CLEARANCE = 8` absorbs `FOCUS_RING_PADDING (4) + FOCUS_RING_THICKNESS (2) + 2px buffer` from `scene.ts`. If ring constants in `scene.ts` change, `BENCH_RING_CLEARANCE` in `bench.ts` must be updated in the same commit.
- **Focus ring is on `app.stage`, not inside `_piecesContainer`** — the `_piecesContainer` mask cannot clip the ring; it was clipped only by the canvas (screen) boundary because the sprite extended off-screen. With `THUMBNAIL_SIZE = 128`, the sprite bottom in screen space is `screenH - 8`, keeping the ring bottom at `screenH - 4` — fully on-screen.
- **Mask rect unchanged** — with the smaller `THUMBNAIL_SIZE`, the cell bottom in `_piecesContainer` local space is 44 + 128 = 172, comfortably inside the existing mask height of 180. No mask geometry change was needed; the mask correctly clips horizontal overflow as before (Story 32 invariant preserved).

## URL-based drop path (Story 46 session — dev tool)

- **`handleImageFile` extracted from the drop handler** — the previous drop handler inlined normalizeImage + sessionStorage + reload. Adding a second entry point (URL drag from `test-picker.html`) would have duplicated that logic. Extraction keeps both paths (OS file drop and browser-to-browser drag) feeding the same function, with no duplication.
- **URL drop fetches → Blob → File, then enters the existing normalizeImage path** — the normalizeImage pipeline accepts a `File`. Wrapping the fetched Blob in a `File` keeps the boundary clean: all normalisation, EXIF correction, and storage logic is unchanged. The MIME type comes from `Response.blob().type`; falls back to `'image/jpeg'` if empty (e.g. when the response lacks a Content-Type header).
- **`qa.html` served as a static file from `public/`** (at `/qa`) — no build step, no framework, no HMR dependency. Works any time the dev server is running. Drag support uses `dragstart` + `text/uri-list` so the app receives the image URL rather than an opaque drag object.
- **`qa-scratch/` served via Vite middleware, not committed to `public/`** — scratch images are gitignored by definition; putting them in `public/` would commit them. A small `configureServer` plugin in `vite.config.ts` serves `qa-scratch/` at `/qa-scratch/` during development only. Nothing in the plugin runs at build time or ships to production.
- **Three-tier clipboard fallback: `navigator.clipboard` → `execCommand` → modal** — `navigator.clipboard.writeText` requires document focus; it fails silently in split-window QA setups (picker in one tab, app in another). `execCommand('copy')` works without focus. If both fail (sandboxed iframe, some mobile browsers), a modal shows the report text pre-selected so the user can `⌘C` manually. Each tier is tried in order; the modal is the last resort, never the default.

## Scatter spread investigation (Story 46c)

**Decision: Outcome B — real bug, step-size formula does not account for `canvasScale`.**

The `spiralPlace` formula (`bench.ts:976`) computes step size in texture pixels:
```ts
const stepSize = maxDim * Math.SQRT2 * 1.3;   // maxDim in texture px
```
But spiral positions are world coordinates, where a piece occupies `maxDim × canvasScale` world units (because sprites are placed with `sprite.scale.set(_canvasScale)`). The formula should multiply by `_canvasScale`:
```ts
const stepSize = maxDim * _canvasScale * Math.SQRT2 * 1.3;
```

Without the fix, spread factor(N) = `√2 × 1.3 × N × 1.5 / (2π × canvasScale)` — depends on `canvasScale`. Images that are larger than the screen (canvasScale < 1) produce a spread many times wider than expected. With the fix, spread factor(N) = `√2 × 1.3 × N × 1.5 / (2π)` ≈ `0.439 × N`, constant for all images.

**Viewport scale:** `viewport.scale = 1.0` for all images — `loadScene` has no `setZoom` or fit call; pixi-viewport defaults to scale 1. Screen-space spread equals world-space spread throughout. Outcome C is not the issue.

**The bug predates Story 46.** The formula was already canvasScale-blind. It went unnoticed because the only pre-45 test image (`test-image.jpg`, 800×600) happened to produce `canvasScale = 1.5` — giving compact 1.46× spread. Real phone images (2048×1536, `canvasScale ≈ 0.586`) give 3.75× spread. Story 46 did not widen the spread; it exposed the flaw by making real images the default input.

### Measurement table

Assumptions: 1440×900 screen, `viewport.scale = 1.0`.  
`r(N)` values are world units = screen pixels at `viewport.scale = 1`. Spread factor = `r(N) / screen_piece_width`.

**Pre-Story-46 baseline (4×4 hard-coded grid)** — only `test-image.jpg` was used in practice.

| Image | Grid | maxDim (px) | canvasScale | stepSize | r(N=5) | r(N=10) | r(N=16) | r(N=50) | screen piece (px) | spread@N=5 |
|---|---|---|---|---|---|---|---|---|---|---|
| test-image.jpg 800×600 | 4×4=16 | 200 | 1.500 | 367.7 | 438.9 | 877.8 | 1404.5 | 4388.9 | 300 | 1.46× |
| phone 2048×1536 | 4×4=16 | 512 | 0.586 | 942.4 | 1124.9 | 2249.8 | 3599.7 | 11249 | 300 | 3.75× |
| panorama 2048×102 | 4×4=16 | 512 | 0.703 | 942.4 | 1124.9 | 2249.8 | 3599.7 | 11249 | 360 | 3.12× |

**Post-Story-46, pre-fix (dynamic `computeGrid`)** — same formula, different piece dimensions.

| Image | Grid | maxDim (px) | canvasScale | stepSize | r(N=5) | r(N=10) | r(N=16) | r(N=50) | screen piece (px) | spread@N=5 |
|---|---|---|---|---|---|---|---|---|---|---|
| test-image.jpg 800×600 | 13×10=130 | 61 | 1.500 | 112.2 | 133.9 | 267.9 | 428.6 | 1339.4 | 91.5 | 1.46× |
| phone 2048×1536 | 15×11=165 | 139 | 0.586 | 255.8 | 305.3 | 610.7 | 977.1 | 3053.5 | 81.5 | 3.75× |
| panorama 2048×102 | 34×2=68 | 60 | 0.703 | 110.3 | 131.7 | 263.4 | 421.4 | 1316.9 | 42.2 | 3.12× |

**Spread factor is unchanged from pre-46** — Story 46 did not alter the formula. The spread factor depends only on `canvasScale` (image size) and N, not on grid dimensions or piece count.

**Post-fix (stepSize = maxDim × _canvasScale × √2 × 1.3)** — spread factor = 0.439 × N for all images.

| Image | stepSize (fixed) | r(N=5) | r(N=10) | r(N=16) | r(N=50) | spread@N=5 |
|---|---|---|---|---|---|---|
| test-image.jpg 800×600 | 168.4 | 200.9 | 401.9 | 643.0 | 2009.3 | 2.20× |
| phone 2048×1536 | 150.0 | 179.0 | 358.0 | 572.8 | 1790.1 | 2.20× |
| panorama 2048×102 | 77.6 | 92.6 | 185.3 | 296.5 | 926.4 | 2.20× |

The fixed spread (2.20× at N=5) is wider than the old test-image.jpg experience (1.46×) but narrower than the current phone-image experience (3.75×), and — critically — consistent across all image sizes.

**Alternatives considered and rejected:**
- Tune the 1.3 constant down to ~0.865 to preserve 1.46× — a smell that would re-break for any non-1.0 viewport scale; the unit mismatch is the actual bug.
- Cap `canvasScale` at 1.0 to clamp the fix for large images — hides the fact that small images (canvasScale > 1) had the formula going the other way (steps too large relative to pieces); consistent is better.
- Use geometric mean `sqrt(pieceW × pieceH)` instead of `max` — orthogonal; doesn't fix the canvasScale omission and adds complexity.

## fixtures.json format (test/fixtures)

- **`notes` at top level, not inside `expected`** — notes describe what the fixture tests; `expected` describes the system output. Mixing them makes `expected` harder to use as an assertion shape. `notes` is prose for humans; `expected` is data for test runners.
- **No story or AC references in `notes`** — fixtures outlive the stories that created them. A note like "exercises AC-3, AC-5" is stale the moment the story closes. Notes describe the behavior under test: the image property that's interesting, the code path it exercises, why a user-supplied image wouldn't reproduce it as reliably.

## Process
- **Never commit without explicit user instruction** — present completed work, wait for the user to explicitly say "commit" or similar. No exceptions. Do not infer commit approval from task completion or "LGTM" style feedback. No auto-commit at end of session, no commit as part of /refine.

## Extraction reconciliation pattern (Story 41a)

Three concerns, always separated:

1. Mutation        — `extractPieceFromBench()` owns the state change
2. Reconciliation  — `reconcileBenchState()` lives inside mutation, never at call sites
3. Focus continuation — keyboard handler only, never inside mutation

Bench collapse = single event via `applyBenchCollapseEffects()`.
`inert` + `keyboardMode` + `benchOpen` all derive from one call — never set independently.
`applyBenchCollapseEffects()` is idempotent — safe to call multiple times via `_benchCollapsed` guard.

`isBenchEmpty()` is the sole collapse trigger — not input method.
Focus fallback: next only, no reverse. Linear traversal, predictable.

This pattern repeats in Story 41b for table interactions.
`applyBenchCollapseEffects()` is a terminal transition — not a general utility.
`setKeyboardMode` inside collapse is intentional but scoped — 41b must not create
circular transitions by calling `setKeyboardMode` from table collapse into bench.

## Table keyboard navigation (Story 41b)

**Table reconciliation mirrors bench reconciliation:**
- `reconcileTableState()` lives inside the `loadScene` closure (needs `_heldRef` and `setFocusedTarget`).
- Called from inside `applyBoardSnap` — the shared board snap function, analogous to `reconcileBenchState` inside `extractPieceFromBench`.
- Only clears keyboard state (`_heldRef.value = null`, `setFocusedTarget(null)`) — completion detection is already handled by existing `puzzleComplete` check immediately before it.

**`_heldRef` as a ref object, not a plain variable:**
- `reconcileTableState` and `applyBoardSnap` are nested functions inside `loadScene` that need to read and mutate the same `_heldPieceId` value. A plain `let` variable can't be closed over mutably across sibling functions defined in the same scope when passed as an argument.
- `const _heldRef = { value: null as string | null }` is a ref object that all closures share. Mutation via `_heldRef.value = ...` is visible to all readers.

**`applyBoardSnap` extracted from `setBoardSnapCallback`:**
- Board snap logic (pulse animation, shadows, completion, reconciliation) was previously inlined inside the drag callback. Extracting into a named `applyBoardSnap(groupId, heldRef)` function allows the keyboard put-down path (`checkSnapAtCurrentPosition`) to call the same logic without duplication.
- `setBoardSnapCallback` now calls `applyBoardSnap(groupId, _dragHeldRef)` where `_dragHeldRef` is a dummy ref (drag never holds a keyboard piece).

**`getFirstTablePieceId` in snap.ts — store only, no DOM query:**
- Focus handoff after board snap uses the store directly: `.filter(isOnTable && !placed).sort(index)[0]`. DOM queries are fragile (depend on button existence and tab order already being synced). Store is always authoritative.

**Spatial hash not updated after keyboard snap:**
- See gotchas.md — deferred until arrow key movement ships.

## Board size matches piece coverage, not image dimensions (Story 46e)

The board was drawn at `imageWidth × imageHeight`. Piece dimensions are `Math.floor(imageWidth / cols) × Math.floor(imageHeight / rows)`, so total piece coverage is `cols × pieceW × rows × pieceH` — always ≤ the image dimensions by up to `cols-1` px on the right and `rows-1` px on the bottom. The remainder pixels are not part of any piece texture. Corner pieces at their canonical positions therefore had visible gaps against the board edges on 3 of 4 corners (top-left happened to align because its origin is (0,0)).

**Fix chosen: Option A — shrink board to piece coverage.** Two locations required changes:
1. `createBoard` in `board.ts` — `bw = Math.floor(imageWidth / cols) * cols * scale` and `bh` equivalent.
2. `boardLeft`/`boardTop` in `scene.ts` — the canonical-position origin also used `texture.width * scale`; changed to `piecePixelW * cols * scale`. Both must stay in sync: the board rect and the canonical-position origin must use identical coverage dimensions or corners will be offset even with the correct board size.

`cols`/`rows` were already in the `createBoard` signature (previously `void`-ed). No change to the centering math, shadow, or call-site signature.

Options B (extend last-row/col pieces by remainder) and C (pad image at ingest to even dimensions) were ruled out per the story prompt. B requires invasive changes to cutter, snap, and render; C modifies the ingest pipeline and loses image content. A is the correct layer: the board must adapt to the pieces, not the other way around.

## Curated image set + forceGrid override (Story 48)

### forceGrid sessionStorage key, not a loadScene URL param
The curated `forceGrid` is stored in a separate `sessionStorage` key (`jigg:forceGrid`) alongside `jigg:pendingImageUrl`. The boot code reads both keys and passes the grid to `loadScene`. Alternative was a query-string param on the reload URL, but sessionStorage is already the established pattern for cross-reload state and avoids URL parsing.

### forceGrid validated in loadScene, not at the call site
The guard (`cols >= 2 && rows >= 2 && cols * rows <= 200`) lives inside `loadScene` rather than in `main.ts` or `images.ts`. `loadScene` is the owner of `computeGrid` and grid constraints — it's the correct layer to enforce them. Callers pass intent; the scene enforces invariants.

### Picker panel reuses the Story 47 "Choose Image" button, not a new button
The story prompt ruled out adding a second button. Repurposing the existing button as a dialog trigger is the minimal change: one button still opens the image flow, the flow just has a richer first step (pick from curated set or upload). No UI chrome was added.

### `<dialog>` for the picker panel
Native `<dialog>` provides Escape handling, `showModal()` focus management, and `::backdrop` for free, at zero JS cost. The main gap (focus-return on close, outside-click detection) is covered by the `cancel` event and a click listener on the dialog element itself (checking `e.target === dialog` detects backdrop clicks without a separate overlay element).

### forceGrid cleared from sessionStorage on every non-curated load
`handleImageFile` always calls `sessionStorage.removeItem(SESSION_GRID_KEY)` before reloading. This ensures a user who picks a curated image, then drops their own file, does not accidentally inherit the previous forced grid.

---

## Bench piece uplight glow (Story 47a)

**Shipped:** 2026-04-22.

### Why the stroke recommendation was rejected

The 47a-spike recommended an always-on thin dual-tone stroke (inner white 1 px α 0.40 + outer black 1.5 px α 0.45) as the primary fix. This was rejected because it modifies the piece art itself: the OutlineFilter renders around the sprite's alpha mask, so any stroke—however faint—becomes part of the piece's visual boundary. Puzzle pieces are content (artwork), not chrome. Altering the visible boundary of every piece with a permanent synthetic ring is a content-level change, not a visibility aid.

### Chosen approach: per-slot uplight glow (chrome only)

The bench's visibility problem is a **bench** problem, not a piece problem. The fix lives in the bench layer only: each occupied bench slot gets a soft warm gradient behind the piece sprite. The gradient is brighter at the bottom of the slot (where the bench background is darkest relative to the piece) and fades to transparent by ~60% up the slot. Zero effect on the piece sprite, texture, filters, or geometry.

Metaphor: pieces resting on a dimly lit shelf with ambient light rising from below.

### Implementation

- `addBenchGlowToContainer(container)` inserts a `Graphics` node at index 0 of the piece container (behind the sprite at index 1). Tagged `'bench-glow'` on `.label` for idempotent add/remove.
- `layoutTrayPieces` calls `getGlowGradient()` and redraws the glow at the correct cell position on every layout pass (filter change, extraction, resize, load).
- `FillGradient` with `textureSpace: 'local'` — gradient coords match the slot rect in local Graphics space. One shared gradient instance per puzzle session (cached in `_glowGradient`).
- Glow is removed from a container in `extractPieceFromBench` (before reparent to viewport) — canvas pieces have no glow.

### Tunable constants (top of bench.ts)

| Constant | Default | Role |
|---|---|---|
| `BENCH_GLOW_COLOR` | `0xfff5e0` | Warm off-white uplight color |
| `BENCH_GLOW_ALPHA_MAX` | `0.22` | Alpha at the bottom edge |
| `BENCH_GLOW_FADE_STOP` | `0.60` | Fraction from bottom where alpha reaches 0 |

### HC and the glow

The glow is **unconditional** — it stays on in HC mode. The original story prompt called for HC-gating it off (theory: sandwich stroke provides 21:1 so no glow needed). QA showed that removing the glow in HC mode left dark pieces invisible on the dark bench, because the sandwich stroke handles edge contrast but does nothing for overall slot visibility. The two treatments are complementary, not redundant: glow = slot-level lift; sandwich = WCAG-strict edge contrast. Both coexist cleanly.

### What this does and doesn't fix

The glow lifts dark pieces off the bench for sighted users. It is intentionally **not WCAG-strict**: a pure-black piece in the bench reaches roughly 2:1–2.5:1 at the bottom edge of the slot, still below the 3:1 WCAG 1.4.11 threshold. This is accepted — bench pieces are transient (users extract them immediately), and the remaining visibility gap on the board side (white pieces on white board) is handled separately in Story 47b.

---

## Piece contrast audit — WCAG 1.4.11 (Story 47a-spike)

**Spike date:** 2026-04-22. **No production code changed this session.** This entry is the primary deliverable.

---

### Context

User-reported: white pieces vanish against the off-white board; black pieces vanish against the dark bench. Scope expanded to the full matrix of piece colors × rendering contexts, covering both normal and high-contrast (HC) mode.

**Threshold:** WCAG 2.1 SC 1.4.11 "Non-text Contrast" — 3:1 for essential graphical objects in normal mode; 4.5:1 for HC (user's explicit signal that they need stronger separation).

---

### Current rendering configuration (as-of audit)

| Element | Value |
|---|---|
| Board fill | `#ffffff` (L = 1.00) |
| Workspace / WebGL clear | `#f5f5f3` (L ≈ 0.912) |
| Body CSS background | `#f5f5f3` |
| Bg preset — off-white | `#f5f5f3` (L ≈ 0.912) |
| Bg preset — gray | `#808080` (L ≈ 0.216) |
| Bg preset — charcoal | `#2a2a2a` (L ≈ 0.023) |
| Bench fill — normal | `#1a1a1a` at α 0.85 → effective `~#3b3b3b` (L ≈ 0.044) |
| Bench fill — HC | `#000000` at α 1.00 (L = 0.000) |
| Snap highlight — normal | `#00ff00` tint at α 0.4 (applied to piece, not board) |
| Snap highlight — HC | `#ff00ff` tint at α 1.0 |
| BevelFilter | rotation 225°, thickness 2, lightAlpha 0.2, shadowAlpha 0.2 (HC: 0.36/0.36) |
| DropShadowFilter (pieces) | resting offset {0,3}, blur 8, alpha **0.06**, resolution 1 |
| DropShadowFilter (board) | offset {0,8}, blur 24, alpha 0.06, resolution 1 |
| OutlineFilter sandwich | HC-only — inner white 1.5 px + outer black 2.5 px |

**Note:** `decisions.md §"Piece Shadows"` says DropShadowFilter was "disabled". It has since been re-enabled at `resolution: 1` and alpha 0.04–0.10 (three states). The decisions entry is stale; this audit reflects the live code.

---

### Relative luminance values used

Formula: `L = 0.2126×R + 0.7152×G + 0.0722×B` (R, G, B linearised via IEC 61966-2-1).

**Piece color buckets:**

| Label | Hex | L |
|---|---|---|
| Pure white | `#ffffff` | 1.000 |
| Near-white | `#f0f0f0` | 0.872 |
| Pure black | `#000000` | 0.000 |
| Near-black | `#101010` | 0.005 |
| Mid-gray | `#808080` | 0.216 |
| Saturated red | `#cc3333` | 0.154 |
| Saturated blue | `#3333cc` | 0.074 |
| Saturated green | `#33cc33` | 0.441 |

**Background luminances:**

| Context | Effective L |
|---|---|
| Board | 1.000 |
| Workspace / off-white preset | 0.912 |
| Gray preset | 0.216 |
| Charcoal preset | 0.023 |
| Bench — normal (effective) | 0.044 |
| Bench — HC | 0.000 |

---

### Contrast matrix (no treatments applied)

Contrast ratio = `(L_lighter + 0.05) / (L_darker + 0.05)`. **Bold** = failing cell. Threshold: 3:1 normal, 4.5:1 HC (HC column = Bench HC only for now; all contexts apply 3:1 unless the user has enabled HC mode).

| Piece color | Board | Workspace | Gray preset | Charcoal preset | Bench normal | Bench HC |
|---|---|---|---|---|---|---|
| Pure white | **1.1:1** ❌ | **1.1:1** ❌ | 3.9:1 ✅ | 14.4:1 ✅ | 11.2:1 ✅ | 21:1 ✅ |
| Near-white | **1.1:1** ❌ | **1.0:1** ❌ | 3.5:1 ✅ | 12.6:1 ✅ | 9.8:1 ✅ | 18.4:1 ✅ |
| Pure black | 21:1 ✅ | 19.2:1 ✅ | 5.3:1 ✅ | **1.5:1** ❌ | **1.9:1** ❌ | **1.0:1** ❌ |
| Near-black | 19.0:1 ✅ | 17.4:1 ✅ | 4.8:1 ✅ | **1.3:1** ❌ | **1.7:1** ❌ | **1.1:1** ❌ |
| Mid-gray | 4.0:1 ✅ | 3.6:1 ✅ | **1.0:1** ❌ | 3.6:1 ✅ | **2.8:1** ❌ | 5.3:1 ✅ |
| Sat. red | 5.1:1 ✅ | 4.7:1 ✅ | **1.3:1** ❌ | **2.8:1** ❌ | **2.2:1** ❌ | 4.1:1 ✅ |
| Sat. blue | 8.5:1 ✅ | 7.7:1 ✅ | **2.1:1** ❌ | **1.7:1** ❌ | **1.3:1** ❌ | **2.5:1** ❌ |
| Sat. green | **2.1:1** ❌ | **2.0:1** ❌ | **1.9:1** ❌ | 6.7:1 ✅ | 5.2:1 ✅ | 9.8:1 ✅ |

**Failing patterns at a glance:**
- Light pieces (white / near-white) fail on the board and workspace background — the two most common at-rest contexts.
- Dark pieces (black / near-black) fail on the bench (both modes) and on charcoal preset.
- Saturated mid-luminance hues (red, blue, green) fail against the gray preset and several bench/charcoal contexts.
- Mid-gray fails against both the gray preset and the bench (normal).
- Saturated blue fails even against Bench HC (2.5:1 < 4.5:1 HC threshold).

---

### Existing treatment audit

#### BevelFilter — thickness 2, lightAlpha 0.2, shadowAlpha 0.2 (HC: 0.36)

The bevel renders a 2 px rim in two quadrants: a highlight (white at lightAlpha) and a shadow (black at shadowAlpha). For a **white piece on a white board** the highlight quadrant is invisible (white on white) and the shadow quadrant adds a 2 px band at approximately:

- `effective_shadow = 0.8 × #ffffff + 0.2 × #000000 = #cccccc` → L ≈ 0.60
- Contrast of the shadow band vs white board: `(1.05)/(0.65) ≈ 1.6:1`

In HC mode (shadowAlpha 0.36): `effective_shadow ≈ #a3a3a3` → L ≈ 0.36, contrast ≈ 2.6:1.

**Verdict:** BevelFilter does not meet 3:1 for white-on-white even in HC mode. It contributes visible depth for mid-luminance pieces but is insufficient as a contrast mechanism for extreme piece colors.

#### DropShadowFilter (pieces) — alpha 0.06, blur 8, offset {0,3}

At alpha 0.06, the shadow region effective color against white board:

- `effective = (1 − 0.06) × #ffffff + 0.06 × #000000 ≈ #f0f0f0` → L ≈ 0.87
- Contrast vs white board: 1.14:1

The diffuse shadow blur (8 px Gaussian) ensures no point in the shadow region reaches alpha 0.06 uniformly; actual peak contribution is well below 0.06. The shadow provides essentially no WCAG-relevant contrast at the piece boundary.

**Verdict:** DropShadowFilter at these parameters contributes lift / layering for sighted users but does not meet any WCAG contrast threshold. The "disabled" entry in this document is stale — the filter is live but its contrast contribution remains negligible.

#### OutlineFilter sandwich (HC-only) — inner white 1.5 px + outer black 2.5 px

The sandwich guarantees that at least one of the two OutlineFilter passes produces high-contrast separation, regardless of piece color:

- Against a light background (board / workspace): the 2.5 px black outer ring is visible — black vs white = 21:1.
- Against a dark background (bench HC `#000000`): the 1.5 px white inner ring is visible — white vs black = 21:1.
- For a white piece on white board: outer black ring at the piece boundary = black (L=0) vs board (L=1.0) = 21:1.
- For a black piece on HC bench (L=0): inner white ring = 21:1.

**Verdict:** The sandwich reliably meets the 4.5:1 HC threshold for all piece colors and all tested backgrounds. It is correct and sufficient in HC mode. It is HC-only — normal mode receives no outline treatment.

#### DropShadowFilter (board) — alpha 0.06, blur 24

The board shadow gives the board card visual lift off the workspace background. It has no direct effect on piece-vs-background contrast; it affects board-vs-workspace contrast only. Not relevant to piece visibility.

---

### What the snap highlight adds (for completeness)

During a 150 ms snap pulse the piece's `tint` is set to `0x00ff00` (normal) or `0xff00ff` (HC). Tinting in PixiJS multiplies pixel colors. For a bright (near-white) piece tinted green the piece appears approximately green during the pulse — visible against the white board (green L≈0.72, contrast ≈ 1.4:1 vs white — actually this is poor). The snap animation is transient and not a valid substitute for at-rest contrast.

HC snap (magenta `#ff00ff`): L ≈ 0.28, contrast vs board = 3.1:1 — marginally passes 3:1.

---

### Primary recommendation — Always-on thin outer stroke (normal mode)

**Recommended approach:** Extend the existing OutlineFilter infrastructure to add a **thin outer-only stroke in normal mode** for all pieces. This is a simplified, lower-cost version of the HC sandwich:

- A single `OutlineFilter` with thickness **1 px**, color `#000000`, quality 0.10, alpha **0.35**.
- Applied to every piece on CUTS_COMPLETE, tagged `'normal-outline'` for idempotent management (same pattern as `hc-sandwich`).
- In HC mode, the sandwich replaces the normal outline (remove `normal-outline`, add sandwich).

**Effect on failing cells:**

A 1 px black outline at alpha 0.35 on a white piece against a white board:
- The outline band effective color: `0.65 × #ffffff + 0.35 × #000000 = #a9a9a9` → L ≈ 0.42
- Contrast of outline vs white board: `(1.05)/(0.47) ≈ 2.23:1` — still fails 3:1.

At alpha **0.55** on a 1.5 px outline:
- Effective color: `0.45 × #fff + 0.55 × #000 = #73737` → L ≈ 0.18
- Contrast vs board: `(1.05)/(0.23) ≈ 4.6:1` — passes 3:1 and approaches 4.5:1.

The effective alpha on the outline is modulated by the `OutlineFilter.quality` (fragment sample resolution) — testing is required to confirm the perceived alpha matches the specification. A starting point of **thickness 1.5 px, color `#000000`, alpha 0.55** is recommended.

**For dark pieces on dark bench:**
A dark outline doesn't help black-on-dark. The solution for this side of the matrix is a **light inner outline** or a white outer ring. The sandwich stroke covers both cases; the normal-mode single-color outline cannot.

**Revised recommendation — lightweight dual-tone stroke (normal mode):**
- Inner stroke: white, 1 px, alpha 0.4 (helps dark pieces on dark bench)
- Outer stroke: black, 1.5 px, alpha 0.45 (helps light pieces on light board)

This is a scaled-down sandwich at lower alpha. Both strokes use the existing `OutlineFilter` from `pixi-filters`. Both would be tagged `'normal-outline'` and replaced by the full sandwich in HC mode. Runtime cost: two extra filter passes per piece per frame (same cost as HC sandwich today).

**What it might break:**
- BevelFilter depth illusion: the stroke renders outside the piece boundary (beyond the alpha mask). At thickness 1–2 px and moderate alpha, the ring will slightly reduce the visual impression of floating. Testing needed.
- HC sandwich: no interaction — the normal outline is removed before the sandwich is applied.
- Snap highlight: no interaction — tint is applied to the piece texture, outline is a separate pass.

---

### Alternative A — Higher-alpha DropShadowFilter

Raise piece DropShadowFilter alpha from 0.06 to ≥ 0.30. At alpha 0.30, resting shadow:
- Effective at peak shadow pixel: `0.70 × #fff + 0.30 × #000 = #b3b3b3` → L ≈ 0.47
- Contrast vs board: `(1.05)/(0.52) ≈ 2.0:1` — still fails.

Even at alpha 0.55 the diffuse Gaussian blur means no boundary pixel reaches alpha 0.55 — actual peak is lower. The shadow approach cannot reliably hit 3:1 at the piece boundary because the blur spreads and dilutes the contrast. Not recommended.

---

### Alternative B — Board color tint

Change board from `#ffffff` (L=1.0) to a neutral mid-light gray, e.g. `#c8c8c8` (L≈0.58).

- White piece vs `#c8c8c8`: `(1.05)/(0.63) = 1.67:1` — still fails.
- `#b0b0b0` (L≈0.44): `(1.05)/(0.49) = 2.14:1` — still fails.
- `#808080` (L=0.216): `(1.05)/(0.266) = 3.95:1` — passes, but a mid-gray board is a strong visual change.

A gray board resolves white-piece visibility but creates new failures: near-black piece on charcoal preset, saturated blue vs gray. Does not fix the bench problem. Not recommended as the primary fix; may be worth as a secondary tweak once the stroke approach is in place.

---

### Adaptive background thresholds (reminder)

From Story 37a: luminance < 100 → off-white, > 150 → charcoal, else gray. This document uses luminance 0–255 scale for the threshold (raw sRGB value) — distinct from the WCAG relative luminance (0–1) used in the contrast calculations above.

---

### Follow-up story brief — Story 47a: Piece Visibility Fix

**Title:** Add always-on thin dual-stroke outline to normal mode

**Goal:** Bring all piece × background combinations in normal mode to ≥ 3:1 contrast at the visible boundary.

**Approach:** Normal-mode dual-tone `OutlineFilter` pair (inner white 1 px α 0.40, outer black 1.5 px α 0.45), tagged `normal-outline`, applied in CUTS_COMPLETE alongside BevelFilter. Removed and replaced by HC sandwich when high contrast is toggled on.

**Files likely to touch:**
- `src/utils/preferences.ts` — add `addNormalOutline` / `removeNormalOutline` helpers (mirror `addSandwichStroke` pattern); adjust `applyHighContrast` to swap normal → sandwich
- `src/canvas/scene.ts` — call `addNormalOutline` after BevelFilter is applied in CUTS_COMPLETE
- `docs/decisions.md` — this entry (done)
- `public/qa.html` — STORY + FIXTURES for Story 47a

**Constraints (must not break):**
1. BevelFilter must remain at index 0 in `sprite.filters`; normal outlines appended after it
2. HC sandwich must replace (not stack on top of) the normal outline
3. Snap highlight behaviour (piece tint) is unchanged
4. DropShadowFilter (pieces and board) is unchanged
5. Greyscale filter (`ColorMatrixFilter`) ordering rules from `preferences.ts` remain intact

**Acceptance criteria (measured against the same matrix):**
- **AC-1:** White piece on board: contrast ≥ 3:1 at the piece/board boundary (outer stroke band vs board)
- **AC-2:** Near-black piece on bench (normal): contrast ≥ 3:1 at the piece/bench boundary (inner stroke band vs bench)
- **AC-3:** HC mode unchanged: all 8 piece colors × all 6 backgrounds meet 4.5:1 in HC (sandwich still applied)
- **AC-4:** BevelFilter still visually present and at index 0 (depth illusion not broken)
- **AC-5:** No filter accumulation on rapid HC toggle — add/remove is idempotent (`normal-outline` tag pattern)
- **AC-6:** `git diff src/` before this story = empty (no accidental normal-mode code from this spike)
