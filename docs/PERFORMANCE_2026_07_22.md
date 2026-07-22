# Layout Performance Investigation 2026-07-22

This document records a performance investigation of the layouter conducted on
July 22, 2026. It identifies current runtime bottlenecks and possible
optimization directions. It is not a performance contract or benchmark
baseline.

## Method

The investigation used:

- five measured runs per fixture after one warm-up run;
- all 153 valid fixtures in `test/fixtures/`;
- V8 sampling CPU profiles of representative slow fixtures;
- three independent Chrome DevTools traces of
  `process.application-processing.bpmn`;
- three independent Node.js V8 CPU profiles of the same fixture;
- timings around major layout stages;
- isolated synthetic scaling tests for participant ordering, visibility
  routing, and label placement; and
- separate measurements of BPMN XML parsing and serialization.

Measurements were taken on the local development machine with Node.js
24.18.0. Absolute timings will vary by machine and Node.js version. Relative
costs, profiles, and scaling behavior are the primary evidence.

Chrome traces include the example viewer's BPMN import and rendering, while
Node.js profiles isolate `layoutProcess`. Browser findings must therefore not
be attributed to the layouter without the matching Node.js evidence.

## Baseline Fixture Corpus

These measurements were captured before the first participant-ordering
optimization.

| Metric | Time |
| --- | ---: |
| Median | 4.50 ms |
| P90 | 41.07 ms |
| P95 | 54.95 ms |
| P99 | 184.23 ms |
| Fixtures above 100 ms | 6 of 153 |

The slowest fixtures were:

| Fixture | Median |
| --- | ---: |
| `process.application-processing.bpmn` | 1,746.93 ms |
| `blueprint.telco-service-order-fulfillment-retail.bpmn` | 211.15 ms |
| `camunda-8-tutorials.telco-service-order-fulfillment-retail.bpmn` | 184.23 ms |
| `sub-process.expanded-06-hour.bpmn` | 132.85 ms |
| `camunda-8-tutorials.car-rental-booking-process.bpmn` | 125.89 ms |
| `scenario.multiple-ad-hoc.bpmn` | 113.11 ms |

`process.application-processing.bpmn` alone accounted for 43.7% of the sum of
fixture median runtimes. It contains 17 participants, 29 message flows, 104
sequence flows, and 20 artifacts.

## Current Application-Processing Trace Evidence

Three Chrome traces of `process.application-processing.bpmn` each contained a
single 855--877 ms main-thread task. `Canvas.getSize` accounted for 147--152 ms
(17.4--17.7%) of sampled browser time. This is viewer rendering work, not
layouter work.

Three matching Node.js profiles, each running 20 layouts, showed these
consistent module self-time ranges. Sampling self time excludes callees and is
intended to rank work rather than establish a complete time budget.

| Module | Self time |
| --- | ---: |
| `ArtifactLayouter.js` | 20.5--21.7% |
| `CollaborationLayouter.js` | 17.6--18.4% |
| `SequenceFlowRouter.js` | 17.6--18.0% |
| `LabelLayouter.js` | 10.7--11.1% |

The most stable layouter leaf hotspots were:

| Function | Self time |
| --- | ---: |
| `visibilityRoute` | 11.6--11.7% |
| `findArtifactPlacement` | 6.3--6.7% |
| `routeMessageLeg` | 4.9--5.4% |
| `countRouteCrossings` | 3.4--4.3% |
| `orderedMessageFlowNeedsBend` | 3.3--3.7% |

## Optimization Work Status

### No Current Target

All profiled optimization candidates have either shipped or been rejected on
whole-fixture evidence. New work requires a fresh component-level diagnosis;
do not reopen a previously rejected technique by default.

### Previously Attempted -- Do Not Retry by Default

- Participant-order endpoint lookup, obstacle preparation, order-score caching,
  broad-phase obstacle rejection, and bend-count score pruning are shipped. Do
  not revisit those techniques.
- Visibility routing has already received deterministic heap traversal,
  coordinate indexes, and immutable collision-context preparation. No further
  `visibilityRoute` change is queued without a new component-level diagnosis.
- `routeMessageLeg` checker-context reuse and allocation-free direct collision
  loops were profiled and benchmarked on application processing. Neither
  improved whole-fixture timings, so do not retry them.
- External-label sort-data caching and edge-segment preparation are shipped. Do
  not revisit those techniques.
- Artifact size-candidate and flattened graph-route-segment caches were
  rejected after whole-fixture measurements showed no reliable improvement.
  Do not retry them.
- Artifact candidate-ranking heap traversal was rejected. It slightly improved
  application-processing p50 but regressed
  `blueprint.servicenow-integration-blueprint.bpmn` from 63.54 ms to 113.26 ms.
  Do not retry it.
- Artifact obstacle, occupied-artifact, and participant-header bounds are
  precomputed per placement search and shipped. Do not retry the rejected
  artifact caches or candidate heap.

