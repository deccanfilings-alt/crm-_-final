"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WamSettings } from "@/lib/wam/report";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: WamSettings;
  onSaved: (s: WamSettings) => void;
}

/** One attendance rule for the whole team. Owners / Team Leaders only. */
export function AttendanceSettingsDialog({ open, onOpenChange, settings, onSaved }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remount the form on each open so it starts from current settings. */}
        {open && <SettingsForm settings={settings} onSaved={onSaved} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ settings, onSaved, onClose }: { settings: WamSettings; onSaved: (s: WamSettings) => void; onClose: () => void }) {
  const [start, setStart] = useState(settings.workday_start);
  const [grace, setGrace] = useState(String(settings.grace_minutes));
  const [hours, setHours] = useState(String(settings.min_daily_minutes / 60));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const body = {
      workday_start: start,
      grace_minutes: Math.round(Number(grace)),
      min_daily_minutes: Math.round(Number(hours) * 60),
    };
    setSaving(true);
    try {
      const res = await fetch("/api/wam/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      toast.success("Attendance rule saved");
      onSaved(json.settings);
      onClose();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Attendance rule</DialogTitle>
        <DialogDescription>Applies to everyone. Times are India time.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-1.5">
          <Label htmlFor="wam-start">Office start time</Label>
          <Input id="wam-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="wam-grace">Grace period (minutes)</Label>
          <Input id="wam-grace" type="number" min={0} max={240} value={grace} onChange={(e) => setGrace(e.target.value)} />
          <p className="text-xs text-muted-foreground">Clocking in after start time + grace is marked Late.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="wam-hours">Minimum hours per day</Label>
          <Input id="wam-hours" type="number" min={0} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
          <p className="text-xs text-muted-foreground">Finished days below this (breaks excluded) are marked Short.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
