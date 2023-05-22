> :warning: __This project is not officially maintained.__ You are still welcome to contribute, e.g. by fixing issues or creating enhancements.


# bpmn-auto-layout

[![CI](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml/badge.svg)](https://github.com/bpmn-io/bpmn-auto-layout/actions/workflows/CI.yml)

Get a layouted diagram of a BPMN process without graphical representation.


## Usage

This library works in [Node.js](https://nodejs.org/) and in the browser.

To layout diagrams these must have __exactly one single start event__.

```javascript
import AutoLayout from 'bpmn-auto-layout';

const diagramXML = '<bpmn:defintions ...></bpmn:defintions>';

const autoLayout = new AutoLayout();

const layoutedDiagramXML = await autoLayout.layoutProcess(diagramXML);

console.log(layoutedDiagramXML);
```


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
