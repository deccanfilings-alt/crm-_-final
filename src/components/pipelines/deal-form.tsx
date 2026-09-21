"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
  Search,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setContactSearch("");
    setContactDropdownOpen(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");

      if (deal.contact_id) {
        supabase
          .from("contacts")
          .select("*")
          .eq("id", deal.contact_id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setSelectedContact(data as Contact);
          });
      } else {
        setSelectedContact(null);
      }
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
      setSelectedContact(null);
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, stages, defaultCurrency, supabase]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounced search for 5,000+ contacts
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearchingContacts(true);

    const timer = setTimeout(async () => {
      let query = supabase
        .from("contacts")
        .select("id, name, phone, email, avatar_url, company")
        .order("name", { ascending: true })
        .limit(50);

      const term = contactSearch.trim();
      if (term) {
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,company.ilike.%${term}%`);
      }

      const { data, error } = await query;
      if (!cancelled) {
        if (!error && data) {
          setContacts(data as Contact[]);
        }
        setSearchingContacts(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, contactSearch, supabase]);

  // Load profiles once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data }) => {
        if (!cancelled && data) {
          setProfiles(data as Profile[]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error("Title, contact, and stage are required");
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error("Failed to save deal");
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error("Not signed in");
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error("Your profile is not linked to an account.");
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" });
      if (error) {
        toast.error("Failed to create deal");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? "Deal updated" : "Deal created");
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error("Failed to update deal status");
      return;
    }
    toast.success(
      status === "won" ? "Marked as won" : status === "lost" ? "Marked as lost" : "Deal reopened",
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error("Failed to delete deal");
      return;
    }
    toast.success("Deal deleted");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? "Edit Deal" : "New Deal"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Deal title"
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Contact *</Label>
              <Popover open={contactDropdownOpen} onOpenChange={setContactDropdownOpen}>
                <PopoverTrigger
                  className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted px-2.5 text-left text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary cursor-pointer hover:bg-muted/80 transition-colors"
                >
                  {selectedContact ? (
                    <span className="truncate flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                        {(selectedContact.name || selectedContact.phone || "C").charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate font-medium">{selectedContact.name || selectedContact.phone}</span>
                      {selectedContact.name && selectedContact.phone && (
                        <span className="truncate text-xs text-muted-foreground">({selectedContact.phone})</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs sm:text-sm">Select a contact (search 5,000+)...</span>
                  )}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </PopoverTrigger>

                <PopoverContent align="start" className="w-[320px] sm:w-[380px] p-2 border-border bg-popover text-popover-foreground shadow-xl">
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Search by name, phone or company..."
                      className="h-8 pl-8 pr-7 text-xs bg-muted border-border"
                      autoFocus
                    />
                    {contactSearch && (
                      <button
                        type="button"
                        onClick={() => setContactSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  <ScrollArea className="max-h-56">
                    {searchingContacts ? (
                      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary" />
                        Searching contacts...
                      </div>
                    ) : contacts.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        No contacts found matching &quot;{contactSearch}&quot;
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {contacts.map((c) => {
                          const isSelected = c.id === contactId;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setContactId(c.id);
                                setSelectedContact(c);
                                setContactDropdownOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted cursor-pointer",
                                isSelected && "bg-primary/10 text-primary font-medium"
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-foreground">
                                  {c.name || c.phone}
                                </div>
                                {c.name && c.phone && (
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {c.phone} {c.company ? `• ${c.company}` : ""}
                                  </div>
                                )}
                              </div>
                              {isSelected && <Check className="ml-2 h-3.5 w-3.5 text-primary shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  Link to Conversation
                </Link>
              )}
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Value</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-border bg-muted pl-7 text-foreground"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Currency</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Expected Close Date</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Stage</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Assigned To</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Mark as Won
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        Mark as Lost
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    Reopen deal
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Saving..." : deal ? "Save Changes" : "Create Deal"}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">Delete this deal?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Deal
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
