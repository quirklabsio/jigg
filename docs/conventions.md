<!-- audience: Dev, Agent -->

# Conventions — Code Style & Tools

*Development standards, debugging tools, and consistent patterns for Jigg.*

## Code Style

### TypeScript Conventions
- Strict mode enabled (`strict: true` in tsconfig)
- Prefer interfaces over types for extensible objects
- Use explicit return types for public APIs
- Prefer `const assertions` over type annotations where possible

```typescript
// GOOD
interface PieceState {
  stageId: StageId
  pos?: Point
}

function movePiece(piece: Piece, delta: Point): boolean {
  // Implementation
}

// AVOID
type PieceState = {
  stageId: StageId
  pos?: Point
}
```

### Import Organization
```typescript
// 1. Spec types (via alias)
import { PieceDefinition, PieceState } from '@jigg-spec/types'

// 2. External dependencies
import { Container, Sprite } from 'pixi.js'

// 3. Internal modules (relative paths)
import { SpatialHash } from './spatial'
import { snapDetection } from './snap'
```

### Naming Conventions
- `camelCase` for variables, functions, properties
- `PascalCase` for types, interfaces, classes
- `SCREAMING_SNAKE_CASE` for constants
- `kebab-case` for file names

```typescript
const SNAP_THRESHOLD = 10
interface SnapResult { /* ... */ }
class SpatialHash { /* ... */ }

function detectSnaps(): SnapResult[] { /* ... */ }
```

## Debug Tools

### Keyboard Shortcuts
- **`F` key:** FPS counter toggle
- **`Shift+B`:** Background preset cycle (Story 37a)
- **`?` key:** Keyboard shortcuts panel (Story 42c)

*Removed in Story 29:* `E` key (edge overlay debug feature)

### Console Tools
Development build includes piece validation:
```typescript
function validatePiece(piece: Piece) {
  console.assert(piece.stageId === 'bench' ? !piece.pos : !!piece.pos)
  console.assert(!piece.placed || !piece.clusterId)
  console.assert([0, 90, 180, 270].includes(piece.rot))
}
```

### Performance Commands
```bash
npm run perf-audit    # Performance analysis
npm run dev:debug     # Development with debugging enabled
```

## File Organization

### Source Structure
```
src/
├── puzzle/          # Core game logic
├── canvas/          # PixiJS rendering  
├── interaction/     # User input handling
├── workers/         # Background processing
├── wasm-pkg/        # Generated WASM bindings
└── types/           # Runtime type extensions
```

### Test Structure
```
tests/
├── unit/            # Individual function tests
├── integration/     # Cross-module tests  
├── accessibility/   # A11y compliance tests
└── fixtures/        # Test data and mocks
```

## Error Handling Patterns

### Development Assertions
Use `console.assert` for development-time invariant checking:
```typescript
console.assert(piece.stageId === 'bench' ? piece.pos === undefined : piece.pos !== undefined)
console.assert(piece.placed ? piece.clusterId === undefined : true)
```

### Production Safeguards
Use try-catch for runtime errors that users might encounter:
```typescript
function loadPuzzle(data: unknown): Puzzle | null {
  try {
    return parsePuzzleData(data)
  } catch (error) {
    console.error('Invalid puzzle data:', error)
    return null
  }
}
```

### Type Guards
Prefer explicit type checking over casting:
```typescript
// GOOD
function isPiece(obj: unknown): obj is Piece {
  return typeof obj === 'object' && 
         obj !== null &&
         'index' in obj &&
         'stageId' in obj
}

// AVOID
const piece = obj as Piece
```

## Performance Guidelines

### PixiJS Optimizations
- Use object pooling for frequently created/destroyed sprites
- Batch texture uploads via texture atlases
- Prefer `Graphics` over `Sprite` for simple shapes
- Use `culling` to skip off-screen rendering

### Memory Management
```typescript
// Clean up PixiJS resources
function cleanup() {
  puzzle.pieces.forEach(piece => {
    piece.sprite.destroy({ texture: false, baseTexture: false })
  })
  
  puzzleTexture.destroy(true)  // Destroy base texture too
}
```

### Spatial Hash Guidelines
- Cell size should balance memory vs query performance
- Update incrementally rather than rebuilding entire hash
- Remove pieces before position updates, re-insert after

## Accessibility Guidelines

### ARIA Integration
All interactive elements need keyboard access and screen reader support:
```typescript
button.setAttribute('role', 'button')
button.setAttribute('aria-label', generatePieceLabel(piece))
button.setAttribute('tabindex', '0')
```

### Focus Management  
Use `inert` attribute for mode switching:
```typescript
benchElement.inert = (mode !== 'bench')
tableElement.inert = (mode !== 'table')
```

### Screen Reader Announcements
```typescript
function announceAction(message: string) {
  liveRegion.textContent = message
  // Screen readers automatically announce live region changes
}
```

## Testing Conventions

### Unit Test Structure
```typescript
describe('snapDetection', () => {
  beforeEach(() => {
    // Setup test state
  })
  
  it('should detect valid snaps within threshold', () => {
    // Arrange
    const pieceA = createTestPiece({ /* ... */ })
    const pieceB = createTestPiece({ /* ... */ })
    
    // Act  
    const result = detectSnap(pieceA, pieceB)
    
    // Assert
    expect(result).not.toBeNull()
    expect(result.confidence).toBeGreaterThan(0.8)
  })
})
```

### Integration Test Patterns
```typescript
describe('keyboard navigation', () => {
  it('should move between bench and table with Tab', async () => {
    render(<PuzzleCanvas pieces={mockPieces} />)
    
    await user.keyboard('{Tab}')
    expect(getBenchElement()).toHaveFocus()
    
    await user.keyboard('{Tab}')
    expect(getTableElement()).toHaveFocus()
  })
})
```

## Documentation Standards

### Code Comments
```typescript
/**
 * Detects potential snap connections between pieces.
 * 
 * @param piece - Target piece for snap detection
 * @param threshold - Maximum distance for valid snap (pixels)
 * @returns Array of potential snap results, sorted by confidence
 */
function detectSnaps(piece: Piece, threshold: number): SnapResult[] {
  // Implementation details...
}
```

### README Updates
Key documentation files to maintain:
- `README.md` — Project setup and overview
- `roadmap.md` — Planning and story status
- `CLAUDE.md` — Agent development workflow

### Architectural Decision Records
Document significant choices in `decisions.md`. Follow the format already established there — bullet entries grouped under the relevant section (Stack, Puzzle Model, Drag & Input, etc.), not formal ADR blocks.

## Build and Development

### Development Server
```bash
npm run dev        # Start with hot reload
npm run dev:debug  # Start with additional debugging
```

### Production Build
```bash
npm run build      # Production build
npm run preview    # Preview production build locally  
```

### WASM Development
```bash
npm run wasm:build # Rebuild WASM module
npm run wasm:dev   # Development with WASM rebuilding
```

### Quality Checks
```bash
npm run lint       # ESLint + TypeScript checking
npm run test       # Run test suite
npm run a11y-test  # Accessibility compliance tests
```

---

*Add new conventions as patterns emerge.*
