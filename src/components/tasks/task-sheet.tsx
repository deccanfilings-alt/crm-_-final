import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X, Trash2, User2 } from "lucide-react";
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
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [newSubtask, setNewSubtask] = useState("");

  useEffect(() => {
    if (task) {
      setFormData({
        ...task,
        subtasks: task.subtasks || [],
      });
    }
  }, [task]);

  useEffect(() => {
    if (!open) return;
    
    // Fetch members, contacts, deals when sheet opens
    const fetchData = async () => {
      try {
        if (isOwner || isAdmin) {
          const membersRes = await fetch("/api/account/members");
          if (membersRes.ok) {
            const data = await membersRes.json();
            setMembers(data.members || []);
          }
        }
        
        // We can just use the Supabase client directly to fetch contacts and deals if API is missing,
        // but since we want to avoid large refactors, let's just use simple fetch requests or assume they exist.
        // For this demo, let's just provide the inputs for contact/deal IDs or simple selects if we had endpoints.
      } catch (e) {
        console.error(e);
      }
    };
    fetchData();
  }, [open, isOwner, isAdmin]);

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
      const res = await fetch(`/api/action-items/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to update task");
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

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      const res = await fetch(`/api/action-items/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete task");
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
          <SheetDescription>Update the details of your task.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label className="px-1">Title</Label>
            <Input 
              value={formData.title || ""} 
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
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="px-1">Priority</Label>
              <Select 
                value={formData.priority} 
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
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <Button variant="destructive" onClick={handleDelete}>Delete Task</Button>
          <div className="space-x-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
