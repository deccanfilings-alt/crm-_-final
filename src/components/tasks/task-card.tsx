import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";
import { Calendar, User2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ActionItem } from "./types";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: ActionItem;
  onEdit: (task: ActionItem) => void;
  isOverlay?: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  high: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
};

export function TaskCard({ task, onEdit, isOverlay }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: task });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal;
  const initials = task.assignee?.full_name?.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() || "?";

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "group cursor-grab active:cursor-grabbing border-border bg-card shadow-sm transition-shadow hover:shadow-md",
        isDragging && "opacity-40",
        isOverlay && "cursor-grabbing opacity-100 ring-2 ring-primary rotate-2 shadow-xl"
      )}
      onClick={() => {
        // Prevent opening if dragging
        if (!isDragging && !isOverlay) onEdit(task);
      }}
      {...attributes}
      {...listeners}
    >
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight">
            {task.title}
          </span>
          <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 font-semibold capitalize shrink-0", priorityColor)}>
            {task.priority}
          </Badge>
        </div>

        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {task.description}
          </p>
        )}

        {task.agent_id !== task.assignee_id && task.agent?.full_name && (
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
            <User2 className="h-3 w-3" />
            <span className="truncate">Assigned by {task.agent.full_name}</span>
          </div>
        )}

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
          <div className="flex items-center text-xs text-muted-foreground gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span>{format(new Date(task.target_date), "MMM d")}</span>
          </div>

          <Avatar className="h-6 w-6 border bg-muted">
            {task.assignee?.avatar_url ? (
              <AvatarImage src={task.assignee.avatar_url} />
            ) : (
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            )}
          </Avatar>
        </div>
      </CardContent>
    </Card>
  );
}
