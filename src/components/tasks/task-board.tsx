"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ActionItem } from "./types";
import { TaskColumn } from "./task-column";
import { TaskCard } from "./task-card";

interface TaskBoardProps {
  tasks: ActionItem[];
  onTaskMoved: (taskId: string, newStatus: string) => void;
  onAddTask: (status: string) => void;
  onEditTask: (task: ActionItem) => void;
}

const COLUMNS = [
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "completed", title: "Completed" },
];

export function TaskBoard({ tasks, onTaskMoved, onAddTask, onEditTask }: TaskBoardProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const task of tasks) {
      const bucket = map.get(task.status);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveTaskId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    
    const taskId = String(active.id);
    const targetStatus = String(over.id);

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;
    if (!COLUMNS.some((c) => c.id === targetStatus)) return;

    onTaskMoved(taskId, targetStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      <div className="flex h-full gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <TaskColumn
            key={col.id}
            id={col.id}
            title={col.title}
            tasks={tasksByStatus.get(col.id) ?? []}
            onAdd={onAddTask}
            onEdit={onEditTask}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTask ? (
          <TaskCard task={activeTask} onEdit={() => {}} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
