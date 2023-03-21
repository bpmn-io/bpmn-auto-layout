> :warning: __This project is not officially maintained.__ You are still welcome to contribute, e.g. by fixing issues or creating enhancements.


# bpmn-auto-layout

Get a layouted diagram of a bpmn-process without graphical representation.


## Usage

__Preconditions:__ This library needs [Node.js](https://nodejs.org/en/) to run.

The diagram has to have __exactly one single startevent__.

```javascript
var AutoLayout = require('bpmn-auto-layout');

var diagramXML = '<bpmn:defintions ...></bpmn:defintions>';

var autoLayout = new AutoLayout();

(async () => {
  var layoutedDiagramXML = await autoLayout.layoutProcess(diagramXML);

  console.log(layoutedDiagramXML);
})();

```


## Resources

*   [Issues](https://github.com/bpmn-io/bpmn-auto-layout/issues)


## Building

```
npm install
npm run all
```

As part of the test run, visual test cases are generated to `test/generated/test.html`.


## License

MIT
