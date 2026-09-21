import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionItem } from "./types";
import { TaskCard } from "./task-card";

interface TaskColumnProps {
  id: string;
  title: string;
  tasks: ActionItem[];
  onAdd: (status: string) => void;
  onEdit: (task: ActionItem) => void;
}

export function TaskColumn({ id, title, tasks, onAdd, onEdit }: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex h-full w-[280px] min-w-[280px] flex-col rounded-md bg-muted/30">
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="flex h-5 items-center justify-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onAdd(id)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto p-2 space-y-2 transition-colors ${
          isOver ? "bg-muted/50" : ""
        }`}
      >
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onEdit={onEdit} />
        ))}
      </div>
    </div>
  );
}
