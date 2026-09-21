"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyNodeChanges,
  applyEdgeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  type Connection,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

import { type BuilderStep, StepEditor, blankConfig, cid } from "../automation-builder";
import { treeToGraph, graphToTree } from "./compiler";
import { AutomationNode } from "./automation-node";
import Dagre from "@dagrejs/dagre";

const nodeTypes = {
  automationNode: AutomationNode,
};

// Auto-layout function using Dagre
function getLayoutedElements(nodes: RfNode[], edges: RfEdge[], direction = 'TB') {
  const dagreGraph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 240, height: 90 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  Dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 240 / 2,
        y: nodeWithPosition.y - 90 / 2,
      },
    };
  });

  return { nodes: newNodes, edges };
}

interface AutomationCanvasProps {
  steps: BuilderStep[];
  onChange: (steps: BuilderStep[]) => void;
}

function AutomationCanvasInner({ steps, onChange }: AutomationCanvasProps) {
  const [nodes, setNodes] = useState<RfNode[]>([]);
  const [edges, setEdges] = useState<RfEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Initialize graph from tree only once on mount
  useEffect(() => {
    const { nodes: initialNodes, edges: initialEdges } = treeToGraph(steps);
    // Apply layout if nodes are overlapping (all at 0,0)
    const needsLayout = initialNodes.every(n => n.position.x === 0 && n.position.y === 0);
    if (needsLayout && initialNodes.length > 0) {
      const layouted = getLayoutedElements(initialNodes, initialEdges);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
    } else {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally only run on mount to prevent wiping out drag state

  const onNodesChange = useCallback(
    (changes: NodeChange<RfNode>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RfEdge>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const flushToTree = useCallback((currentNodes: RfNode[], currentEdges: RfEdge[]) => {
    const tree = graphToTree(currentNodes, currentEdges);
    onChange(tree);
  }, [onChange]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        // Prevent multiple outgoing edges from the same handle (or default handle)
        const filtered = eds.filter(
          (e) => !(e.source === params.source && e.sourceHandle === params.sourceHandle)
        );
        const nextEdges = addEdge(params, filtered);
        flushToTree(nodes, nextEdges);
        return nextEdges;
      });
    },
    [nodes, flushToTree]
  );

  const addStep = (type: any) => {
    const newStep: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
    };
    
    // Find a good position (center of visible area roughly, or just offset from last)
    const newNode: RfNode = {
      id: newStep.cid,
      type: "automationNode",
      position: { x: 100, y: 100 }, // Simplification: in a real app, use reactFlowInstance.project
      data: { step: newStep },
    };

    setNodes((nds) => {
      const nextNodes = [...nds, newNode];
      flushToTree(nextNodes, edges);
      return nextNodes;
    });
    setSelectedNodeId(newStep.cid);
  };

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId), [nodes, selectedNodeId]);

  const updateSelectedNodeConfig = (updatedStep: BuilderStep) => {
    setNodes((nds) => {
      const nextNodes = nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, step: updatedStep } } : n);
      flushToTree(nextNodes, edges);
      return nextNodes;
    });
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => {
      const nextNodes = nds.filter(n => n.id !== selectedNodeId);
      // Remove connected edges
      setEdges((eds) => {
        const nextEdges = eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId);
        flushToTree(nextNodes, nextEdges);
        return nextEdges;
      });
      return nextNodes;
    });
    setSelectedNodeId(null);
  };

  return (
    <div className="h-[600px] w-full rounded-md border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap zoomable pannable />
        
        {/* Floating Add Node toolbar */}
        <div className="absolute top-4 left-4 z-10 flex gap-2 bg-card p-2 rounded-lg border shadow-sm">
           {/* In a real implementation we would render a dropdown of step types. For simplicity: */}
           <Button variant="outline" size="sm" onClick={() => addStep('send_message')}>
             <Plus className="w-4 h-4 mr-2" /> Message
           </Button>
           <Button variant="outline" size="sm" onClick={() => addStep('condition')}>
             <Plus className="w-4 h-4 mr-2" /> Condition
           </Button>
           <Button variant="outline" size="sm" onClick={() => addStep('ai_generate')}>
             <Plus className="w-4 h-4 mr-2" /> AI Generate
           </Button>
           {/* Add layout button */}
           <Button variant="secondary" size="sm" onClick={() => {
             const layouted = getLayoutedElements(nodes, edges);
             setNodes(layouted.nodes);
             setEdges(layouted.edges);
           }}>
             Auto Layout
           </Button>
        </div>
      </ReactFlow>

      {/* Side Panel for Config */}
      <Sheet open={!!selectedNodeId} onOpenChange={(o) => !o && setSelectedNodeId(null)}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>Configure Step</SheetTitle>
          </SheetHeader>
          {selectedNode && (
            <div className="flex flex-col gap-6">
              <StepEditor 
                step={selectedNode.data.step as BuilderStep} 
                onChange={updateSelectedNodeConfig} 
              />
              <div className="border-t pt-4">
                <Button variant="destructive" className="w-full" onClick={removeSelectedNode}>
                  <Trash2 className="w-4 h-4 mr-2" /> Delete Node
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function AutomationCanvas(props: AutomationCanvasProps) {
  return (
    <ReactFlowProvider>
      <AutomationCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
