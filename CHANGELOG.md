# Changelog

All notable changes to [bpmn-auto-layout](https://github.com/bpmn-io/bpmn-auto-layout) are documented here. We use [semantic versioning](http://semver.org/) for releases.

## Unreleased

_**Note:** Yet to be released changes appear here._

## 0.3.0

* `FEAT`: rewrite of the library with ([#36](https://github.com/bpmn-io/bpmn-auto-layout/pull/36), [#32](https://github.com/bpmn-io/bpmn-auto-layout/issues/32))
* `DEPS`: bump to `min-dash@4.1.1`

### Breaking changes

This version is a complete re-write of the library, including a new API. Use `layoutProcess` to layout a BPMN process:

```javascript
import { layoutProcess } from 'bpmn-auto-layout';

const diagramXML = '<bpmn:defintions ...></bpmn:defintions>';

const layoutedDiagramXML = await layoutProcess(diagramXML);

console.log(layoutedDiagramXML);
```

## 0.2.0

* `FIX`: correctly import in modern JS environments ([#30](https://github.com/bpmn-io/bpmn-auto-layout/pull/30), [#22](https://github.com/bpmn-io/bpmn-auto-layout/issues/22), [#18](https://github.com/bpmn-io/bpmn-auto-layout/issues/18))
* `FIX`: some DI generation fixes
* `CHORE`: Migrate to ES module ([#33](https://github.com/bpmn-io/bpmn-auto-layout/pull/33))
* `DEPS`: use recent `bpmn-moddle` version

### Breaking Changes

* This library is now an ES module and can be consumed in browser and Node.js
