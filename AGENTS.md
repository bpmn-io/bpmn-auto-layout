# bpmn-auto-layout Agent Guide

`bpmn-auto-layout` generates BPMN DI from semantic BPMN XML. Production layout
code lives in `lib/`; `dist/` is generated and must not be edited.

## Working loop

Run a focused fixture while changing layout behavior:

```sh
npm test -- --grep "<fixture-name>"
```

The test command builds `dist/` first and writes generated BPMN into the
ignored `test/output/` directory.

Inspect a complete test run visually:

```sh
npm run test:inspect
```

This opens the local side-by-side visual inspector for fixture input, current
output, and the committed snapshot. It records five measured layouts after one
warm-up per fixture and displays average, p50, and p90 timing.

Render one valid fixture to standalone image artifacts:

```sh
npm run render:fixture -- <fixture-name>
```

The command builds the local implementation and writes generated BPMN, PNG,
and SVG files to ignored `test/output/rendered/`. It intentionally rejects
fixtures in `test/fixtures/failures/`, which do not have valid layout output.

Capture a raw Chrome performance trace for a fixture when investigating layout
speed or reviewing performance-sensitive changes:

```sh
npm run trace:fixture -- <fixture-name>
```

The command builds a dedicated local trace page and writes a DevTools- and
Perfetto-compatible JSON trace to ignored `test/performance/traces/`. It fails
if Chrome reports trace data loss.

Measure a fixture's steady-state layout time without browser rendering:

```sh
npm run benchmark:fixture -- <fixture-name-or-path> <iterations>
```

The command accepts a fixture name or a path below `test/fixtures/`, builds the
local implementation, excludes 20 warm-up layouts, and reports average, p50,
and p90 layout times.

Run `npm run metrics` when reviewing visual-quality impact beyond byte-level
snapshot changes.

## Layout documentation

[`docs/LAYOUT.md`](docs/LAYOUT.md) is the human-readable description of the
shipped algorithm and geometry contract. Update it in the same change whenever
layout work changes:

- a pipeline stage or its ordering;
- semantic policy, ranking, bands, placement, packing, or routing;
- containment, lane, participant, artifact, or DI behavior;
- geometry constants, supported surfaces, or failure conditions.

Behavior-preserving refactors do not require prose changes, but must leave the
document accurate. Keep implementation names, Mermaid diagrams, and stated
rules synchronized with `lib/` and the executable fixture contracts.

## Fixtures and snapshots

- `test/fixtures/` contains input BPMN; add a concise `bpmn:documentation`
  statement describing each normal fixture's intended behavior.
- `test/fixtures/failures/` contains invalid inputs that must raise `LayoutError`
  and must not produce snapshots or rendered output.
- `test/snapshots/` contains approved generated BPMN. Never change snapshots
  before visually reviewing the output with `npm run test:inspect`.
- `npm run test:update-snapshots` replaces all snapshots. Use it only for an
  intentional, reviewed layout change.

See `test/README.md` for the full snapshot and metrics workflow.