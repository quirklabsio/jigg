<!-- audience: Dev, Agent, BA -->

# Jigg Architecture

> This document is the authoritative architectural reference for the Jigg application.
> All development stories, agent tasks, and module decisions should be made in accordance with it.
> When in doubt, consult this document before introducing new abstractions.

---

## Mental Model

The Jigg pipeline is a recipe. A raw ingredient enters, passes through discrete preparation stages, and emerges as a presented dish. Each stage has a clear responsibility and a defined contract with its neighbors. No stage reaches across another's boundary.

```
Intake → Chop → Cook → Plate
```

The pipeline has two phases:

```
Derivation (pure):    Intake → Chop → Cook → RenderSpec
Realization (impure): Plate + Store (runtime)
```

- **Derivation** — pure transforms. Given the same inputs, always produces the same outputs. No side effects, no mutable state, no external reads.
- **Realization** — Plate initializes from the `RenderSpec`, then continues running as a runtime participant. The Store holds mutable interaction state that evolves over time.

**Plate is the bridge.** It sits at the boundary between derivation and runtime. It completes the pipeline contract by realizing the world the spec describes — and then keeps that world alive. It is in the pipeline because rendering must happen. It is in runtime because side effects, user interaction, and long-lived state are fundamentally different from pure derivation.

The key constraint that makes this work:
> Plate does not decide. It only executes and reacts.

Plate can only ever react to `RenderSpec` (structure) and Store (state). It never derives structure, never reinterprets the puzzle, never applies accessibility rules. If that line holds, the dual role is a feature, not a flaw.

---

## Intake Paths

Before the pipeline starts, the application must identify which path the user is on. There are three:

| Path | Chop? | Cook? | Notes |
|---|---|---|---|
| **New from image** | Always | Always | Full pipeline |
| **New from .jigg** | Conditional | Always | Chop re-runs if user changes cut params; uses `.jiggsaw` default dissection otherwise |
| **Resume from .jigg** | Never | Always | Cook reads sealed `dissection.json` from `.jiggstate`; Store hydrated from `assembly.json` |

> **Cook always runs.** Regardless of path, `RenderSpec` is always produced by Cook. Plate's input contract never changes.

> **New from .jigg:** The user may override cut parameters (piece count, cut style, etc.) at game setup time. When they do, Chop runs fresh and a new dissection is written into a new `.jiggstate`, overwriting any previous playthrough.

The intake path is expressed as a discriminated union — not prose, not a flag. Invalid combinations are not representable:

```ts
type IntakeResult =
  | { kind: 'new-image';  payload: IntakePayload }
  | { kind: 'new-jigg';   payload: IntakePayload; hasDissection: boolean }
  | { kind: 'resume';     dissection: JiggDissection; assembly: JiggAssembly }
```

Orchestration reads this type and routes accordingly. Nothing downstream needs to guess which path it's on.

---

## Pipeline Stages

Every stage in the derivation phase conforms to the same formal contract:

```ts
type Stage<I, O> = (input: I) => Promise<O>
```

This makes stages independently testable, replaceable, and composable. If a stage needs more than its typed input to do its job, the contract is incomplete.

---

### 1. Intake
**Responsibility:** Accept input, identify the intake path, validate the file, normalize the raw material, and produce a typed `IntakeResult` for the orchestrator.

Normalization is real work here — format detection, dimension normalization, color profile (sRGB), EXIF orientation correction. Nothing moves forward unless it passes.

**Inputs:**
- Raw image file (JPEG, PNG, etc.)
- `.jigg` file

**Outputs:**
- `IntakeResult` — discriminated union encoding the path and all downstream data needed to proceed

**Explicitly not responsible for:**
- Any cutting, dissection, or analysis of image content
- Game state
- UI decisions

**Module:** `src/pipeline/intake/`

---

### 2. Chop
**Responsibility:** Perform all computationally intensive image analysis off the main thread. Produces cut geometry and derives the image palette. This is the only stage that runs in WASM.

**Inputs:**
- `IntakePayload`
- `CutParams` (optional) — user-supplied cut preferences (piece count, cut style, etc.). Falls back to defaults if absent. Shape is intentionally open-ended — do not over-specify early.

**Outputs:**
- `CutsReady` — in-memory transport payload crossing the worker → main thread boundary via `postMessage`
- `JiggDissection` — the durable domain artifact constructed from `CutsReady` on the main thread. Written once into `.jiggstate` at game creation. Immutable for the life of the playthrough.

`CutsReady` is a transport artifact. `JiggDissection` is the domain artifact. Do not conflate them.

**Explicitly not responsible for:**
- Piece semantics — that's Cook's job
- Accessibility rules
- Anything on the main thread during execution

