import { is } from '../../../di/DiUtil.js';
import { LayoutError } from '../../../LayoutError.js';
import {
  compareScores,
  inset,
  segmentEntersRect,
  toSegments
} from '../../geometry/index.js';
import { getDockSide } from '../../routing/BpmnDockRouting.js';
import {
  introducesHardDefect,
  scorePlacementCandidate
} from '../optimization/LayoutScoring.js';
import {
  clonePlacementCandidate,
  commitPlacementCandidate,
  createBaselineCandidate
} from '../optimization/PlacementCandidate.js';
import { rerouteSequenceFlowBundle } from './routeSequenceFlows.js';
import { routeSequenceFlowLayout } from './routeSequenceFlows.js';

import type { DockSide } from '../../routing/BpmnDockRouting.js';
import type { ConnectionDockAssignment } from '../routing/SequenceFlowRouting.js';
import type {
  BpmnElement,
  Bounds,
  ProcessLayoutContext
} from '../../Types.js';
import type { ModdleElement } from 'moddle';
import type {
  BpmnFlowNode,
  BpmnSequenceFlow
} from '../../../moddle-types/bpmn.js';

const DOCK_SIDES: readonly DockSide[] = [
  'north',
  'east',
  'south',
  'west'
];
const MAX_JUNCTION_CANDIDATES = 96;
const MAX_JUNCTION_MOVED_NODES = 5;
const MAX_PREFILTERED_JUNCTION_ASSIGNMENTS = 4;

type FlowNode = ModdleElement<BpmnFlowNode>;
type FlowEdge = ModdleElement<BpmnSequenceFlow> & {
  sourceRef: FlowNode;
  targetRef: FlowNode;
};

