# Fixture System

Three-tier architecture for test images and other binary fixtures.

## Tiers

```
/test/fixtures/images/<area>/   — committed, promoted fixtures (must have fixtures.json entry)
/qa-scratch/                    — gitignored, local-only scratch
External storage                — reference via URL in fixtures.json for assets > 500 KB
```

Current areas: `ingest/` (file drop, normalization), `slice/` (cut generation, piece dissection). Add a new area only when a story needs one — don't pre-populate.

## Single source of truth: `fixtures.json`

Each area directory holds a `fixtures.json` describing every committed file. The JSON is the spec; the filename is a stable ID.

```json
[
  {
    "file": "weird-aspect_4000x500_24pieces.png",
    "case": "weird-aspect-ratio",
    "automated": true,
    "input": { "dimensions": [4000, 500], "targetPieces": 24 },
    "expected": {
      "pieceCount": 24,
      "bounds": { "width": 4000, "height": 500 },
      "edgeDistribution": { "straight": 12, "tabs": 6, "blanks": 6 }
    }
  },
  {
    "file": "corrupted_header_fails.png",
    "case": "malformed-png",
    "automated": false,
    "expected": { "errorType": "InvalidImageFormat" }
  }
]
```

Fields:
- `file` — exact filename in the area directory (or `url` instead if externally hosted)
- `case` — short stable identifier for logs and test names
- `automated` — whether a test runner asserts against it (true) or it's manual-QA only (false)
- `input` — what to feed the system under test
- `expected` — what the system should produce. For manual fixtures, this is a human-readable claim; for automated ones, it's a `toMatchObject` shape

## Promotion workflow

Dev working on a story drops candidate images into `/qa-scratch/` freely — no ceremony, gitignored, private. When QA passes and a fixture proves regression-worthy behavior, promote it:

1. Rename to convention: `<area>_<case>_<params>_<expected>.<ext>`
2. Move from `/qa-scratch/` to `/test/fixtures/images/<area>/`
3. Add an entry to that area's `fixtures.json`
4. If `automated: true`, reference from the test runner

## Rules

- **Silent rule.** Any file in `/test/fixtures/` without a `fixtures.json` entry gets deleted on sight. No orphans.
- **Promotion gate.** Before promoting, answer: "what breaks if this fixture disappears?" No concrete answer → don't promote.
- **Size cap.** Committed fixtures stay under 500 KB each. Larger reference assets go to external storage with a `url` field instead of `file`.
- **No duplication.** JSON is the spec. Filename is a stable ID, not a place to encode metadata the JSON already carries.
- **Privacy.** Public-domain or synthetic only. No personal photos.

## When no fixture is needed

If a story's testing is adequately proven by "any image from the user's own library", don't invent a fixture. `/qa` output should say so explicitly — inventing ceremony is worse than naming the absence.