**Runtime:** Rust/WASM inside a Web Worker. Communication with the main thread is exclusively via typed message passing.

**Internal structure:**
```
chop/
  host/       # TS side — spawns worker, sends/receives messages
  worker/     # Worker wrapper — loads WASM, handles message protocol
```

**Module:** `src/pipeline/chop/` (host) + `crates/chop/` (WASM)

---

### 3. Cook
**Responsibility:** Receive a `JiggDissection` and reduce it into a complete, render-ready spec. Combines all artifacts, applies static accessibility rules, and produces the single source of truth for rendering. No decisions are made after this point.

**Cook must be deterministic.** Given the same inputs, it must always produce the same `RenderSpec`. No randomness, no time-based logic, no feature flags from runtime. Violations break reproducibility, snapshot testing, and debugging.

Cook reads from `a11y/static/` only. It must never read mutable state from the Store — if it does, the derivation/realization boundary has collapsed.

**Inputs:**
- `JiggDissection` — authoritative cut record. On new game: derived from `CutsReady`. On resume: read directly from `.jiggstate`. Cook does not care which path produced it.
- `A11yStatic` config (always-on defaults + user prefs snapshot)

**Outputs:**
- `RenderSpec` — fully-resolved, versioned, serializable. Describes exactly what Plate must render.

**Explicitly not responsible for:**
- Executing any rendering
- Communicating with WASM
- Persisting state
- Runtime accessibility behavior (focus, keyboard, announcements)
- Any logic that depends on runtime state

**Module:** `src/pipeline/cook/`

---

#### Cook Admission Rules

Before adding anything to Cook, apply this test:

> *"Does this change the structure of the world, or how the world behaves?"*
> - Structure → Cook
> - Behavior → runtime (Plate / Store / a11y runtime)

A concern may only be added to Cook if **all** of the following are true:

1. It is a pure function of Cook's inputs (`JiggDissection` + `A11yStatic`)
2. It is deterministic — no randomness, no time, no external state
3. It does not depend on runtime state (Store)
4. It affects the structure of the rendered world, not interaction behavior
5. It must be identical across fresh load and resume

If even one fails → it does not belong in Cook.

**Litmus tests:**

- *"If I serialize `RenderSpec` and reload it, must this still be true?"* → If yes: Cook.
- *"Does this change while the user is playing?"* → If yes: never Cook.

**The trap cases:**

| Temptation | Rule |
|---|---|
| Layout tweaks based on difficulty | Deterministic from inputs → Cook. Adapts during play → runtime. |
| Accessibility edge case | Static (color, motion flags) → Cook. Interaction (focus, announcements) → runtime. |
| Helper property on `RenderSpec` to make Plate easier | Ask: is Plate missing information, or am I making Plate smarter? Missing info → Cook. Making Plate smarter → don't. |

**When unsure: prototype in Plate first.** If it works fine there, it probably belongs in runtime. If Plate feels constrained or dumb, something is missing from Cook.

Cook should feel like a compiler — fixed inputs, fully resolved output, no memory, no context, no evolution. If it starts feeling like a service layer, a rules engine, or a coordinator, it's already drifting.

---

### 4. Plate
**Responsibility:** Bridge between derivation and runtime. Plate has two distinct modes:

**A. Initialization (pipeline-aligned)**
Consumes `RenderSpec` and realizes it — deterministic, one-shot, no decisions:
```ts
plate(RenderSpec) → PixiJS scene + ARIA DOM
```

**B. Runtime loop (app-aligned)**
After initialization, Plate becomes a long-lived runtime participant:
- Responds to Store changes
- Handles user input
- Runs ARIA interaction behaviors (focus, keyboard, announcements)
- Updates visuals reactively

Plate is constrained to react only to `RenderSpec` (structure) and Store (state). It never derives structure, never reinterprets the puzzle, never applies accessibility rules. If something isn't in the spec, Plate does not invent it.

**Inputs:**
- `RenderSpec` (initialization)
- Store (runtime reactions)

**Outputs:**
- PixiJS scene (bench + table) — visual
- ARIA DOM tree — static mirror + runtime interaction layer

**Explicitly not responsible for:**
- Game logic
- Deriving layout
- Static accessibility decisions (baked into spec by Cook)

**Internal structure:**
```
plate/
  index.ts          # orchestrates both renderers
  pixi/
    index.ts        # PixiJS executor — canvas render
  aria/
    index.ts        # ARIA DOM executor — static mirror from spec
    runtime/        # focus management, keyboard nav, screen reader announcements
```

**Module:** `src/pipeline/plate/`

---

## Orchestration (`src/pipeline/index.ts`)

