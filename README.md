# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Generate BPMN Diagram Interchange (DI) for BPMN XML with our without existing DI. Supports processes and collaborations.

Try it out in [the example project](https://bpmn-io.github.io/bpmn-auto-layout/).

## Install

```sh
npm install bpmn-auto-layout
```

The library works with [Node.js](https://nodejs.org/) and in the browser.

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

## Command line

The package also provides a command-line interface:

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
* [Layout walkthrough](./docs/WALKTHROUGH.md) — end-to-end boundary error-event example
* [Issues](https://github.com/bpmn-io/bpmn-auto-layout/issues)

## Development

```sh
npm install
npm run all
```

See [`test/README.md`](./test/README.md) for test, snapshot, inspection, and
performance workflows.

## License

MIT
