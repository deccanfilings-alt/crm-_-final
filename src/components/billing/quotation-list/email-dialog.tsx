"use client";

// "Send via Email": To / CC / Subject / Message, prefilled. The client
// gets a button to view, save as PDF and accept the quotation online.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  /** The document (quotation or invoice) — id + its number. */
  quotation: { id: string; quote_number: string } | null;
  kind?: "quotation" | "invoice";
  onOpenChange: (o: boolean) => void;
  onSent: () => void;
}

interface Defaults {
  configured: boolean;
  from: string | null;
  to: string;
  subject: string;
  message: string;
}

export function EmailDialog({ quotation, kind = "quotation", onOpenChange, onSent }: Props) {
  const base = kind === "invoice" ? "/api/billing/invoices" : "/api/billing/quotations";
  return (
    <Dialog open={!!quotation} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {quotation && <EmailForm key={quotation.id} base={base} quotation={quotation} onClose={() => onOpenChange(false)} onSent={onSent} />}
      </DialogContent>
    </Dialog>
  );
}

function EmailForm({ base, quotation, onClose, onSent }: { base: string; quotation: { id: string; quote_number: string }; onClose: () => void; onSent: () => void }) {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/${quotation.id}/email`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error ?? "Could not load");
          return;
        }
        setDefaults(json);
        setTo(json.to ?? "");
        setSubject(json.subject ?? "");
        setMessage(json.message ?? "");
      } catch {
        if (!cancelled) setLoadError("Network error — please try again");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quotation.id, base]);

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch(`${base}/${quotation.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc, subject, message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Email not sent");
        return;
      }
      toast.success(`${quotation.quote_number} emailed to ${(json.to as string[]).join(", ")}`);
      onSent();
      onClose();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4" /> Send {quotation.quote_number} via Email
        </DialogTitle>
        <DialogDescription>
          {defaults?.from ? `From ${defaults.from}. ` : ""}The client gets a button to view and save it as PDF.
        </DialogDescription>
      </DialogHeader>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {!defaults && !loadError && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" />}

      {defaults && !defaults.configured && (
        <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Email isn&apos;t set up yet. Add <code className="font-mono text-xs">SMTP_USER</code> and{" "}
            <code className="font-mono text-xs">SMTP_PASS</code> (a Gmail App Password) to the server&apos;s environment variables,
            then restart the app.
          </span>
        </div>
      )}

      {defaults && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="em-to">To *</Label>
            <Input id="em-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em-cc">CC</Label>
            <Input id="em-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Separate several with commas" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em-subject">Subject *</Label>
            <Input id="em-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em-msg">Message *</Label>
            <Textarea id="em-msg" rows={7} value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button onClick={send} disabled={sending || !defaults?.configured || !to.trim() || !subject.trim() || !message.trim()}>
          {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}
          Send Email
        </Button>
      </DialogFooter>
    </>
  );
}
