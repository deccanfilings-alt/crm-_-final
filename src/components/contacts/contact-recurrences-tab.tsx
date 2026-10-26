"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import {
  Repeat,
  Plus,
  Trash2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ContactRecurrencesTabProps {
  contactId: string;
}

export function ContactRecurrencesTab({ contactId }: ContactRecurrencesTabProps) {
  const [recurrences, setRecurrences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [dayOfMonth, setDayOfMonth] = useState<string>("20");
  const [leadDays, setLeadDays] = useState<string>("3");
  const [nextDueDate, setNextDueDate] = useState<string>("");
  const [priority, setPriority] = useState<string>("medium");
  const [saving, setSaving] = useState(false);

  const fetchRecurrences = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/task-recurrences?contact_id=${contactId}`);
      if (!res.ok) throw new Error("Failed to load recurring schedules");
      const data = await res.json();
      setRecurrences(Array.isArray(data) ? data : []);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchRecurrences();
  }, [fetchRecurrences]);

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title for the recurrence");
      return;
    }
    if (!nextDueDate) {
      toast.error("Please pick the first due date");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/task-recurrences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contactId,
          title,
          description: description || null,
          frequency,
          day_of_month: Number(dayOfMonth) || null,
          lead_days: Number(leadDays) || 3,
          priority,
          next_due_date: nextDueDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create schedule");
      }

      toast.success("Recurring compliance schedule created!");
      setModalOpen(false);
      setTitle("");
      setDescription("");
      setNextDueDate("");
      fetchRecurrences();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/task-recurrences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setRecurrences((prev) =>
        prev.map((r) => (r.id === id ? { ...r, active: !currentActive } : r))
      );
      toast.success(!currentActive ? "Schedule resumed" : "Schedule paused");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/task-recurrences/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete schedule");
      setRecurrences((prev) => prev.filter((r) => r.id !== id));
      toast.success("Schedule removed");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Repeat className="h-3.5 w-3.5 text-primary" />
            Recurring Compliance Schedules
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Automated recurring filings (GST, TDS, ROC) for this client
          </p>
        </div>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="h-7 text-xs gap-1" />}>
            <Plus className="h-3 w-3" /> Add Schedule
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <Repeat className="h-4 w-4 text-primary" />
                New Recurring Compliance Schedule
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Schedule Title</Label>
                <Input
                  placeholder="e.g. Monthly GSTR-3B Filing"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={frequency} onValueChange={(val) => val && setFrequency(val)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Priority</Label>
                  <Select value={priority} onValueChange={(val) => val && setPriority(val)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">First Due Date</Label>
                  <Input
                    type="date"
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                    className="h-8 text-xs cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Lead Time (Days before due)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="30"
                    value={leadDays}
                    onChange={(e) => setLeadDays(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="3"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Description / Filing Notes (Optional)</Label>
                <Input
                  placeholder="e.g. Verify sales registers before filing"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={handleCreate}
              >
                {saving ? "Creating..." : "Create Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">
          Loading recurring schedules...
        </div>
      ) : recurrences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-5 text-center bg-card/20">
          <Repeat className="h-6 w-6 mx-auto text-muted-foreground/40 mb-1.5" />
          <p className="text-xs font-medium text-foreground">
            No recurring compliance schedules set for this client.
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Add recurring filings so the CRM automatically creates tasks before every deadline.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalOpen(true)}
            className="mt-2.5 h-7 text-xs gap-1"
          >
            <Plus className="h-3 w-3" /> Add Schedule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {recurrences.map((r) => (
            <div
              key={r.id}
              className={cn(
                "flex items-center justify-between p-2.5 rounded-lg border text-xs transition-colors",
                r.active
                  ? "bg-card border-border/70 hover:border-primary/40"
                  : "bg-muted/30 border-border/40 opacity-70"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate">{r.title}</span>
                  <Badge
                    variant="outline"
                    className="capitalize text-[10px] px-1.5 py-0 h-4 border-primary/30 text-primary"
                  >
                    {r.frequency}
                  </Badge>
                  {!r.active && (
                    <Badge variant="secondary" className="text-[9px] px-1 h-3.5">
                      Paused
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-muted-foreground/70" />
                    Next: {r.next_due_date}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground/70" />
                    Creates {r.lead_days}d prior
                  </span>
                  {r.assignee?.full_name && (
                    <span>Assigned: {r.assignee.full_name}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => handleToggleActive(r.id, r.active)}
                  title={r.active ? "Pause recurrence" : "Resume recurrence"}
                >
                  {r.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(r.id)}
                  title="Delete schedule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
