import { type Node as RfNode, type Edge as RfEdge } from "@xyflow/react";
import type { BuilderStep } from "../automation-builder";

/**
 * Converts a tree of BuilderSteps into a flat graph of nodes and edges for React Flow.
 */
export function treeToGraph(steps: BuilderStep[]): { nodes: RfNode[]; edges: RfEdge[] } {
  const nodes: RfNode[] = [];
  const edges: RfEdge[] = [];

  function traverse(
    stepList: BuilderStep[],
    parentId: string | null,
    branchLabel: string | null
  ) {
    let currentParent = parentId;
    let currentHandle = branchLabel;

    for (const step of stepList) {
      nodes.push({
        id: step.cid,
        type: 'automationNode',
        position: { x: 0, y: 0 }, // Dagre layout will set these later
        data: { step }
      });

      if (currentParent) {
        edges.push({
          id: `e-${currentParent}-${step.cid}`,
          source: currentParent,
          target: step.cid,
          sourceHandle: currentHandle || undefined,
          type: 'default'
        });
      }

      if (step.step_type === 'condition') {
        if (step.branches?.yes?.length) {
          traverse(step.branches.yes, step.cid, 'yes');
        }
        if (step.branches?.no?.length) {
          traverse(step.branches.no, step.cid, 'no');
        }
        // Since condition stops the linear flow (it forks permanently),
        // we break the sequence here.
        break;
      } else {
        currentParent = step.cid;
        currentHandle = null;
      }
    }
  }

  traverse(steps, null, null);

  return { nodes, edges };
}

/**
 * Converts a flat React Flow graph back into the hierarchical BuilderStep tree.
 */
export function graphToTree(nodes: RfNode[], edges: RfEdge[]): BuilderStep[] {
  // Find roots (nodes with no incoming edges)
  const incomingCount = new Map<string, number>();
  for (const node of nodes) incomingCount.set(node.id, 0);
  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
  }

  const roots = nodes.filter(n => incomingCount.get(n.id) === 0);
  if (roots.length === 0) return [];

  // We assume there's one main root for automations.
  // If there are disconnected components, they are ignored.
  const root = roots[0];

  function buildSequence(startId: string): BuilderStep[] {
    const sequence: BuilderStep[] = [];
    let currentId: string | undefined = startId;

    while (currentId) {
      const node = nodes.find(n => n.id === currentId);
      if (!node) break;

      const step = { ...(node.data.step as BuilderStep) }; // Clone to avoid mutating original
      
      if (step.step_type === 'condition') {
        const yesEdge = edges.find(e => e.source === currentId && e.sourceHandle === 'yes');
        const noEdge = edges.find(e => e.source === currentId && e.sourceHandle === 'no');

        step.branches = {
          yes: yesEdge ? buildSequence(yesEdge.target) : [],
          no: noEdge ? buildSequence(noEdge.target) : []
        };
        sequence.push(step);
        break; // Condition ends the linear sequence
      } else {
        sequence.push(step);
        // Find next node in sequence
        const nextEdge = edges.find(e => e.source === currentId);
        currentId = nextEdge ? nextEdge.target : undefined;
      }
    }

    return sequence;
  }

  return buildSequence(root.id);
}
