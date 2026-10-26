"use client";

import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X, Trash2, User2, Search, UserCheck, Ban, History, Repeat, MessageSquare, Paperclip, Send, FileText, Download, Loader2, Clock, CheckCircle2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import type { ActionItem, ActionItemEvent } from "./types";
import { formatDateTimeIST, getLateInfo } from "@/lib/dates";

interface TaskSheetProps {
  task: ActionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (task: ActionItem) => void;
  onDelete: (id: string) => void;
}

function renderEventLine(event: ActionItemEvent, taskTargetDate?: string) {
  const actorName = event.actor?.full_name || "System";
  const timeFormatted = formatDateTimeIST(event.created_at);

  let description = "";

  switch (event.event) {
    case 'created': {
      const assignedTo = event.to_profile?.full_name;
      description = `${actorName} created this task${assignedTo ? ` and assigned it to ${assignedTo}` : ''}`;
      break;
    }
    case 'status_changed': {
      const toVal = event.to_value || "";
      if (toVal === 'completed') {
        const late = getLateInfo(event.created_at, taskTargetDate);
        const lateText = late.isLate ? ` (${late.daysLate} day${late.daysLate > 1 ? 's' : ''} late)` : "";
        description = `${actorName} marked it Completed${lateText}`;
      } else if (toVal.startsWith('cancelled')) {
        const reason = toVal.replace(/^cancelled:\s*/, '');
        description = `${actorName} cancelled this task${reason ? `: "${reason}"` : ''}`;
      } else {
        const statusMap: Record<string, string> = {
          todo: 'To Do',
          in_progress: 'In Progress',
          review: 'Review',
        };
        description = `${actorName} changed status to ${statusMap[toVal] || toVal}`;
      }
      break;
    }
    case 'reassigned': {
      const toName = event.to_profile?.full_name || "someone";
      description = `${actorName} reassigned this to ${toName}`;
      break;
    }
    case 'due_changed': {
      description = `${actorName} changed due date to ${event.to_value || "new deadline"}`;
      break;
    }
    case 'priority_changed': {
      description = `${actorName} changed priority to ${event.to_value}`;
      break;
    }
    case 'title_changed': {
      description = `${actorName} changed title to "${event.to_value}"`;
      break;
    }
    default:
      description = `${actorName} updated this task (${event.event})`;
  }

  return { description, timeFormatted };
}

