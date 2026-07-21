# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Create and layout the graphical representation of a BPMN diagram.

Try it out in [the example project](https://bpmn-io.github.io/bpmn-auto-layout/).

## Usage

This library works with [Node.js](https://nodejs.org/) and in the browser.

```javascript
import { layoutProcess } from 'bpmn-auto-layout';

import diagramXML from './diagram.bpmn';

const {
  xml: diagramWithLayoutXML,
  warnings
} = await layoutProcess(diagramXML);

console.log(diagramWithLayoutXML);
console.warn(warnings);
```

`layoutProcess` resolves with `{ xml, warnings }`. Warnings are exported
`LayoutWarning` instances with stable `code`, `elementId`, `message`, and
`relatedElementIds` fields. Fatal structural or geometry failures reject with
an exported `LayoutError`.

## Limitations

Layout is greenfield: existing DI coordinates, waypoints, dimensions, and labels
are replaced. Existing DI only determines whether an embedded sub-process is
expanded.

The layouter supports process flow, boundary events, collapsed and expanded
sub-processes, event sub-processes, horizontal lanes, and collaboration pools.
It lays out each participant with a process reference; black-box participants
remain empty pools.

Groups are generated when their members explicitly reference the group's
category value. Groups without visible explicit members are omitted with a
warning. Artifacts are placed after process flow and do not affect its ranks or
bands. Message flows whose endpoints receive geometry are routed through pool
gutters or outside channels.

Unsupported visual elements fail with an exported `LayoutError` rather than
receiving invented geometry. See the [layout engine guide](./docs/LAYOUT.md) for
the algorithm and geometry contract.

## Resources

* [Layout engine](./docs/LAYOUT.md) — design, algorithm, and geometry rules
* [Layout walkthrough](./docs/WALKTHROUGH.md) — end-to-end boundary error-event example
* [Issues](https://github.com/bpmn-io/bpmn-auto-layout/issues)

## Build and Run

```sh
# install dependencies
npm install

# build and run tests
npm run all

# run example
npm start
```

## Test

We use snapshot testing to verify old and new layout attempts. A mismatch is indicated as a test failure.

```sh
# run tests
npm test

# inspect the results
npm run test:inspect

# run update snapshots
npm run test:update-snapshots
```

Add new test cases to [`test/fixtures`](./test/fixtures) and they will be picked up automatically.

See [`test/README.md`](./test/README.md) for how the snapshot tests work in detail.

## License

MIT
