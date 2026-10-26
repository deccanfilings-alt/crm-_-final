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
import { Plus, X, Trash2, User2, Search, UserCheck, Ban } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import type { ActionItem } from "./types";

interface TaskSheetProps {
  task: ActionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (task: ActionItem) => void;
  onDelete: (id: string) => void;
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

  // Cancellation state
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isCreator = Boolean(user && task && task.agent_id === user.id);
  const isAssignee = Boolean(user && task && task.assignee_id === user.id);
  const canManageAll = Boolean(isOwner || isAdmin || isCreator);
  const isAssigneeOnly = isAssignee && !canManageAll;

  useEffect(() => {
    if (task) {
      setFormData({
        ...task,
        subtasks: task.subtasks || [],
      });
      setContactSearch("");
      setSearchResults([]);
      setIsCancelling(false);
      setCancelReason(task.cancel_reason || "");
    }
  }, [task]);

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
            due_at: formData.due_at,
            subtasks: formData.subtasks,
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
          <div className="flex flex-col gap-1.5">
            <Label className="px-1">Title</Label>
            <Input 
              value={formData.title || ""} 
              disabled={isAssigneeOnly}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })} 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Status</Label>
              <Select 
                value={formData.status} 
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
                value={formData.priority} 
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

                  {members.filter(m => m.user_id !== user?.id).map(m => (
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