export function TaskSheet({ task, open, onOpenChange, onUpdate, onDelete }: TaskSheetProps) {
  const { isOwner, isAdmin, user } = useAuth();
  const [formData, setFormData] = useState<Partial<ActionItem>>({});
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [dueTime, setDueTime] = useState("");

  // Events history state
  const [events, setEvents] = useState<ActionItemEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Cancellation state
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isRepeating, setIsRepeating] = useState(false);
  const [repeatFrequency, setRepeatFrequency] = useState<string>("monthly");
  const [repeatLeadDays, setRepeatLeadDays] = useState<number>(3);

  // Comments state (Task 11)
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentFiles, setCommentFiles] = useState<any[]>([]);
  const [postingComment, setPostingComment] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const isCreator = Boolean(user && task && task.agent_id === user.id);
  const isAssignee = Boolean(user && task && task.assignee_id === user.id);
  const canManageAll = Boolean(isOwner || isAdmin || isCreator);
  const isAssigneeOnly = isAssignee && !canManageAll;

  const loadComments = useCallback(async (taskId: string) => {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/action-items/${taskId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error("Failed to load comments:", e);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  const handlePostComment = async () => {
    if (!task?.id || (!commentText.trim() && commentFiles.length === 0)) return;
    setPostingComment(true);
    try {
      const res = await fetch(`/api/action-items/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: commentText.trim() || "Uploaded attachments",
          attachments: commentFiles,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to post comment");
      }

      const newComment = await res.json();
      setComments((prev) => [...prev, newComment]);
      setCommentText("");
      setCommentFiles([]);
      toast.success("Comment posted");
      loadEvents(task.id);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPostingComment(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAttachment(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/action-items/upload", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const uploaded = await res.json();
      setCommentFiles((prev) => [...prev, uploaded]);
      toast.success(`Attached "${file.name}"`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploadingAttachment(false);
      e.target.value = "";
    }
  };

  const loadEvents = useCallback(async (taskId: string) => {
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/action-items/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.events) {
          setEvents(data.events);
        }
      }
    } catch (err) {
      console.error("Failed to load task events:", err);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    if (task) {
      setFormData({
        ...task,
        subtasks: task.subtasks || [],
      });
      if (task.due_at) {
        try {
          const formatted = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(task.due_at));
          setDueTime(formatted);
        } catch {
          setDueTime('');
        }
      } else {
        setDueTime('');
      }
      setContactSearch("");
      setSearchResults([]);
      setIsCancelling(false);
      setCancelReason(task.cancel_reason || "");
      setIsRepeating(false);
    }
  }, [task]);

  useEffect(() => {
    if (open && task?.id) {
      loadEvents(task.id);
      loadComments(task.id);
    } else {
      setEvents([]);
      setComments([]);
      setCommentText("");
      setCommentFiles([]);
    }
  }, [open, task?.id, loadEvents, loadComments]);

  useEffect(() => {
    if (!open) return;
    
    const fetchData = async () => {
      try {
        if (isOwner || isAdmin) {
          const membersRes = await fetch("/api/account/members");
          if (membersRes.ok) {
            const data = await membersRes.json();
            setMembers(data.members || []);
          }
        }

        if (task?.contact_id) {
          const contactRes = await fetch(`/api/contacts?limit=25`);
          if (contactRes.ok) {
            const data = await contactRes.json();
            const found = (data.contacts || []).find((c: any) => c.id === task.contact_id);
            if (found) setSelectedContact(found);
          }
        } else {
          setSelectedContact(null);
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchData();
  }, [open, isOwner, isAdmin, task?.contact_id]);

  const searchContacts = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(term.trim())}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.contacts || []);
      }
    } catch (err) {
      console.error("Failed to search contacts:", err);
    }
  }, []);

  if (!task) return null;

  const handleAddSubtask = () => {
    if (!newSubtask.trim()) return;
    const subtask = {
      id: crypto.randomUUID(),
      title: newSubtask.trim(),
      completed: false,
    };
    setFormData(prev => ({
      ...prev,
      subtasks: [...(prev.subtasks || []), subtask]
    }));
    setNewSubtask("");
  };

  const handleToggleSubtask = (id: string) => {
    setFormData(prev => ({
      ...prev,
      subtasks: prev.subtasks?.map(st => 
        st.id === id ? { ...st, completed: !st.completed } : st
      )
    }));
  };

  const handleDeleteSubtask = (id: string) => {
    setFormData(prev => ({
      ...prev,
      subtasks: prev.subtasks?.filter(st => st.id !== id)
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = isAssigneeOnly
        ? {
            status: formData.status,
            description: formData.description,
            subtasks: formData.subtasks,
            estimated_hours: formData.estimated_hours,
          }
        : {
            title: formData.title,
            description: formData.description,
            status: formData.status,
            priority: formData.priority,
            assignee_id: formData.assignee_id,
            target_date: formData.target_date,
            due_at: formData.target_date && dueTime && dueTime.trim()
              ? new Date(`${formData.target_date}T${dueTime.trim()}:00+05:30`).toISOString()
              : null,
            subtasks: formData.subtasks,
            requires_review: formData.requires_review,
            contact_id: formData.contact_id,
            deal_id: formData.deal_id,
            conversation_id: formData.conversation_id,
            estimated_hours: formData.estimated_hours,
          };

      const res = await fetch(`/api/action-items/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Failed to update task");
      }

      const updated = await res.json();
      if (isRepeating && formData.target_date) {
        await fetch("/api/task-recurrences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formData.title || task.title,
            description: formData.description || null,
            assignee_id: formData.assignee_id || user?.id,
            priority: formData.priority || "medium",
            contact_id: formData.contact_id || null,
            frequency: repeatFrequency,
            lead_days: repeatLeadDays,
            next_due_date: formData.target_date,
          }),
        }).catch((e) => console.error("Failed to create recurrence:", e));
        toast.success("Recurring schedule configured!");
      }
      onUpdate({ ...task, ...updated });
      toast.success("Task updated");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelTask = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please enter a reason for cancelling this task");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/action-items/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "cancelled",
          cancel_reason: cancelReason.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Failed to cancel task");
      }

      const updated = await res.json();
      onUpdate({ ...task, ...updated });
      toast.success("Task cancelled");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      const res = await fetch(`/api/action-items/${task.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Failed to delete task");
      }
      onDelete(task.id);
      toast.success("Task deleted");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto p-4 sm:p-5">
        <SheetHeader>
          <SheetTitle>Edit Task</SheetTitle>
          <SheetDescription>
            {isAssigneeOnly
              ? `Only ${task.agent?.full_name || "the creator"} or an admin can change title, assignee, deadline, or priority.`
              : "Update the details of your task."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Review Banner for Creator or Admin (Task 12) */}
          {formData.status === "review" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-500 flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  Task Submitted for Review
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Verification Required
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                The assignee completed their work and submitted it for sign-off.
              </p>
              {canManageAll && (
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, status: "completed" }));
                      toast.info("Status set to Completed. Save to confirm!");
                    }}
                  >
                    <CheckCircle2 className="h-3 w-3" /> Approve & Complete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-amber-500 border-amber-500/40 hover:bg-amber-500/10 gap-1"
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, status: "in_progress" }));
                      toast.info("Status returned to In Progress. Please add feedback in comments!");
                    }}
                  >
                    Send Back for Changes
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="px-1">Title</Label>
            <Input 
              value={formData.title || ""} 
              disabled={isAssigneeOnly}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })} 
            />
            {isAssigneeOnly && (
              <span className="text-[11px] text-muted-foreground px-1 italic">
                Only {task.agent?.full_name || "the creator"} or an admin can change this
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Status</Label>
              <Select 
                value={formData.status || "todo"} 
                onValueChange={(val: any) => setFormData({ ...formData, status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  {formData.status === "cancelled" && (
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Priority</Label>
              <Select 
                value={formData.priority || "normal"} 
                disabled={isAssigneeOnly}
                onValueChange={(val: any) => setFormData({ ...formData, priority: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Target Date</Label>
              <Input 
                type="date"
                disabled={isAssigneeOnly}
                value={formData.target_date || ""} 
                onChange={(e) => setFormData({ ...formData, target_date: e.target.value })} 
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Due Time (IST)</Label>
              <Input 
                type="time"
                disabled={isAssigneeOnly}
                value={dueTime} 
                onChange={(e) => setDueTime(e.target.value)} 
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Estimated Hours</Label>
              <Input 
                type="number" 
                step="0.5"
                placeholder="e.g. 2.5"
                value={formData.estimated_hours ?? ""} 
                onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value ? parseFloat(e.target.value) : null })} 
              />
            </div>
          </div>

          {/* Repeat option for recurring compliance */}
          {!isAssigneeOnly && (
            <div className="rounded-xl border border-border/70 p-3 bg-muted/20 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={isRepeating}
                  onCheckedChange={(c) => setIsRepeating(Boolean(c))}
                />
                <span className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                  <Repeat className="h-3.5 w-3.5 text-primary" />
                  Repeat task automatically (Compliance Schedule)
                </span>
              </label>

              {isRepeating && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-muted-foreground">Frequency</Label>
                    <Select
                      value={repeatFrequency}
                      onValueChange={(val) => val && setRepeatFrequency(val)}
                    >
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
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-muted-foreground">Lead Days</Label>
                    <Input
                      type="number"
                      min="0"
                      max="30"
                      value={repeatLeadDays}
                      onChange={(e) => setRepeatLeadDays(Number(e.target.value) || 0)}
                      className="h-8 text-xs"
                      placeholder="3"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Requires Review toggle (Task 12) */}
          {!isAssigneeOnly && (
            <label className="flex items-center gap-2 px-1 cursor-pointer select-none">
              <Checkbox
                checked={Boolean(formData.requires_review)}
                onCheckedChange={(c) => setFormData({ ...formData, requires_review: Boolean(c) })}
              />
              <span className="text-xs text-muted-foreground hover:text-foreground">
                Requires creator/admin review before task is marked completed
              </span>
            </label>
          )}

          {(isOwner || isAdmin) && (
            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Assign To</Label>
              <Select 
                value={formData.assignee_id || user?.id || ""} 
                disabled={isAssigneeOnly}
                onValueChange={(val) => setFormData({ ...formData, assignee_id: val || undefined })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={user?.id || ""}>Me</SelectItem>
                  
                  {formData.assignee_id && formData.assignee_id !== user?.id && !members.find(m => m.user_id === formData.assignee_id) && (
                    <SelectItem value={formData.assignee_id}>
                      {task.assignee?.full_name || task.agent?.full_name || "Unknown Agent"}
                    </SelectItem>
                  )}

                  {members.filter(m => m.user_id !== user?.id && (isOwner || m.role !== 'owner')).map(m => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {task.agent_id && task.assignee_id && task.agent_id !== task.assignee_id && task.agent?.full_name && (
            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-[13px] text-muted-foreground flex items-center gap-1.5">
                <User2 className="h-3.5 w-3.5" />
                Assigned by <strong>{task.agent.full_name}</strong>
              </span>
            </div>
          )}

          {/* Linked Contact */}
          <div className="flex flex-col gap-1.5">
            <Label className="px-1">Linked Contact</Label>
            {formData.contact_id ? (
              <div className="flex items-center justify-between p-2 rounded-md border bg-muted/40 text-sm">
                <span className="font-medium truncate flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-primary shrink-0" />
                  {selectedContact ? `${selectedContact.name} (${selectedContact.phone || selectedContact.email || "Contact"})` : "Contact attached"}
                </span>
                {!isAssigneeOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, contact_id: null, deal_id: null }));
                      setSelectedContact(null);
                    }}
                    title="Remove contact link"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : isAssigneeOnly ? (
              <span className="text-xs text-muted-foreground italic px-1">No contact linked</span>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search contact by name or phone..."
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      searchContacts(e.target.value);
                    }}
                    className="pl-8 h-9 text-sm"
                  />
                </div>
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded flex flex-col gap-0.5 cursor-pointer"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, contact_id: c.id }));
                          setSelectedContact(c);
                          setSearchResults([]);
                          setContactSearch("");
                        }}
                      >
                        <span className="font-semibold text-foreground">{c.name}</span>
                        <span className="text-[11px] text-muted-foreground">{c.phone || c.email || c.company || "No info"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="px-1">Description</Label>
            <Textarea 
              placeholder="Add more details to this task..."
              className="min-h-[100px] resize-none"
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Label className="px-1">Subtasks</Label>
            <div className="flex flex-col gap-2">
              {formData.subtasks?.map((st) => (
                <div key={st.id} className="flex items-center gap-3 bg-muted/30 p-2 rounded-md group">
                  <Checkbox 
                    checked={st.completed} 
                    onCheckedChange={() => handleToggleSubtask(st.id)}
                    className="mt-0.5"
                  />
                  <span className={`flex-1 text-sm ${st.completed ? 'line-through text-muted-foreground' : ''}`}>
                    {st.title}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 opacity-0 group-hover:opacity-100" 
                    onClick={() => handleDeleteSubtask(st.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <Input 
                  placeholder="Add a subtask..." 
                  value={newSubtask}
                  onChange={e => setNewSubtask(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSubtask()}
                  className="h-8 text-sm"
                />
                <Button variant="secondary" size="sm" className="h-8" onClick={handleAddSubtask}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Cancellation reason display if cancelled */}
          {formData.status === "cancelled" && (
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-xs space-y-1">
              <span className="font-semibold text-destructive flex items-center gap-1">
                <Ban className="h-3.5 w-3.5" /> Cancelled Task
              </span>
              <p className="text-muted-foreground">Reason: {formData.cancel_reason || "No reason specified"}</p>
            </div>
          )}

          {/* Inline Cancellation Reason box */}
          {isCancelling && (
            <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/5 space-y-2">
              <Label className="text-xs font-semibold text-destructive">Cancellation Reason</Label>
              <Input
                placeholder="Why is this task being cancelled?"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="h-8 text-xs bg-background"
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setIsCancelling(false)}>
                  Back
                </Button>
                <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleCancelTask} disabled={saving || !cancelReason.trim()}>
                  Confirm Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Comments & Attachments Section (Task 11) */}
          {task.id && (
            <div className="flex flex-col gap-3 pt-4 border-t border-border/60">
              <div className="flex items-center justify-between px-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  Comments & Files ({comments.length})
                </Label>
                {loadingComments && <span className="text-[11px] text-muted-foreground animate-pulse">Loading comments...</span>}
              </div>

              {/* Comments list */}
              {comments.length === 0 && !loadingComments ? (
                <div className="p-3 text-center rounded-xl border border-dashed bg-muted/20 text-xs text-muted-foreground">
                  No comments yet. Share updates or attach files below.
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-h-64 overflow-y-auto px-1">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px]">
                              {(c.author?.full_name || "U").substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-semibold text-foreground">
                            {c.author?.full_name || "Team Member"}
                          </span>
                          {c.author?.account_role && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 capitalize text-muted-foreground">
                              {c.author.account_role}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTimeIST(c.created_at)}
                        </span>
                      </div>

                      <p className="text-foreground leading-relaxed whitespace-pre-wrap pl-7">
                        {c.body}
                      </p>

                      {/* Attachments preview */}
                      {Array.isArray(c.attachments) && c.attachments.length > 0 && (
                        <div className="pl-7 flex flex-wrap gap-1.5 pt-1">
                          {c.attachments.map((att: any, idx: number) => (
                            <a
                              key={idx}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border border-border/80 text-[11px] font-medium text-primary hover:underline hover:bg-muted/50 transition-colors"
                              title="Click to view/download file"
                            >
                              <FileText className="h-3 w-3" />
                              <span className="max-w-[150px] truncate">{att.name}</span>
                              <Download className="h-2.5 w-2.5 text-muted-foreground" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Comment composer */}
              <div className="rounded-xl border border-border/70 bg-card p-2.5 space-y-2">
                <Textarea
                  placeholder="Write a comment, note, or update..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handlePostComment();
                    }
                  }}
                  className="min-h-[60px] text-xs resize-none bg-background border-none p-1.5 focus-visible:ring-0 shadow-none"
                />

                {/* Staged attachments chips */}
                {commentFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {commentFiles.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] text-primary"
                      >
                        <Paperclip className="h-3 w-3" />
                        <span className="max-w-[120px] truncate">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setCommentFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="hover:text-destructive"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-border/40 px-1">
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium transition-colors">
                      <input
                        type="file"
                        className="hidden"
                        onChange={handleFileUpload}
                        disabled={uploadingAttachment}
                      />
                      {uploadingAttachment ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Paperclip className="h-3.5 w-3.5" />
                          <span>Attach File</span>
                        </>
                      )}
                    </label>
                  </div>

                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 px-3"
                    disabled={postingComment || (!commentText.trim() && commentFiles.length === 0)}
                    onClick={handlePostComment}
                  >
                    {postingComment ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Comment
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* History Section */}
          {task.id && (
            <div className="flex flex-col gap-2 pt-4 border-t border-border/60">
              <div className="flex items-center justify-between px-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  History
                </Label>
                {loadingEvents && <span className="text-[11px] text-muted-foreground animate-pulse">Loading...</span>}
              </div>

              {events.length === 0 && !loadingEvents ? (
                <div className="p-3 text-center rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
                  No activity recorded yet
                </div>
              ) : (
                <div className="flex flex-col gap-2 divide-y divide-border/40 max-h-56 overflow-y-auto px-1">
                  {[...events].reverse().map((ev) => {
                    const { description, timeFormatted } = renderEventLine(ev, task.target_date);
                    return (
                      <div key={ev.id} className="pt-2 first:pt-0 flex items-start justify-between gap-2 text-xs">
                        <span className="text-foreground leading-snug">
                          {description}
                        </span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                          {timeFormatted}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div className="flex items-center gap-2">
            {canManageAll && !isCancelling && formData.status !== "cancelled" && (
              <Button variant="outline" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => setIsCancelling(true)}>
                <Ban className="h-3.5 w-3.5 mr-1" /> Cancel Task
              </Button>
            )}
            {canManageAll && !isCancelling && (
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:bg-destructive/10" onClick={handleDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            )}
          </div>
          <div className="space-x-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
