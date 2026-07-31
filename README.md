# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Generate complete BPMN Diagram Interchange (DI) from BPMN XML, with or without
existing DI. Supports processes and collaborations.

Try it out in [the example project](https://bpmn-io.github.io/bpmn-auto-layout/).

## Install

```sh
npm install bpmn-auto-layout
```

Requires [Node.js](https://nodejs.org/) 22.12 or newer. Browser builds are also
supported.

## Library usage

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
`LayoutWarning` instances. Invalid or unsupported input rejects with an exported
`LayoutError`.

### Runtime and cancellation

XML parsing and serialization are asynchronous; layout computation is synchronous
and CPU-bound. Run large or untrusted diagrams in a Web Worker or Node.js
`worker_threads` worker to keep it off the application event loop or browser main
thread.

An in-flight layout cannot be interrupted with an `AbortSignal`. To enforce a
deadline, run one layout per worker and terminate that worker when the deadline
expires.

## Command line

The package includes a command-line interface:

```sh
# replace the file in place
npx bpmn-auto-layout diagram.bpmn

# write the result elsewhere
npx bpmn-auto-layout diagram.bpmn --output diagram.layouted.bpmn

# transform standard input to standard output
cat diagram.bpmn | npx bpmn-auto-layout - > diagram.layouted.bpmn
```

`--stdout` writes a file input's layout XML to standard output without changing
the input. Layout warnings are emitted as JSON lines to standard error. Use
`bpmn-auto-layout --help` for the full command reference.

## Resources

* [Layout engine](./docs/LAYOUT.md) — design, algorithm, and geometry rules
* [Issues](https://github.com/bpmn-io/bpmn-auto-layout/issues)

## Development

```sh
npm install
npm run all
npm run test:performance
```

See [`test/README.md`](./test/README.md) for fixture, snapshot, visual-review,
and performance workflows.

## License

MIT
