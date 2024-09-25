# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Create and layout the graphical representation of a BPMN diagram.

## Usage

This library works with [Node.js](https://nodejs.org/) and in the browser.

```javascript
import { layoutProcess } from 'bpmn-auto-layout';

import diagramXML from './diagram.bpmn';

const diagramWithLayoutXML = await layoutProcess(diagramXML);

console.log(diagramWithLayoutXML);
```

## Limitations

* Given a collaboration only the first participant's process will be laid out
* Sub-processes will be laid out as collapsed sub-processes
* The following elements are not laid out:
  * Groups
  * Text annotations
  * Associations
  * Message flows

## Resources

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

Add new test cases to [`test/fixtures`](./test/fixures) and they will be picked up automatically.

## License

MIT
