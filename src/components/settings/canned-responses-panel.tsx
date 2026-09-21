"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Edit2, Loader2, MessageSquareDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import type { CannedResponse } from "@/types";

export function CannedResponsesPanel() {
  const canManageCanned = useCan("manage-canned-responses");
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/canned-responses")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setResponses(data);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!shortcut.trim() || !content.trim()) {
      toast.error("Shortcut and content are required.");
      return;
    }

    setSaving(true);
    try {
      const formattedShortcut = shortcut.startsWith("/") ? shortcut : `/${shortcut}`;
      const payload = { shortcut: formattedShortcut, content };

      const res = await fetch(
        editingId ? `/api/canned-responses/${editingId}` : "/api/canned-responses",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (editingId) {
        setResponses((prev) => prev.map((r) => (r.id === editingId ? data : r)));
        toast.success("Updated canned response");
      } else {
        setResponses((prev) => [...prev, data].sort((a, b) => a.shortcut.localeCompare(b.shortcut)));
        toast.success("Created canned response");
      }

      setEditingId(null);
      setShortcut("");
      setContent("");
    } catch (err: any) {
      toast.error(err.message || "Failed to save response");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this response?")) return;
    try {
      const res = await fetch(`/api/canned-responses/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setResponses((prev) => prev.filter((r) => r.id !== id));
      toast.success("Response deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete response");
    }
  };

  const handleEdit = (r: CannedResponse) => {
    setEditingId(r.id);
    setShortcut(r.shortcut);
    setContent(r.content);
  };

  const handleCancel = () => {
    setEditingId(null);
    setShortcut("");
    setContent("");
  };

  if (!canManageCanned) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center">
        <MessageSquareDashed className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">You do not have permission to manage canned responses.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Canned Responses</h2>
        <p className="text-sm text-muted-foreground">
          Create shortcuts for frequently sent messages. Agents can type the shortcut in the message composer to instantly insert the content.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-medium">{editingId ? "Edit Response" : "New Response"}</h3>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div>
            <label className="mb-1 block text-sm font-medium">Shortcut</label>
            <Input
              placeholder="/hours"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Content</label>
            <Textarea
              placeholder="Our business hours are Monday to Friday, 9AM to 5PM."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {(editingId || shortcut || content) && (
            <Button variant="outline" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || !shortcut || !content}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editingId ? "Update" : "Create"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : responses.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">No canned responses yet.</p>
          </div>
        ) : (
          responses.map((r) => (
            <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border p-4 bg-card transition-colors hover:bg-muted/50">
              <div className="flex-1 space-y-1">
                <p className="font-mono text-sm font-semibold text-primary">{r.shortcut}</p>
                <p className="text-sm text-muted-foreground break-words line-clamp-2">{r.content}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}>
                  <Edit2 className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                  <Trash2 className="h-4 w-4 text-red-500/70 hover:text-red-500" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
