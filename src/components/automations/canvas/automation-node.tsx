import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { type BuilderStep, STEP_META, previewFor } from "../automation-builder";

interface AutomationNodeData extends Record<string, unknown> {
  step: BuilderStep;
  isFlashed?: boolean;
}

export function AutomationNode({ data, selected }: NodeProps) {
  const { step, isFlashed } = data as AutomationNodeData;
  const meta = STEP_META[step.step_type];
  const summary = previewFor(step);
  const Icon = meta.icon;

  const isCondition = step.step_type === "condition";

  return (
    <div
      className={cn(
        "relative min-w-[220px] max-w-[260px] rounded-lg border bg-card/95 px-3 py-2 text-left shadow-lg backdrop-blur transition-colors",
        selected
          ? "border-primary ring-1 ring-primary/40"
          : "border-border hover:border-border",
        isFlashed && "!border-amber-400 ring-2 ring-amber-400/60",
        meta.border
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-border !bg-muted"
      />

      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {meta.label}
        </span>
      </div>
      
      {summary && (
        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {summary}
        </div>
      )}

      {isCondition ? (
        <div className="mt-2 flex w-full justify-between px-4">
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase text-primary">Yes</span>
            <Handle
              type="source"
              id="yes"
              position={Position.Bottom}
              className="!relative !right-auto !top-auto !transform-none !h-2.5 !w-2.5 !border-border !bg-muted mt-1"
            />
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase text-rose-400">No</span>
            <Handle
              type="source"
              id="no"
              position={Position.Bottom}
              className="!relative !right-auto !top-auto !transform-none !h-2.5 !w-2.5 !border-border !bg-muted mt-1"
            />
          </div>
        </div>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2.5 !w-2.5 !border-border !bg-muted"
        />
      )}
    </div>
  );
}
