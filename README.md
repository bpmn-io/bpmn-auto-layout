# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Get a layouted diagram of a BPMN process without graphical representation.


## Usage

This library works in [Node.js](https://nodejs.org/) and in the browser.

To layout diagrams these must have __exactly one single start event__.

```javascript
import { layoutProcess } from 'bpmn-auto-layout';

const diagramXML = '<bpmn:defintions ...></bpmn:defintions>';

const layoutedDiagramXML = await layoutProcess(diagramXML);

console.log(layoutedDiagramXML);
```
## Unsupported Concepts and elements

The Tool can currently not properly layout diagrams containing any of the following:
- Pools
- Data/Message Flows and Objects, Data Stores
- event sub-processes


## Resources

*   [Issues](https://github.com/bpmn-io/bpmn-auto-layout/issues)


## Building

```sh
npm install
npm run all
```

As part of the test run, visual test cases are generated to `test/generated/test.html`.


## License

MIT
