import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ActionItem } from "./types";

interface TaskListProps {
  tasks: ActionItem[];
  onEditTask: (task: ActionItem) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  high: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
};

export function TaskList({ tasks, onEditTask }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center border-2 border-dashed rounded-lg">
        <p className="text-muted-foreground">No tasks found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead className="text-right">Due Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal;
            const initials = task.assignee?.full_name?.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() || "?";

            return (
              <TableRow 
                key={task.id} 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onEditTask(task)}
              >
                <TableCell className="font-medium">
                  {task.title}
                  {task.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                      {task.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {STATUS_LABELS[task.status] || task.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`capitalize ${priorityColor}`}>
                    {task.priority}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        {task.assignee?.avatar_url && <AvatarImage src={task.assignee.avatar_url} />}
                        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-foreground">
                        {task.assignee?.full_name || "Unassigned"}
                      </span>
                    </div>
                    {task.agent_id !== task.assignee_id && task.agent?.full_name && (
                      <span className="text-[11px] text-muted-foreground">
                        by {task.agent.full_name}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {format(new Date(task.target_date), "MMM d, yyyy")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
