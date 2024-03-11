# Changelog

All notable changes to [bpmn-auto-layout](https://github.com/bpmn-io/bpmn-auto-layout) are documented here. We use [semantic versioning](http://semver.org/) for releases.

## Unreleased

_**Note:** Yet to be released changes appear here._

* `DEPS`: update to `bpmn-moddle@9.0.1`
* `CHORE`: require Node >= 18

### Breaking Changes

* Require Node >= 18

## 0.4.0

* `FEAT`: improve connection exiting from boundary events ([`7048c86`](https://github.com/bpmn-io/bpmn-auto-layout/commit/7048c8682985409613f854202f727853a13bfe44))
* `FEAT`: distribute attachers across host width ([`80f3c84`](https://github.com/bpmn-io/bpmn-auto-layout/commit/80f3c84f40b1b2ccf0d757cf70482130112b6c7b))
* `FIX`: show exclusive gateway marker ([`7c18b0f`](https://github.com/bpmn-io/bpmn-auto-layout/commit/7c18b0f509ce2de9b5c9bda1f1035309d8ffd5cc))
* `FIX`: correct CommonJS bundle extension ([#39](https://github.com/bpmn-io/bpmn-auto-layout/issues/39))

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