Viewer rendering, including `Canvas.getSize`, is outside the layouter's
optimization scope.

## Bottlenecks

### 1. Collaboration Participant Ordering

Participant ordering is one of several material costs for large collaborations. On
`process.application-processing.bpmn`, `layoutCollaboration` took approximately
980 ms of a 1,285 ms average layout.

The CPU profile attributed 32.8% of self time directly to
`CollaborationLayouter.js` and 19.5% to geometry helpers in `LayoutUtil.js`
called by collaboration processing. The hottest operations were:

- `orderedMessageFlowNeedsBend`;
- repeated scans of every endpoint shape;
- repeated `segmentEntersRect` calls; and
- repeated `findEndpointParticipant` calls, including a linear participant
  lookup.

`orderParticipantsByMessageFlow` uses exhaustive permutation search for up to
eight participants. An isolated test showed the resulting threshold cliff:

| Participants | Ordering time |
| ---: | ---: |
| 6 | 7.81 ms |
| 7 | 43.56 ms |
| 8 | 264.21 ms |
| 9 | 1.16 ms |
| 12 | 2.86 ms |

Nine participants are faster than eight because the implementation switches
from exhaustive search to a heuristic. Above the threshold, the heuristic
still repeatedly scores candidate orders. Each score resolves the same
message-flow endpoints and scans endpoint shapes again.

The first optimization pass now:

- precomputes endpoint-to-participant mappings, resolved message-flow endpoints,
  endpoint bounds, and obstacle ownership;
- caches heuristic scores when the same participant order is revisited; and
- rejects horizontally or vertically disjoint obstacles before the exact
  segment intersection test.

On the critical fixture, the ten-run median decreased from 1,393.09 ms to
638.89 ms, a 54.1% reduction, without changing its snapshot output. The full
test suite remained unchanged. Across the complete fixture benchmark, the sum
of fixture medians decreased from 4,000.5 ms to 2,915.9 ms, a 27.1% reduction.

The second optimization pass precomputes each obstacle's invariant inset x
coordinate, width, and height. Order scoring now only translates the obstacle's
y coordinate instead of rebuilding and insetting its complete rectangle for
every candidate order, and scans the prepared records directly. Against the
previously optimized implementation, the eight-participant ordering median
decreased from 85.58 ms to 83.27 ms, a 2.7% reduction. On
`process.application-processing.bpmn`, the fifteen-run median decreased from
589.23 ms to 475.12 ms, a 19.4% reduction.

The participant-ordering work above is complete. Do not retry its score-cache,
endpoint-lookup, obstacle-preparation, or broad-phase techniques. The separate
`countRouteCrossings` optimization is also complete: a candidate must strictly
reduce its bend count before crossings, route length, or displacement can
affect its acceptance. Candidate scoring now returns immediately when its bend
count cannot meet that condition, preserving the complete score for every
candidate that can be accepted.

With `npm run benchmark:fixture -- process.application-processing 60`, which
excludes 20 warm-up layouts, the restored optimization measured 477.46 ms
average, 471.84 ms p50, and 511.32 ms p90. An otherwise identical unoptimized
control measured 532.91 ms average, 528.47 ms p50, and 584.03 ms p90. The p50
improved by 10.7%.

Changing the ordering algorithm or threshold may alter diagram geometry and
therefore requires visual fixture review.

### 2. Fallback Visibility Routing

Fallback sequence-flow routing dominates difficult non-collaboration layouts.
In the profile of `sub-process.expanded-06-hour.bpmn`,
`SequenceFlowRouter.js` accounted for 74.8% of self time and `LayoutUtil.js`
for another 7.6%.

Before the first routing optimization, `visibilityRoute`:

1. combines every obstacle-derived x coordinate with every obstacle-derived y
   coordinate, producing a potentially quadratic point set;
2. tests every generated point against every shape;
3. represents pending nodes as a `Set`;
4. sorts the complete pending set on every shortest-path iteration; and
5. scans pending nodes and all shapes or previously routed segments when
   testing visibility.

An isolated test with distinct obstacle coordinates showed:

| Obstacles | Routing time |
| ---: | ---: |
| 4 | 2.78 ms |
| 8 | 6.57 ms |
| 12 | 19.64 ms |
| 16 | 58.04 ms |
| 20 | 170.62 ms |
| 24 | 326.07 ms |

The first optimization pass replaces the repeated pending-set sort with a
binary min-heap. For reachable nodes, the heap retains the original
distance-first, point-index tie-breaking order and uses lazy removal when a
node receives a shorter distance. Unreachable nodes no longer need queue
entries.

On `sub-process.expanded-06-hour.bpmn`, the twelve-run median decreased from
80.92 ms to 46.36 ms, a 42.7% reduction, without changing its snapshot output.
In a seven-run repeat of the 24-obstacle synthetic benchmark, the median
decreased from 328.22 ms to 89.33 ms, a 72.8% reduction.

