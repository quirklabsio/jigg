# Regression Script — Core Loop (Story 48)

Manual test covering the end-to-end puzzle loop on the designated regression fixture.
Run time: ~2–3 minutes.

**Image**: "Regression test (3×3)" — 9 pieces in a 3×3 grid (4 corners, 4 edges, 1 interior).
**Load it**: Click **Choose Image** → click **Regression test (3×3)**.

---

## Steps

### 1. Load and verify piece count
- Click **Choose Image** button (top-right).
- Click **Regression test (3×3)** thumbnail.
- **Verify**: Page reloads; bench opens; bench shows exactly **9 pieces**.
- **Verify**: Filter strip shows **Corners (4)**, **Edges (4)**, **Interior (1)**.

### 2. Extract a piece via click
- Click any piece in the bench.
- **Verify**: Piece appears on the table (world canvas). Bench now shows 8 pieces.

### 3. Extract a piece via keyboard
- Press **T** to open the bench (if closed).
- Tab into the bench landmark; use arrow keys to navigate to a piece.
- Press **Enter** to extract the focused piece.
- **Verify**: Piece moves to the table. Bench now shows 7 pieces.

### 4. Rotate a piece on the table
- Press **T** to switch to table mode (bench closes).
- Press **Tab** to focus a piece on the table.
- Press **R** (or double-tap) to rotate.
- **Verify**: Piece rotates 90°. Label stays upright.

### 5. Snap a piece to the board
- Drag a piece to its correct board position (matching color region).
- **Verify**: Snap animation fires; piece locks in place; board region fills.

### 6. Merge two pieces into a cluster
- Extract two adjacent pieces from the bench (click or keyboard).
- Drag one near the other on the table.
- **Verify**: Pieces snap together into a cluster; both move as a unit when dragged.

### 7. Solve to completion
- Extract and place all remaining pieces (one by one or in clusters).
- Snap each cluster/piece to its correct board position.
- **Verify**: After the final snap, the completion animation/message fires.
- **Verify**: All 9 cells of the board are filled with their correct color block.

---

## Adding steps
Future stories append steps here as they ship features (e.g., undo, reference image, timer).
