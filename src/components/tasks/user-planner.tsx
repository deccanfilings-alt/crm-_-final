"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { format, startOfWeek, startOfQuarter, addWeeks, subWeeks, addQuarters, subQuarters } from "date-fns";
import {
  Plus, Target, Clock, ChevronLeft, ChevronRight,
  Activity, CheckCircle2, Circle, Trash2, ChevronDown, ChevronUp,
  Pencil, Check, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ActionItem {
  id: string;
  title: string;
  status: string;
  estimated_hours: number | null;
}

interface UserTarget {
  id: string;
  period_type: "weekly" | "quarterly";
  period_start_date: string;
  title: string;
  description: string | null;
  status: "planned" | "in_progress" | "completed";
  action_items: ActionItem[];
}

const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
};

const STATUS_NEXT: Record<string, string> = {
  planned: "in_progress",
  in_progress: "completed",
  completed: "planned",
};

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

export function UserPlanner() {
  const { user } = useAuth();
  const [periodType, setPeriodType] = useState<"weekly" | "quarterly">("weekly");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [targets, setTargets] = useState<UserTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set());

  // Add Goal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTarget, setNewTarget] = useState({ title: "", description: "" });
  const [saving, setSaving] = useState(false);

  // Add Task inline
  const [addingTaskForTarget, setAddingTaskForTarget] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskHours, setNewTaskHours] = useState("");
  const taskInputRef = useRef<HTMLInputElement>(null);

  // Edit Goal inline
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const getPeriodStart = (date: Date, type: "weekly" | "quarterly") =>
    type === "weekly"
      ? startOfWeek(date, { weekStartsOn: 1 })
      : startOfQuarter(date);

  const periodStart = getPeriodStart(currentDate, periodType);

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    try {
      const dateStr = format(periodStart, "yyyy-MM-dd");
      const res = await fetch(
        `/api/user-targets?period_type=${periodType}&period_start_date=${dateStr}`
      );
      if (!res.ok) throw new Error("Failed to fetch targets");
      const data = await res.json();
      setTargets(data);
      setExpandedTargets(new Set(data.map((t: UserTarget) => t.id)));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [periodStart.toISOString(), periodType]);

  useEffect(() => {
    if (user) fetchTargets();
  }, [fetchTargets, user]);

  useEffect(() => {
    if (addingTaskForTarget) {
      setTimeout(() => taskInputRef.current?.focus(), 50);
    }
  }, [addingTaskForTarget]);

  const handleNext = () =>
    setCurrentDate((prev) =>
      periodType === "weekly" ? addWeeks(prev, 1) : addQuarters(prev, 1)
    );
  const handlePrev = () =>
    setCurrentDate((prev) =>
      periodType === "weekly" ? subWeeks(prev, 1) : subQuarters(prev, 1)
    );

  // ── Add Goal ──────────────────────────────────────────────────────────────
  const handleAddTarget = async () => {
    if (!newTarget.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/user-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTarget.title,
          description: newTarget.description || null,
          period_type: periodType,
          period_start_date: format(periodStart, "yyyy-MM-dd"),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create target");
      }
      const created = await res.json();
      setTargets((prev) => [...prev, { ...created, action_items: [] }]);
      setExpandedTargets((prev) => new Set([...prev, created.id]));
      setIsAddOpen(false);
      setNewTarget({ title: "", description: "" });
      toast.success("Goal added!");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Edit Goal (inline) ────────────────────────────────────────────────────
  const startEdit = (target: UserTarget, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTarget(target.id);
    setEditTitle(target.title);
    setEditDescription(target.description || "");
  };

  const saveEdit = async (targetId: string) => {
    if (!editTitle.trim()) return;
    try {
      const res = await fetch(`/api/user-targets/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update goal");
      setTargets((prev) =>
        prev.map((t) =>
          t.id === targetId
            ? { ...t, title: editTitle, description: editDescription || null }
            : t
        )
      );
      setEditingTarget(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const cancelEdit = () => setEditingTarget(null);

  // ── Goal Status ───────────────────────────────────────────────────────────
  const cycleStatus = async (target: UserTarget, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = STATUS_NEXT[target.status] as UserTarget["status"];
    setTargets((prev) =>
      prev.map((t) => (t.id === target.id ? { ...t, status: next } : t))
    );
    try {
      const res = await fetch(`/api/user-targets/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch (e: any) {
      setTargets((prev) =>
        prev.map((t) => (t.id === target.id ? { ...t, status: target.status } : t))
      );
      toast.error(e.message);
    }
  };

  // ── Delete Goal ───────────────────────────────────────────────────────────
  const handleDeleteTarget = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this goal and all its tasks?")) return;
    try {
      const res = await fetch(`/api/user-targets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete target");
      setTargets((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Add Task ──────────────────────────────────────────────────────────────
  const handleAddTask = async (targetId: string) => {
    if (!newTaskTitle.trim()) return;
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle,
          target_id: targetId,
          estimated_hours: newTaskHours ? parseFloat(newTaskHours) : null,
          target_date: format(periodStart, "yyyy-MM-dd"),
          status: "todo",
        }),
      });
      if (!res.ok) throw new Error("Failed to add task");
      const created = await res.json();
      setTargets((prev) =>
        prev.map((t) =>
          t.id === targetId
            ? { ...t, action_items: [...t.action_items, created] }
            : t
        )
      );
      setNewTaskTitle("");
      setNewTaskHours("");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Toggle Task ───────────────────────────────────────────────────────────
  const handleToggleTask = async (
    targetId: string,
    taskId: string,
    currentStatus: string
  ) => {
    const newStatus = currentStatus === "completed" ? "todo" : "completed";
    setTargets((prev) =>
      prev.map((t) =>
        t.id === targetId
          ? {
              ...t,
              action_items: t.action_items.map((i) =>
                i.id === taskId ? { ...i, status: newStatus } : i
              ),
            }
          : t
      )
    );
    try {
      const res = await fetch(`/api/action-items/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update task");
    } catch (e: any) {
      setTargets((prev) =>
        prev.map((t) =>
          t.id === targetId
            ? {
                ...t,
                action_items: t.action_items.map((i) =>
                  i.id === taskId ? { ...i, status: currentStatus } : i
                ),
              }
            : t
        )
      );
      toast.error(e.message);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b pb-4">
        <Tabs
          value={periodType}
          onValueChange={(val: any) => {
            setPeriodType(val);
            setCurrentDate(new Date());
          }}
        >
          <TabsList>
            <TabsTrigger value="weekly">Weekly Plan</TabsTrigger>
            <TabsTrigger value="quarterly">Quarterly Plan</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium w-[170px] text-center">
              {periodType === "weekly"
                ? `Week of ${format(periodStart, "MMM d, yyyy")}`
                : `Q${Math.floor(periodStart.getMonth() / 3) + 1} ${format(periodStart, "yyyy")}`}
            </span>
            <Button variant="outline" size="icon" onClick={handleNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="h-4 w-4 mr-2" /> Add Goal
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Add {periodType === "weekly" ? "Weekly" : "Quarterly"} Goal
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    autoFocus
                    value={newTarget.title}
                    onChange={(e) =>
                      setNewTarget({ ...newTarget, title: e.target.value })
                    }
                    placeholder="e.g. Close 5 deals..."
                    onKeyDown={(e) => e.key === "Enter" && handleAddTarget()}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Textarea
                    value={newTarget.description}
                    onChange={(e) =>
                      setNewTarget({ ...newTarget, description: e.target.value })
                    }
                    placeholder="Details about this goal..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddTarget} disabled={saving}>
                  {saving ? "Saving..." : "Save Goal"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Goal List ── */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">
            Loading plans...
          </div>
        ) : targets.length === 0 ? (
          <div className="text-center border-2 border-dashed rounded-xl p-12">
            <Target className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No goals set</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Click "Add Goal" to set your first {periodType} target.
            </p>
          </div>
        ) : (
          targets.map((target) => {
            const completedTasks =
              target.action_items?.filter((i) => i.status === "completed").length || 0;
            const totalTasks = target.action_items?.length || 0;
            const totalEstimatedHours =
              target.action_items?.reduce(
                (sum, item) => sum + (item.estimated_hours || 0),
                0
              ) || 0;
            const progress =
              totalTasks === 0
                ? 0
                : Math.round((completedTasks / totalTasks) * 100);
            const isExpanded = expandedTargets.has(target.id);
            const isEditing = editingTarget === target.id;
            const isAddingTask = addingTaskForTarget === target.id;

            return (
              <Card key={target.id} className="overflow-hidden">
                {/* ── Goal Header ── */}
                <CardHeader
                  className={`pb-3 transition-colors ${!isEditing ? "cursor-pointer hover:bg-muted/30" : ""}`}
                  onClick={() => !isEditing && toggleExpand(target.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        /* ── Inline Edit Mode ── */
                        <div
                          className="space-y-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            autoFocus
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="font-semibold h-8"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(target.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <Input
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description..."
                            className="text-sm h-8"
                          />
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              className="h-7"
                              onClick={() => saveEdit(target.id)}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" /> Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={cancelEdit}
                            >
                              <X className="h-3.5 w-3.5 mr-1" /> Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* ── Display Mode ── */
                        <>
                          <CardTitle className="text-base truncate">
                            {target.title}
                          </CardTitle>
                          {target.description && (
                            <CardDescription className="mt-0.5 line-clamp-1 text-xs">
                              {target.description}
                            </CardDescription>
                          )}
                        </>
                      )}
                    </div>

                    {/* ── Right side controls ── */}
                    {!isEditing && (
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Status badge — click to cycle */}
                        <button
                          onClick={(e) => cycleStatus(target, e)}
                          title="Click to change status"
                        >
                          <Badge
                            variant="outline"
                            className={`text-xs cursor-pointer transition-colors ${STATUS_COLORS[target.status]}`}
                          >
                            {STATUS_LABELS[target.status]}
                          </Badge>
                        </button>

                        {/* Stats */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {totalEstimatedHours > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {totalEstimatedHours}h
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            {completedTasks}/{totalTasks}
                          </span>
                        </div>

                        {/* Edit */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={(e) => startEdit(target, e)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        {/* Delete */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteTarget(target.id, e)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>

                        {/* Expand/collapse */}
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  {!isEditing && totalTasks > 0 && (
                    <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mt-3">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          progress === 100 ? "bg-emerald-500" : "bg-primary"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </CardHeader>

                {/* ── Task List ── */}
                {isExpanded && !isEditing && (
                  <CardContent className="pt-0 pb-3 border-t space-y-0.5">
                    {target.action_items.length === 0 && !isAddingTask && (
                      <p className="text-xs text-muted-foreground py-2 px-1">
                        No tasks yet.
                      </p>
                    )}

                    {target.action_items.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-muted/40 transition-colors"
                      >
                        <button
                          onClick={() =>
                            handleToggleTask(target.id, task.id, task.status)
                          }
                          className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                        >
                          {task.status === "completed" ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>
                        <span
                          className={`flex-1 text-sm ${
                            task.status === "completed"
                              ? "line-through text-muted-foreground"
                              : ""
                          }`}
                        >
                          {task.title}
                        </span>
                        {task.estimated_hours && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {task.estimated_hours}h
                          </span>
                        )}
                      </div>
                    ))}

                    {/* ── Inline Add Task ── */}
                    {isAddingTask ? (
                      <div className="flex items-center gap-2 pt-2">
                        <Input
                          ref={taskInputRef}
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Task title..."
                          className="h-8 text-sm flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddTask(target.id);
                            if (e.key === "Escape") {
                              setAddingTaskForTarget(null);
                              setNewTaskTitle("");
                            }
                          }}
                        />
                        <Input
                          type="number"
                          value={newTaskHours}
                          onChange={(e) => setNewTaskHours(e.target.value)}
                          placeholder="hrs"
                          className="h-8 text-sm w-16"
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => handleAddTask(target.id)}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => {
                            setAddingTaskForTarget(null);
                            setNewTaskTitle("");
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mt-1 pt-2 w-full transition-colors"
                        onClick={() => setAddingTaskForTarget(target.id)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add task
                      </button>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
