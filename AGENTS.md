# Agent guide

`bpmn-auto-layout` generates BPMN DI from semantic BPMN XML. Production code
lives in `lib/`; `dist/` is generated and must not be edited.

## Layout work

Run a focused fixture while changing layout behavior:

```sh
npm test -- --grep "<fixture-name>"
```

The command builds `dist/` first and writes generated BPMN to ignored
`test/output/`.

Inspect a complete test run:

```sh
npm run test:inspect
```

The inspector compares fixture input, current output, and the committed snapshot.
It records five measured layouts after one warm-up and shows average, p50, and
p90 timing for each fixture.

Render one fixture with authored DI as standalone artifacts:

```sh
npm run render:fixture -- <fixture-name>
```

The command builds the local implementation and writes input and generated BPMN,
PNG, and SVG files to ignored `test/output/rendered/`. It rejects failure
fixtures because they do not produce valid layout output.

Capture a raw Chrome performance trace when investigating layout speed or
reviewing performance-sensitive changes:

```sh
npm run trace:fixture -- <fixture-name>
```

The command writes a DevTools- and Perfetto-compatible JSON trace to ignored
`test/performance/traces/`. It fails when Chrome reports trace data loss.

Measure steady-state layout time without browser rendering:

```sh
npm run benchmark:fixture -- <fixture-name-or-path> <iterations>
```

The command accepts a fixture name or a path below `test/fixtures/`, excludes
20 warm-ups, and reports average, p50, and p90 layout times.

Run `npm run metrics` to assess visual-quality changes beyond exact snapshots.

## TypeScript policy

- Keep TypeScript strict. `tsc` rejects implicit `any`; Biome rejects explicit
  `any` and `@ts-ignore`. Model uncertainty with explicit types, `unknown`, and
  type guards instead. `@ts-expect-error` follows TypeScript's standard policy:
  it is valid only while it suppresses a real error.
- `lib/moddle-types/` is generated from `bpmn-moddle` descriptors. Do not edit
  it manually. Run `npm run generate:moddle-types` after descriptor updates and
  commit the generated files; `npm run check:moddle-types` verifies freshness.
  CI runs that freshness check only on Node 24.

## Layout contract

[`docs/LAYOUT.md`](docs/LAYOUT.md) defines the shipped algorithm and geometry
contract. Update it when layout work changes:

- a pipeline stage or its ordering;
- semantic policy, ranking, bands, placement, packing, or routing;
- containment, lane, participant, artifact, or DI behavior;
- geometry constants, supported surfaces, or failure conditions.

Behavior-preserving refactors need no prose change, but the document must remain
accurate. Keep implementation names, diagrams, and rules synchronized with
`lib/` and executable fixture contracts.

## Fixtures and snapshots

- `test/fixtures/` contains input BPMN. Add concise `bpmn:documentation` to
  every normal fixture describing its intended behavior.
- `test/fixtures/failures/` contains invalid inputs that must raise `LayoutError`
  and must not produce snapshots or rendered output.
- `test/snapshots/` contains approved generated BPMN. Review output with
  `npm run test:inspect` before changing a snapshot.
- `npm run test:update-snapshots` replaces all snapshots. Use it only for an
  intentional, reviewed layout change.

See `test/README.md` for the full snapshot and metrics workflow.