The orchestrator wires stages together and routes based on `IntakeResult`. It is not a stage — it has no transformation responsibility of its own.

**Orchestration may:**
- Decide which stages to run based on intake path
- Pass stage outputs to stage inputs
- Handle errors and surface them appropriately

**Orchestration may not:**
- Transform data
- Derive new structures
- Contain business logic

If logic is accumulating in `pipeline/index.ts`, it belongs in a stage.

---

## Events

### `CutsReady`
The in-memory handoff from the WASM worker to the main thread. Transported via `postMessage`. On receipt, the main thread constructs a `JiggDissection` from it, which becomes Cook's input.

```ts
interface CutsReady {
  type: 'CutsReady';
  cuts: CutGeometry[];       // normalized vector die-lines
  palette: DerivedPalette;   // dominant colors from image analysis
}
```

This is a first-class named concept. Do not inline or anonymize it.

---

## Contracts

### `JiggDissection`
The durable output of Chop. Written once into `.jiggstate/dissection.json` at game creation and never mutated. It is the cut contract for the life of a playthrough — piece definitions, geometry, palette, cut style.

On resume, Cook reads this directly. This is what makes resume possible without re-running WASM.

### `JiggState`
Not a pipeline artifact — the persistence layer. Three entries:

| Entry | Mutability | Purpose |
|---|---|---|
| `glue.json` | Immutable | Playthrough identity, puzzle binding, manifest hash |
| `dissection.json` | Immutable | Sealed cut — Cook's input on resume |
| `assembly.json` | Mutable (every save) | Piece positions, clusters, rotation, stage, play time |

`assembly.json` is the serialized form of the Store's `JiggAssembly`. They are the same data at different points in time.

### `RenderSpec`
The most important artifact in the system. Produced by Cook. Consumed by Plate. Shared by nothing else.

```ts
interface RenderSpec {
  version: 1;
  board: BoardSpec;
  pieces: PieceSpec[];
  a11y: A11ySpec;            // static a11y decisions — colors, contrast, motion
  meta: {
    generatedAt: number;     // timestamp — useful for debugging and telemetry
    source: 'fresh' | 'resume';
  };
}
```

Rules:
- Must be fully serializable (no functions, no class instances)
- Must be versionable — `version` is required and must be incremented on breaking changes
- Must be **self-sufficient** — sufficient to fully reconstruct Plate's output without any external data. If Plate needs to read anything outside the spec to render, the spec is incomplete. Fix Cook, not Plate.
- Resume path must produce a valid `RenderSpec` before touching Plate

All shared pipeline types live in `src/pipeline/types.ts`. They are shared but owned by no single stage.

> **`CutParams`** is intentionally loosely typed. It represents user intent going into Chop — piece count, cut style, seed, and whatever else emerges. Do not over-specify it early.

---

## Accessibility

Accessibility is not a module. It is a constraint expressed differently across three layers that already own their respective concerns:

| Layer | Location | Responsibility |
|---|---|---|
| **Store** | `puzzleStore.a11y` | User intent and runtime state — contrast mode, reduce motion, focus mode |
| **Pipeline** | `cook/deriveA11ySpec.ts` | Deterministic derivation — produces `RenderSpec.a11y` from Cook inputs |
| **Plate** | `plate/aria/runtime/` | Runtime interaction behavior — ARIA, focus management, keyboard, announcements |

```
Store (user intent)
  ↓ snapshot passed as A11yPrefs
Cook → deriveA11ySpec() → RenderSpec.a11y
  ↓
Plate initializes from spec, then runtime/ handles interaction
```

**`deriveA11ySpec.ts` is the only place accessibility derivation happens.** It is a pure function — no store access, no runtime awareness. If it changes during gameplay it does not belong here.

**`plate/aria/runtime/` is the only place runtime accessibility behavior lives.** Focus, keyboard navigation, ARIA announcements, inert region toggling — all here.

There is no `src/a11y/` folder. Do not create one.

---

## Store (`src/store/`)

The store holds mutable runtime state only. It is never a source of derived or computed structure. It is the runtime representation of `JiggAssembly` — `assembly.json` is its serialized form.

| Concern | Location |
|---|---|
| Piece positions, stage, rotation | Store (`JiggAssembly`) |
| Cluster membership | Store (`JiggAssembly`) |
| Play time | Store (`JiggAssembly`) |
| User a11y prefs (contrast, motion) | Store — passed as `A11yPrefs` snapshot into Cook |
| Focus mode, selection, interaction state | Store — consumed by `plate/aria/runtime/` |
| Cut geometry / piece definitions | `JiggDissection` — not in Store |
| Board color, contrast, motion rules | Cook output via `RenderSpec.a11y` — not in Store |

