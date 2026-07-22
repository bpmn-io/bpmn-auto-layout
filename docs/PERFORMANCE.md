# Layout Performance Investigation

This document records a performance investigation of the layouter conducted on
July 22, 2026. It identifies current runtime bottlenecks and possible
optimization directions. It is not a performance contract or benchmark
baseline.

## Method

The investigation used:

- five measured runs per fixture after one warm-up run;
- all 153 valid fixtures in `test/fixtures/`;
- V8 sampling CPU profiles of representative slow fixtures;
- timings around major layout stages;
- isolated synthetic scaling tests for participant ordering, visibility
  routing, and label placement; and
- separate measurements of BPMN XML parsing and serialization.

Measurements were taken on the local development machine with Node.js
24.18.0. Absolute timings will vary by machine and Node.js version. Relative
costs, profiles, and scaling behavior are the primary evidence.

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

## Bottlenecks

### 1. Collaboration Participant Ordering

Participant ordering is the dominant cost for large collaborations. On
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

Remaining optimization opportunities:

1. Group obstacle shapes by participant so bend checks only inspect relevant
   vertical spans.
2. Replace exhaustive permutation with branch-and-bound or dynamic programming,
   or lower the threshold after visually reviewing the resulting participant
   order.
3. Investigate a more compact score-cache key if profiling shows key creation
   becoming significant.

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

Remaining optimization opportunities:

1. Evaluate connecting only adjacent visible points on each coordinate, with a
   route-cost model that does not penalize artificial intermediate points.
2. Index shapes and routed segments spatially for point and segment collision
   queries.
3. Cache segment-clearance results during one routing invocation.
4. Track why preferred routes fall back to visibility routing and reduce
   avoidable fallback calls.

### 3. External Label Placement

External label placement accounted for 12.2% of self time in the slowest
fixture profile. The complete diagram emission stage took approximately
260 ms per layout. Removing element names reduced the fixture median from
approximately 1,195 ms to 1,025 ms, indicating roughly 170 ms of
name-dependent work; the CPU profile confirms that label placement is the
main contributor to that difference.

The label sort comparator calls `staticCandidateCount` repeatedly. Each call
regenerates preferred candidates and checks them against all shapes and all
edge segments. Candidate placement repeats similar full scans and also checks
every previously occupied label.

Recommended optimization order:

1. Compute each label's static candidate count once before sorting.
2. Flatten edge waypoints into segments once instead of traversing every edge
   for every candidate.
3. Use a spatial index for shapes, segments, and occupied labels.
4. Reuse collision results shared by static ranking and final placement where
   inputs are unchanged.

### 4. Artifact Placement and Accumulated Routes

Artifact placement contributed 4.6% of self time in the slowest fixture. For
each artifact, candidate scoring and validation can scan all graph obstacles,
existing routes, occupied artifacts, and boundary containers. Association
routes are recomputed for every candidate.

Sequence-flow collision checks also revisit every previously routed connection
and repeatedly convert routes into segments.

Recommended optimizations:

- precompute and retain route segments;
- spatially index obstacle rectangles and route segments;
- cache association routes by candidate geometry where practical; and
- avoid rebuilding unchanged graph-shape and expanded-child collections across
  adjacent layout stages.

## XML Processing

BPMN XML processing is not a primary bottleneck for the slowest fixture:

| Operation | Median |
| --- | ---: |
| Parse only | 16.48 ms |
| Parse and serialize | 33.34 ms |
| Complete layout | 1,195.10 ms |

Optimization effort should therefore focus on collaboration ordering, routing,
and collision detection before moddle parsing or serialization.

## Suggested Implementation Sequence

1. Precompute label sort keys and endpoint-to-participant mappings. These are
   localized changes with low behavioral risk.
2. Add focused performance benchmarks for participant ordering and visibility
   routing so regressions and improvements are measurable.
3. Replace the visibility router's dense graph traversal while preserving route
   selection and failure behavior.
4. Rework participant ordering only with snapshot, metric, and visual review,
   because order changes directly affect output geometry.
5. Introduce a shared spatial index if profiles still show repeated global
   collision scans after the targeted changes.

Performance changes that alter placement or routing must be reviewed with the
fixture inspector and layout metrics in addition to normal tests.
