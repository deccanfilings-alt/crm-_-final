"use client";

// Pick which of the client's action items a quotation line bills for.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Task {
  id: string;
  title: string;
  status: string;
  target_date: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string | null;
  selected: string[];
  onSave: (ids: string[]) => void;
}

export function AttachTasksDialog({ open, onOpenChange, clientId, selected, onSave }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>(selected);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPicked(selected);
      try {
        const res = await fetch(`/api/billing/clients/${clientId}/tasks`);
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setTasks(res.ok ? (json.tasks ?? []) : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId, selected]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach Tasks</DialogTitle>
          <DialogDescription>Which of this client&apos;s action items does this line bill for?</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {!clientId && <p className="text-sm text-muted-foreground">Pick the client first.</p>}
          {loading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" />}
          {!loading && clientId && tasks.length === 0 && (
            <p className="text-sm text-muted-foreground">This client has no action items yet.</p>
          )}
          {tasks.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
              <span className="min-w-0 text-sm">
                <span className="block truncate">{t.title}</span>
                <span className="text-[11px] capitalize text-muted-foreground">
                  {t.status.replace("_", " ")}
                  {t.target_date ? ` · ${t.target_date.split("-").reverse().join("/")}` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(picked);
              onOpenChange(false);
            }}
          >
            Attach {picked.length ? `(${picked.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