The second optimization pass indexes visibility points by their x and y
coordinates. Each visited node now merges only its aligned coordinate buckets
in the original point-index order instead of scanning every pending node.
Obstacle insets, routed-connection segments, and shared-endpoint policies are
also computed once per visibility search rather than once per candidate edge.

Against the heap-optimized implementation, the representative fixture's median
decreased from 42.00 ms to 25.51 ms, a further 39.3% reduction. The median of
the 24-obstacle synthetic case decreased from 72.55 ms to 33.33 ms, a further
54.1% reduction.

The fallback may also run twice: first while avoiding previously routed
connections and again without those connections.

The visibility-routing work above is complete. Do not retry its heap,
coordinate-index, or collision-context techniques without a new
component-level diagnosis that identifies a distinct source of cost.

### 3. External Label Placement

External label placement accounted for 12.2% of self time in the slowest
fixture profile. The complete diagram emission stage took approximately
260 ms per layout. Removing element names reduced the fixture median from
approximately 1,195 ms to 1,025 ms, indicating roughly 170 ms of
name-dependent work; the CPU profile confirms that label placement is the
main contributor to that difference.

Before the first optimization, the label sort comparator called
`staticCandidateCount` repeatedly. Each call regenerated preferred candidates
and checked them against all shapes and all edge segments. Candidate placement
still performs similar full scans and also checks every previously occupied
label.

The first optimization pass now computes each label's preferred candidates and
static clear-candidate count once before sorting. Placement reuses the same
candidate arrays. In the isolated 120-label benchmark, the nine-run median
decreased from 6.97 ms to 4.21 ms, a 39.6% reduction. On
`blueprint.telco-service-order-fulfillment-retail.bpmn`, the twenty-run median
decreased from 144.20 ms to 138.07 ms, a 4.3% reduction.

The second optimization pass flattens edge waypoints into segment records once
per label-layout pass and stores each segment's bounds. Collision checks reject
segments with disjoint bounds before applying the exact intersection predicate.
On finalized DI from the same fixture, the fifty-run label-placement median
decreased from 3.82 ms to 2.16 ms, a 43.5% reduction. In an isolated benchmark
with 80 labels and 400 non-intersecting edges, the eleven-run median decreased
from 11.29 ms to 4.99 ms, a 55.8% reduction.

The label-placement work above is complete. Do not retry its candidate-sort or
edge-segment preparation techniques without new profiling evidence.

### 4. Artifact Placement and Accumulated Routes

The current Node.js traces place artifact placement at 20.5--21.7% of sampled
self time, making it the largest module cost in the application-processing
fixture. `findArtifactPlacement` alone accounts for 6.3--6.7%. For each
artifact, candidate scoring and validation can scan all graph obstacles,
existing routes, occupied artifacts, and boundary containers. Association
routes are recomputed for every candidate.

Sequence-flow collision checks also revisit every previously routed connection
and repeatedly convert routes into segments.

An attempted cache of artifact size candidates and flattened graph-route
segments improved an isolated preparation microbenchmark but not whole layouts.
On a direct 30-run A/B measurement, application processing was effectively
flat (333.09 ms with the change versus 335.36 ms without it), while
`blueprint.servicenow-integration-blueprint.bpmn` regressed (101.13 ms versus
96.03 ms). The change was rejected and is not shipped.

The rejected cache experiment must not be retried.

A stable min-heap traversal was also tested in place of sorting every ranked
candidate. It preserved lower-bound score ordering and deterministic candidate
ties, but did not generalize: application processing p50 improved slightly
(444.69 ms to 440.43 ms), while
`blueprint.servicenow-integration-blueprint.bpmn` regressed sharply (63.54 ms
to 113.26 ms). The change was rejected.

The accepted collision-input pass precomputes immutable obstacle bounds,
occupied-artifact clearance bounds, and participant-header bounds once per
placement search. Candidate validation reuses these exact rectangles instead
of recreating them for each candidate. In matched 60-layout measurements,
`process.application-processing.bpmn` p50 decreased from 482.30 ms to
450.88 ms and p90 from 568.43 ms to 488.33 ms. On
`blueprint.servicenow-integration-blueprint.bpmn`, p50 decreased from
115.71 ms to 68.47 ms and p90 from 140.14 ms to 75.63 ms.

## XML Processing

BPMN XML processing is not a primary bottleneck for the slowest fixture:

| Operation | Median |
| --- | ---: |
| Parse only | 16.48 ms |
| Parse and serialize | 33.34 ms |
| Complete layout | 1,195.10 ms |

Optimization effort should therefore focus on collaboration ordering, routing,
and collision detection before moddle parsing or serialization.

Performance changes that alter placement or routing must be reviewed with the
fixture inspector and layout metrics in addition to normal tests.