export function optimizeEventBasedGatewayJunctions(
    context: ProcessLayoutContext
): ProcessLayoutContext {
  const semanticPolicy = context.semantics.policy;

  if (!semanticPolicy) {
    return context;
  }

  const policy = semanticPolicy;
  const flows = context.elements.sequenceFlows.filter(
    (element): element is FlowEdge => {
      return is(element, 'bpmn:SequenceFlow') &&
        is(element.sourceRef, 'bpmn:FlowNode') &&
        is(element.targetRef, 'bpmn:FlowNode');
    }
  );
  const junctions = [ ...context.layout.shapes.keys() ]
    .filter(element => is(element, 'bpmn:EventBasedGateway'))
    .map(element => {
      const incoming = flows.filter(flow => flow.targetRef === element);
      const outgoing = flows.filter(flow => flow.sourceRef === element);

      return {
        element,
        flows: [ ...incoming, ...outgoing ],
        incoming: incoming.length,
        outgoing: outgoing.length
      };
    })
    .filter(({ flows, incoming, outgoing }) => {
      return incoming > 1 &&
        outgoing > 1 &&
        flows.length <= DOCK_SIDES.length;
    })
    .sort((a, b) => {
      return requiredDocumentIndex(policy.flowNodeDocumentIndex, a.element) -
        requiredDocumentIndex(policy.flowNodeDocumentIndex, b.element);
    });

  if (!junctions.length) {
    return context;
  }

  const baseline = createBaselineCandidate(context.layout);
  const baselineScore = scorePlacementCandidate(baseline, policy);
  let current = baseline;
  let currentScore = baselineScore;
  let evaluated = 0;

  for (const junction of junctions) {
    let best = current;
    let bestScore = currentScore;
    const bundle = new Set<BpmnElement>(junction.flows);
    const assignments = createSideAssignments(junction.flows.length);
    const currentApproachDefects = countJunctionApproachDefects(
      current.layout.shapes,
      current.layout.edges,
      junction.element,
      junction.flows
    );
    let bestJunctionVector: number[] | null = null;
    const fixedAssignments = assignments
      .map((sides, index) => ({
        defects: countAssignedApproachDefects(
          current.layout.shapes,
          junction.element,
          junction.flows,
          sides
        ),
        groupPenalty: countOpposingFlowGroups(
          sides,
          junction.incoming
        ),
        index,
        sides
      }))
      .filter(({ defects }) => defects < currentApproachDefects)
      .sort((a, b) => {
        return a.defects - b.defects ||
          a.groupPenalty - b.groupPenalty ||
          a.index - b.index;
      })
      .slice(0, MAX_PREFILTERED_JUNCTION_ASSIGNMENTS);

    for (const { groupPenalty, index, sides } of fixedAssignments) {
      if (evaluated >= MAX_JUNCTION_CANDIDATES) {
        break;
      }

      const candidate = clonePlacementCandidate(
        current,
        `${ current.moveKey }/junction-${ junction.element.id }-${ index }`
      );
      const docks = new Map<BpmnElement, ConnectionDockAssignment>(
        junction.flows.map((flow, flowIndex) => {
          const side = sides[flowIndex];

          return [
            flow,
            flow.sourceRef === junction.element
              ? { source: side, target: oppositeSide(side) }
              : { source: oppositeSide(side), target: side }
          ];
        })
      );

      evaluated++;

      try {
        candidate.layout.edges = rerouteSequenceFlowBundle({
          assignments: docks,
          bundle,
          flows,
          layout: candidate.layout,
          policy
        });
      } catch (error) {
        if (error instanceof LayoutError && error.code === 'ROUTING_FAILED') {
          continue;
        }

        throw error;
      }

      const score = scorePlacementCandidate(candidate, policy);
      const incidentBends = countBends(candidate.layout.edges, bundle);
      const continuationBends = countContinuationBends(
        candidate.layout.edges,
        junction.flows,
        flows,
        junction.element
      );
      const approachDefects = countJunctionApproachDefects(
        candidate.layout.shapes,
        candidate.layout.edges,
        junction.element,
        junction.flows
      );
      const junctionVector = [
        approachDefects,
        incidentBends,
        continuationBends,
        groupPenalty,
        candidate.displacement,
        score.bends,
        score.length,
        ...score.vector
      ];

      if (
        introducesHardDefect(score, baselineScore) ||
        approachDefects >= currentApproachDefects ||
        score.bends > currentScore.bends ||
        score.length > currentScore.length ||
        compareScores(score.vector, currentScore.vector) >= 0 ||
        bestJunctionVector &&
          compareScores(junctionVector, bestJunctionVector) >= 0
      ) {
        continue;
      }

      best = candidate;
      bestScore = score;
      bestJunctionVector = junctionVector;

      if (evaluated >= MAX_JUNCTION_CANDIDATES) {
        break;
      }
    }

    const alignedCandidates = assignments
      .map((sides, index) => ({
        groupPenalty: countOpposingFlowGroups(
          sides,
          junction.incoming
        ),
        index,
        sides
      }))
      .sort((a, b) => {
        return a.groupPenalty - b.groupPenalty ||
          a.index - b.index;
      })
      .slice(0, MAX_PREFILTERED_JUNCTION_ASSIGNMENTS)
      .map(({ groupPenalty, index, sides }) => {
        const candidate = clonePlacementCandidate(
          current,
          `${ current.moveKey }/junction-${ junction.element.id }-${ index }-aligned`
        );
        const docks = new Map<BpmnElement, ConnectionDockAssignment>(
          junction.flows.map((flow, flowIndex) => {
            const side = sides[flowIndex];

            return [
              flow,
              flow.sourceRef === junction.element
                ? { source: side, target: oppositeSide(side) }
                : { source: oppositeSide(side), target: side }
            ];
          })
        );
        const movedNodes = alignJunctionNeighbors(
          candidate,
          junction.element,
          junction.flows,
          sides,
          flows
        );

        if (!movedNodes) {
          return null;
        }

        return {
          candidate,
          docks,
          groupPenalty,
          index,
          movedNodes
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      .sort((a, b) => {
        return a.groupPenalty - b.groupPenalty ||
          a.candidate.displacement - b.candidate.displacement ||
          a.index - b.index;
      });

    for (const {
      candidate,
      docks,
      groupPenalty,
      movedNodes
    } of alignedCandidates) {
      if (evaluated >= MAX_JUNCTION_CANDIDATES) {
        break;
      }

      evaluated++;
      const affected = new Set<BpmnElement>(flows.filter(flow => {
        if (
          movedNodes.has(flow.sourceRef) ||
          movedNodes.has(flow.targetRef)
        ) {
          return true;
        }

        const points = candidate.layout.edges.get(flow);

        if (!points) {
          return false;
        }

        return [ ...movedNodes ].some(element => {
          const rect = candidate.layout.shapes.get(element);

          return rect && toSegments(points).some(([ start, end ]) => {
            return segmentEntersRect(start, end, inset(rect, 1));
          });
        });
      }));
      let evaluation = routeAndMeasure(false);

      if (!evaluation || !improvesJunction(evaluation)) {
        evaluation = routeAndMeasure(true);
      }

      if (!evaluation || !improvesJunction(evaluation)) {
        continue;
      }

      best = candidate;
      bestScore = evaluation.score;
      bestJunctionVector = evaluation.junctionVector;

      function routeAndMeasure(full: boolean) {
        try {
          candidate.layout.edges = full
            ? routeSequenceFlowLayout({
              shapes: candidate.layout.shapes,
              children: candidate.layout.children,
              flows,
              policy,
              adaptiveFeedbackSide: true,
              dockAssignments: docks
            })
            : rerouteSequenceFlowBundle({
              assignments: docks,
              bundle: affected,
              flows,
              layout: candidate.layout,
              policy
            });
        } catch (error) {
          if (error instanceof LayoutError && error.code === 'ROUTING_FAILED') {
            return null;
          }

          throw error;
        }

        const score = scorePlacementCandidate(candidate, policy);
        const incidentBends = countBends(candidate.layout.edges, bundle);
        const continuationBends = countContinuationBends(
          candidate.layout.edges,
          junction.flows,
          flows,
          junction.element
        );
        const approachDefects = countJunctionApproachDefects(
          candidate.layout.shapes,
          candidate.layout.edges,
          junction.element,
          junction.flows
        );

        return {
          approachDefects,
          junctionVector: [
            approachDefects,
            incidentBends,
            continuationBends,
            groupPenalty,
            candidate.displacement,
            score.bends,
            score.length,
            ...score.vector
          ],
          score
        };
      }

      function improvesJunction(
          evaluation: NonNullable<ReturnType<typeof routeAndMeasure>>
      ): boolean {
        return !introducesHardDefect(evaluation.score, baselineScore) &&
          evaluation.approachDefects < currentApproachDefects &&
          evaluation.score.bends <= currentScore.bends &&
          evaluation.score.length <= currentScore.length &&
          compareScores(evaluation.score.vector, currentScore.vector) < 0 &&
          (
            !bestJunctionVector ||
            compareScores(
              evaluation.junctionVector,
              bestJunctionVector
            ) < 0
          );
      }
    }

    function countBends(
        edges: Map<BpmnElement, { x: number; y: number }[]>,
        bundle: Set<BpmnElement>
    ): number {
      return [ ...bundle ].reduce((total, flow) => {
        return total + Math.max(0, (edges.get(flow)?.length || 2) - 2);
      }, 0);
    }

    function countContinuationBends(
        edges: Map<BpmnElement, { x: number; y: number }[]>,
        incidentFlows: FlowEdge[],
        graphFlows: FlowEdge[],
        element: BpmnElement
    ): number {
      return incidentFlows.reduce((total, incident) => {
        if (incident.sourceRef !== element) {
          return total;
        }

        const continuation = graphFlows.filter(flow => {
          return flow.sourceRef === incident.targetRef;
        });

        if (continuation.length !== 1) {
          return total;
        }

        return total + Math.max(
          0,
          (edges.get(continuation[0])?.length || 2) - 2
        );
      }, 0);
    }

    function countJunctionApproachDefects(
        shapes: Map<BpmnElement, Bounds>,
        edges: Map<BpmnElement, { x: number; y: number }[]>,
        element: BpmnElement,
        incidentFlows: FlowEdge[]
    ): number {
      const junctionBounds = shapes.get(element);

      if (!junctionBounds) {
        return incidentFlows.length;
      }

      const junctionCenter = center(junctionBounds);

      return incidentFlows.reduce((defects, flow) => {
        const points = edges.get(flow);
        const neighbor = flow.sourceRef === element
          ? flow.targetRef
          : flow.sourceRef;
        const neighborBounds = shapes.get(neighbor);

        if (!points?.length || !neighborBounds) {
          return defects + 1;
        }

        const endpoint = flow.sourceRef === element
          ? points[0]
          : points.at(-1);

        if (!endpoint) {
          return defects + 1;
        }

        const side = getDockSide(endpoint, junctionBounds);
        const neighborCenter = center(neighborBounds);
        const pointsTowardNeighbor = side === 'north'
          ? neighborCenter.y < junctionCenter.y
          : side === 'east'
            ? neighborCenter.x > junctionCenter.x
            : side === 'south'
              ? neighborCenter.y > junctionCenter.y
              : neighborCenter.x < junctionCenter.x;

        return defects + (pointsTowardNeighbor ? 0 : 1);
      }, 0);
    }

    function countAssignedApproachDefects(
        shapes: Map<BpmnElement, Bounds>,
        element: BpmnElement,
        incidentFlows: FlowEdge[],
        sides: DockSide[]
    ): number {
      const junctionBounds = shapes.get(element);

      if (!junctionBounds) {
        return incidentFlows.length;
      }

      const junctionCenter = center(junctionBounds);

      return incidentFlows.reduce((defects, flow, index) => {
        const neighbor = flow.sourceRef === element
          ? flow.targetRef
          : flow.sourceRef;
        const neighborBounds = shapes.get(neighbor);

        if (!neighborBounds) {
          return defects + 1;
        }

        const neighborCenter = center(neighborBounds);
        const side = sides[index];
        const pointsTowardNeighbor = side === 'north'
          ? neighborCenter.y < junctionCenter.y
          : side === 'east'
            ? neighborCenter.x > junctionCenter.x
            : side === 'south'
              ? neighborCenter.y > junctionCenter.y
              : neighborCenter.x < junctionCenter.x;

        return defects + (pointsTowardNeighbor ? 0 : 1);
      }, 0);
    }

    if (best !== current) {
      current = best;
      currentScore = bestScore;
    }

    function alignJunctionNeighbors(
        candidate: ReturnType<typeof createBaselineCandidate>,
        junction: BpmnElement,
        incidentFlows: FlowEdge[],
        sides: DockSide[],
        graphFlows: FlowEdge[]
    ): Set<BpmnElement> | null {
      const junctionBounds = candidate.layout.shapes.get(junction);

      if (!junctionBounds) {
        return null;
      }

      const junctionCenter = center(junctionBounds);
      const movements = new Map<BpmnElement, { dx: number; dy: number }>();

      for (let index = 0; index < incidentFlows.length; index++) {
        const flow = incidentFlows[index];
        const neighbor = flow.sourceRef === junction
          ? flow.targetRef
          : flow.sourceRef;
        const rect = candidate.layout.shapes.get(neighbor);

        if (
          !rect ||
          is(neighbor, 'bpmn:BoundaryEvent') ||
          is(neighbor, 'bpmn:SubProcess')
        ) {
          return null;
        }

        const neighborCenter = center(rect);
        const distance = Math.max(
          Math.abs(neighborCenter.x - junctionCenter.x),
          Math.abs(neighborCenter.y - junctionCenter.y),
          junctionBounds.width / 2 + rect.width / 2 + 20,
          junctionBounds.height / 2 + rect.height / 2 + 20
        );
        const target = sides[index] === 'north'
          ? { x: junctionCenter.x, y: junctionCenter.y - distance }
          : sides[index] === 'east'
            ? { x: junctionCenter.x + distance, y: junctionCenter.y }
            : sides[index] === 'south'
              ? { x: junctionCenter.x, y: junctionCenter.y + distance }
              : { x: junctionCenter.x - distance, y: junctionCenter.y };
        const movement = {
          dx: target.x - neighborCenter.x,
          dy: target.y - neighborCenter.y
        };
        const arm = collectLinearArm(flow, junction, graphFlows);

        for (const element of arm) {
          if (
            is(element, 'bpmn:BoundaryEvent') ||
            is(element, 'bpmn:SubProcess')
          ) {
            return null;
          }

          const existing = movements.get(element);

          if (
            existing &&
            (existing.dx !== movement.dx || existing.dy !== movement.dy)
          ) {
            return null;
          }

          movements.set(element, movement);
        }
      }

      function collectLinearArm(
          incident: FlowEdge,
          junction: BpmnElement,
          graphFlows: FlowEdge[]
      ): BpmnElement[] {
        const outgoing = incident.sourceRef === junction;
        const arm: BpmnElement[] = [];
        let current: BpmnElement = outgoing
          ? incident.targetRef
          : incident.sourceRef;

        while (arm.length < 6) {
          arm.push(current);

          const forward = graphFlows.filter(flow => {
            return outgoing
              ? flow.sourceRef === current
              : flow.targetRef === current;
          });
          const backward = graphFlows.filter(flow => {
            return outgoing
              ? flow.targetRef === current
              : flow.sourceRef === current;
          });

          if (
            forward.length !== 1 ||
            backward.length !== 1 ||
            is(current, 'bpmn:Gateway')
          ) {
            break;
          }

          const next = outgoing
            ? forward[0].targetRef
            : forward[0].sourceRef;

          if (next === junction || is(next, 'bpmn:Gateway')) {
            break;
          }

          current = next;
        }

        return arm;
      }

      if (movements.size > MAX_JUNCTION_MOVED_NODES) {
        return null;
      }

      includeAttachedBoundaryEvents(candidate.layout.shapes, movements);

      if (!fitsOriginalContainers(candidate.layout.shapes, movements)) {
        return null;
      }

      for (const [ element, { dx, dy } ] of movements) {
        const rect = candidate.layout.shapes.get(element);

        if (!rect) {
          continue;
        }

        rect.x += dx;
        rect.y += dy;
        candidate.displacement += Math.abs(dx) + Math.abs(dy);
      }

      return candidate.displacement > 0
        ? new Set(movements.keys())
        : null;
    }

    function includeAttachedBoundaryEvents(
        shapes: Map<BpmnElement, Bounds>,
        movements: Map<BpmnElement, { dx: number; dy: number }>
    ): void {
      for (const element of shapes.keys()) {
        if (!is(element, 'bpmn:BoundaryEvent')) {
          continue;
        }

        const host = element.attachedToRef;
        const movement = host && movements.get(host);

        if (movement) {
          movements.set(element, movement);
        }
      }
    }

    function fitsOriginalContainers(
        shapes: Map<BpmnElement, Bounds>,
        movements: Map<BpmnElement, { dx: number; dy: number }>
    ): boolean {
      const containers = [ ...shapes ]
        .filter(([ element ]) => {
          return is(element, 'bpmn:Lane') || is(element, 'bpmn:Participant');
        })
        .map(([ , rect ]) => rect);

      for (const [ element, { dx, dy } ] of movements) {
        const rect = shapes.get(element);

        if (!rect) {
          continue;
        }

        const memberships = containers.filter(container => {
          const { x, y } = center(rect);

          return x >= container.x &&
            x <= container.x + container.width &&
            y >= container.y &&
            y <= container.y + container.height;
        });
        const moved = {
          ...rect,
          x: rect.x + dx,
          y: rect.y + dy
        };

        if (memberships.some(container => {
          return moved.x < container.x ||
            moved.y < container.y ||
            moved.x + moved.width > container.x + container.width ||
            moved.y + moved.height > container.y + container.height;
        })) {
          return false;
        }
      }

      return true;
    }

    function center(rect: Bounds): { x: number; y: number } {
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      };
    }

    if (evaluated >= MAX_JUNCTION_CANDIDATES) {
      break;
    }
  }

  if (current !== baseline) {
    commitPlacementCandidate(context.layout, current);
  }

  return context;
}

function createSideAssignments(size: number): DockSide[][] {
  const assignments: DockSide[][] = [];

  visit([]);

  return assignments;

  function visit(current: DockSide[]): void {
    if (current.length === size) {
      assignments.push(current);
      return;
    }

    for (const side of DOCK_SIDES) {
      if (!current.includes(side)) {
        visit([ ...current, side ]);
      }
    }
  }
}

function oppositeSide(side: DockSide): DockSide {
  return side === 'north'
    ? 'south'
    : side === 'east'
      ? 'west'
      : side === 'south'
        ? 'north'
        : 'east';
}

function countOpposingFlowGroups(
    sides: DockSide[],
    incoming: number
): number {
  return countOpposingPairs(sides.slice(0, incoming)) +
    countOpposingPairs(sides.slice(incoming));

  function countOpposingPairs(group: DockSide[]): number {
    let opposing = 0;

    for (let left = 0; left < group.length; left++) {
      for (let right = left + 1; right < group.length; right++) {
        if (oppositeSide(group[left]) === group[right]) {
          opposing++;
        }
      }
    }

    return opposing;
  }
}

function requiredDocumentIndex(
    indexes: Map<BpmnElement, number>,
    element: BpmnElement
): number {
  const index = indexes.get(element);

  if (index === undefined) {
    throw new Error('Expected gateway document index');
  }

  return index;
}
