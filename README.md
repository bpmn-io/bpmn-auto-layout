> :warning: __This project is not officially maintained.__ You are still welcome to contribute, e.g. by fixing issues or creating enhancements.


# bpmn-auto-layout

Get a layouted diagram of a bpmn-process without graphical representation.


## Usage

__Preconditions:__ The diagram has to have __exactly one single startevent__.

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


## License

Use under the terms of the [MIT license](http://opensource.org/licenses/MIT).