If Cook reads from the Store, the derivation/realization boundary has collapsed.

---

## Module Conventions

TypeScript doesn't enforce boundaries the way .NET's DI container does. We compensate with explicit convention and tooling.

| .NET concept | Jigg equivalent |
|---|---|
| Service class + interface | `module/index.ts` (exports) + `module/types.ts` (contracts) |
| Assembly boundary | `src/pipeline/<stage>/` — no cross-stage imports |
| DI registration | Explicit wiring in `src/pipeline/index.ts` |
| Named service | Named module folder with barrel export |

**Import rules:**
- Stages import only from `src/pipeline/types.ts`, `src/store/`, and their own folder
- No cross-stage imports — stages communicate via typed payloads only
- No PixiJS imports outside `src/pipeline/plate/pixi/`
- No direct ARIA DOM manipulation outside `src/pipeline/plate/aria/`
- No WASM imports outside `src/pipeline/chop/`

**Enforcement:** Use `eslint-plugin-boundaries` or `no-restricted-imports` to make boundary violations a build error, not a discipline question. Add this once the structure is stable — not before.

---

## Directory Structure

```
src/
  pipeline/
    index.ts            # orchestration — routes IntakeResult, wires stages
    types.ts            # shared contracts: CutsReady, RenderSpec, IntakePayload, A11y* etc.
    intake/
      index.ts
      types.ts
    chop/
      host/
        index.ts        # spawns worker, handles message protocol
      worker/
        index.ts        # worker entry — loads WASM
      types.ts
    cook/
      index.ts
      deriveA11ySpec.ts # sole accessibility derivation entry point
      types.ts
    plate/
      index.ts          # orchestrates both renderers
      pixi/
        index.ts        # PixiJS executor
      aria/
        index.ts        # static ARIA mirror from RenderSpec
        runtime/        # focus, keyboard, announcements — sole runtime a11y behavior
      types.ts
  store/                # Zustand — mutable game state, user prefs, runtime a11y state
crates/
  chop/                 # Rust/WASM — cut geometry + palette algorithm
```

---

## Puzzle Model

A puzzle is a flat collection of **pieces**. Each piece carries two categories of data:

- **Immutable definition** — shape, correct position, index. Sourced from `JiggDissection` (via the `jigg-spec` submodule). Never changes after game creation.
- **Mutable runtime state** — current position, stage, rotation, cluster membership, placed status. Lives in the Store (`JiggAssembly`).

**Stages** are organizational containers, not coordinate systems. A piece lives in one of two spec-defined stages — bench or table — plus any user-defined tray. Movement from bench is one-way: a piece that leaves the bench never returns.

**Groups (clusters)** are not stored objects. They are derived at runtime by collecting pieces that share a `clusterId`. A lone piece is implicitly a group of one. When a group reaches its correct position, all its pieces are marked `placed` and the group dissolves — placed pieces have no cluster.

**`placed: boolean` is the sole authority on correctness.** Stage identity is not a proxy for correctness. A piece can be on the table and unplaced. A piece cannot be placed and clustered.

---

## Rendering Model

PixiJS owns the canvas. All puzzle pieces, visual feedback, snap highlights, and background rendering happen inside the PixiJS scene graph.

The DOM contributes two layers alongside the canvas — neither is inside the PixiJS-managed region:

1. **Accessibility layer** — visually hidden landmarks, a hidden button tree for screen readers, and a live announcement region. Fully wired to puzzle state. Managed by `plate/aria/`.
2. **App shell** — visible top-level controls (image picker, game setup UI). Siblings of the canvas in the document, not affected by the `inert` management on bench/table landmarks.

The PixiJS scene and both DOM layers are kept in sync as piece state changes in the Store. The Store is the single source of truth — both renderers read from it.

---

## Interaction Model

**Pointer input** uses a single transparent hit layer rather than per-piece event listeners. A spatial hash indexes pieces by grid cell, making hit testing O(1) regardless of piece count.

**Snap detection** runs on drag end. The pipeline queries nearby pieces, tests edge alignment and rotation compatibility, selects the best candidate by confidence, and executes a position correction. Groups snap as units.

**Keyboard input** runs in parallel to pointer input — it is not a fallback. The app maintains a keyboard mode (bench or table) and uses the `inert` attribute to restrict tab focus to the active region. Keyboard piece movement, rotation, and placement are first-class interactions.

Interaction writes to the Store. The Store notifies Plate. Plate updates both the PixiJS scene and the ARIA layer.

---

## What This Document Is Not

- It is not a story list
- It is not an API reference
- It is not a UI spec

It is the **load-bearing structure**. Stories are written to fit within it, not the other way around.
