"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format, startOfWeek } from "date-fns";
import { Plus, Kanban, List as ListIcon, Calendar as CalendarIcon, Target } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskList } from "@/components/tasks/task-list";
import { TaskSheet } from "@/components/tasks/task-sheet";
import { UserPlanner } from "@/components/tasks/user-planner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionItem } from "@/components/tasks/types";

// ── Quick Add Task Modal ───────────────────────────────────────────────────
function AddTaskDialog({
  currentDate,
  onAdded,
}: {
  currentDate: Date;
  onAdded: (task: ActionItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          target_date: format(currentDate, "yyyy-MM-dd"),
          status: "todo",
        }),
      });
      if (!res.ok) throw new Error("Failed to add task");
      const added = await res.json();
      onAdded(added);
      setOpen(false);
      setTitle("");
      setDescription("");
      toast.success("Task added");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="h-4 w-4 mr-2" /> New Task
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Task — {format(currentDate, "MMM d, yyyy")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any additional details..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? "Saving..." : "Add Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Content Component ──────────────────────────────────────────────────────
function ActionItemsContent() {
  const { user, isAdmin, isOwner } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskParam = searchParams?.get("task");

  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [items, setItems] = useState<ActionItem[]>([]);
  const [overdueItems, setOverdueItems] = useState<ActionItem[]>([]);
  const [, setPlannerTasks] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<ActionItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("planner");
  const [showCancelled, setShowCancelled] = useState(false);

  // Deep-link handling: ?task=<id>
  useEffect(() => {
    if (!taskParam) return;
    fetch(`/api/action-items/${taskParam}`)
      .then((res) => {
        if (!res.ok) throw new Error("Task not found");
        return res.json();
      })
      .then((task) => {
        // If user is admin/owner and task does not belong to user, redirect to team view
        if (
          user &&
          (isAdmin || isOwner) &&
          task.agent_id !== user.id &&
          task.assignee_id !== user.id
        ) {
          router.replace(`/team-action-items?task=${task.id}`);
          return;
        }
        setActiveTask(task);
        setSheetOpen(true);
      })
      .catch((err) => {
        console.error("Failed to load deep-linked task:", err);
      });
  }, [taskParam, user, isAdmin, isOwner, router]);

  const activeItems = useMemo(() => {
    return items.filter((i) => showCancelled || i.status !== "cancelled");
  }, [items, showCancelled]);

  const fetchItems = async (date: Date) => {
    setLoading(true);
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      const weekStart = format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");

      const [res, overdueRes, planRes] = await Promise.all([
        fetch(`/api/action-items?date=${dateStr}`),
        fetch(`/api/action-items?date=${dateStr}&overdue=true`),
        fetch(`/api/action-items?week_start=${weekStart}`),
      ]);

      if (!res.ok) throw new Error("Failed to fetch items");
      const data = await res.json();
      setItems(
        data.filter(
          (item: any) => item.agent_id === user?.id || item.assignee_id === user?.id
        )
      );

      if (overdueRes.ok) {
        const overdueData = await overdueRes.json();
        setOverdueItems(
          overdueData.filter(
            (item: any) => item.agent_id === user?.id || item.assignee_id === user?.id
          )
        );
      }

      if (planRes.ok) {
        const planData = await planRes.json();
        const todayIds = new Set(data.map((i: any) => i.id));
        setPlannerTasks(
          planData.filter(
            (item: any) =>
              item.target_id &&
              !todayIds.has(item.id) &&
              (item.agent_id === user?.id || item.assignee_id === user?.id)
          )
        );
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchItems(currentDate);
    }
  }, [currentDate, user]);

  const handleTaskMoved = async (taskId: string, newStatus: string) => {
    const originalItem = items.find((i) => i.id === taskId);
    if (!originalItem) return;
    setItems((prev) => prev.map((i) => (i.id === taskId ? { ...i, status: newStatus as any } : i)));
    try {
      const res = await fetch(`/api/action-items/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch (error: any) {
      setItems((prev) => prev.map((i) => (i.id === taskId ? { ...i, status: originalItem.status } : i)));
      toast.error(error.message);
    }
  };

  const handleEditTask = (task: ActionItem) => {
    setActiveTask(task);
    setSheetOpen(true);
  };

  const handleUpdateTask = (updated: ActionItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  const handleDeleteTask = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const isToday =
    format(currentDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  const completedCount = items.filter((i) => i.status === "completed").length;
  const progress =
    items.length === 0 ? 0 : Math.round((completedCount / items.length) * 100);

  return (
    <div className="flex h-full w-full flex-col space-y-6 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">My Action Items</h1>

        <Popover>
          <PopoverTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "w-[240px] justify-start text-left font-normal",
              !currentDate && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {isToday
              ? `Today, ${format(currentDate, "MMM d")}`
              : format(currentDate, "MMM d, yyyy")}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={currentDate}
              onSelect={(date) => date && setCurrentDate(date)}
            />
          </PopoverContent>
        </Popover>
      </div>

      {overdueItems.length > 0 && isToday && (
        <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-lg flex items-center justify-between shrink-0">
          <span>You have {overdueItems.length} overdue task(s) from previous days.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-destructive/20 hover:bg-destructive/20"
            onClick={() => {
              const earliest = new Date(
                Math.min(...overdueItems.map((i) => new Date(i.target_date).getTime()))
              );
              setCurrentDate(earliest);
            }}
          >
            View Overdue Tasks
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between shrink-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
          <TabsList>
            <TabsTrigger value="planner" className="gap-2">
              <Target className="h-4 w-4" /> Planner
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-2">
              <Kanban className="h-4 w-4" /> Board
            </TabsTrigger>
            <TabsTrigger value="list" className="gap-2">
              <ListIcon className="h-4 w-4" /> List
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab !== "planner" && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {completedCount} of {items.length} completed ({progress}%)
            </span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={showCancelled}
                onCheckedChange={(c) => setShowCancelled(Boolean(c))}
              />
              <span>Show cancelled</span>
            </label>
            <AddTaskDialog
              currentDate={currentDate}
              onAdded={(task) => setItems((prev) => [...prev, task])}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground shrink-0">
          Loading tasks...
        </div>
      ) : (
        <div className="flex-1 overflow-hidden min-h-0">
          {activeTab === "planner" ? (
            <UserPlanner />
          ) : activeTab === "board" ? (
            <TaskBoard
              tasks={activeItems}
              onTaskMoved={handleTaskMoved}
              onAddTask={() => {}}
              onEditTask={handleEditTask}
            />
          ) : (
            <TaskList tasks={activeItems} onEditTask={handleEditTask} />
          )}
        </div>
      )}

      <TaskSheet
        task={activeTask}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdate={handleUpdateTask}
        onDelete={handleDeleteTask}
      />
    </div>
  );
}

export default function ActionItemsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">Loading action items...</div>}>
      <ActionItemsContent />
    </Suspense>
  );
}
