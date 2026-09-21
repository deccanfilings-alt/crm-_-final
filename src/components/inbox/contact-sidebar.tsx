"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag, Conversation, Profile, Pipeline, PipelineStage } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  UserPlus,
  ChevronDown,
  CheckSquare,
  CheckCircle2,
  Circle,
  Loader2,
  ArrowUpRight,
  Pencil,
} from "lucide-react";
import { CURRENCIES } from "@/lib/currency";
import { InstagramIcon as Instagram, FacebookIcon as Facebook } from "@/components/icons/social-icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { toast } from "sonner";

interface ContactSidebarProps {
  contact: Contact | null;
  conversation?: Conversation | null;
  onContactUpdate?: (updatedContact: Contact) => void;
}

interface ActionItem {
  id: string;
  title: string;
  status: string;
  target_date: string;
}

export function ContactSidebar({ contact, conversation, onContactUpdate }: ContactSidebarProps) {
  const { user, accountId, defaultCurrency } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Pipelines and stages state
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(false);

  // Quick Deal dialog state
  const [isDealDialogOpen, setIsDealDialogOpen] = useState(false);
  const [newDealTitle, setNewDealTitle] = useState("");
  const [newDealValue, setNewDealValue] = useState("");
  const [newDealCurrency, setNewDealCurrency] = useState("USD");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [dealAssignedTo, setDealAssignedTo] = useState("");
  const [newDealNotes, setNewDealNotes] = useState("");
  const [newDealExpectedClose, setNewDealExpectedClose] = useState("");
  const [creatingDeal, setCreatingDeal] = useState(false);

  // Quick Task state
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  // Quick Edit Contact state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const handleOpenEdit = () => {
    if (!contact) return;
    setEditName(contact.name || "");
    setEditCompany(contact.company || "");
    setEditEmail(contact.email || "");
    setIsEditDialogOpen(true);
  };

  const handleSaveContact = async () => {
    if (!contact) return;
    setSavingContact(true);
    try {
      const supabase = createClient();
      const updated = {
        name: editName.trim() || null,
        company: editCompany.trim() || null,
        email: editEmail.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("contacts")
        .update(updated)
        .eq("id", contact.id)
        .select()
        .single();
      if (error) throw error;
      toast.success("Contact updated successfully");
      setIsEditDialogOpen(false);
      if (data && onContactUpdate) {
        onContactUpdate(data as Contact);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update contact");
    } finally {
      setSavingContact(false);
    }
  };

  useEffect(() => {
    if (defaultCurrency) {
      setNewDealCurrency(defaultCurrency);
    }
  }, [defaultCurrency]);

  const loadPipelinesAndStages = useCallback(async () => {
    setLoadingPipelines(true);
    const supabase = createClient();

    try {
      let query = supabase.from("pipelines").select("*").order("created_at");
      if (accountId) {
        query = query.eq("account_id", accountId);
      }

      let { data: pList, error: pError } = await query;

      // Fallback: If account_id filter returned empty or error, fetch all visible via RLS
      if (pError || !pList || pList.length === 0) {
        const fallback = await supabase.from("pipelines").select("*").order("created_at");
        if (fallback.data && fallback.data.length > 0) {
          pList = fallback.data;
        }
      }

      if (pList && pList.length > 0) {
        setPipelines(pList);

        const pipelineIds = pList.map((p) => p.id);
        const { data: sList, error: sError } = await supabase
          .from("pipeline_stages")
          .select("*")
          .in("pipeline_id", pipelineIds)
          .order("position");

        if (sError) {
          console.error("Failed to load pipeline stages:", sError);
        } else if (sList) {
          setStages(sList);
        }

        // Auto-select first pipeline and its first stage if none selected
        setSelectedPipelineId((prev) => {
          const validPipe = prev && pList!.some((p) => p.id === prev) ? prev : pList![0].id;
          const matchingStages = (sList || []).filter((s) => s.pipeline_id === validPipe);
          setSelectedStageId((prevStage) =>
            prevStage && matchingStages.some((s) => s.id === prevStage)
              ? prevStage
              : matchingStages[0]?.id || ""
          );
          return validPipe;
        });
      }
    } catch (err) {
      console.error("Error loading pipelines/stages:", err);
    } finally {
      setLoadingPipelines(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadPipelinesAndStages();
  }, [loadPipelinesAndStages]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    const [dealsRes, actionItemsRes, notesRes, tagsRes, profilesRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*), pipeline:pipelines(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("action_items")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      accountId ? supabase.from("profiles").select("*").eq("account_id", accountId) : Promise.resolve({ data: [] }),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (actionItemsRes.data) setActionItems(actionItemsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    if (profilesRes.data) setProfiles(profilesRes.data);
  }, [contact, accountId]);

  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  // Realtime subscription for contact deals
  useEffect(() => {
    if (!contact?.id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`contact-deals-${contact.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `contact_id=eq.${contact.id}`,
        },
        () => {
          fetchContactData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contact?.id, fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim() || !accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: session?.user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleAssign = useCallback(async (userId: string | null) => {
    if (!conversation) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_agent_id: userId })
      .eq("id", conversation.id);
      
    if (error) {
      toast.error("Failed to update assignment");
    } else {
      toast.success(userId ? "Conversation assigned" : "Conversation unassigned");
    }
  }, [conversation]);

  const handleOpenDealDialog = useCallback(async () => {
    setIsDealDialogOpen(true);
    setNewDealCurrency(defaultCurrency || "USD");
    setNewDealTitle("");
    setNewDealValue("");
    setNewDealNotes("");
    setNewDealExpectedClose("");

    // Assignee mapping: conversation.assigned_agent_id is a profiles.user_id.
    // deals.assigned_to requires profiles.id!
    if (conversation?.assigned_agent_id) {
      const matchedProfile = profiles.find((p) => p.user_id === conversation.assigned_agent_id);
      setDealAssignedTo(matchedProfile ? matchedProfile.id : "");
    } else {
      setDealAssignedTo("");
    }

    // Immediately set active selections from in-memory pipelines/stages if present
    if (pipelines.length > 0) {
      const activePipe =
        selectedPipelineId && pipelines.some((p) => p.id === selectedPipelineId)
          ? selectedPipelineId
          : pipelines[0].id;
      setSelectedPipelineId(activePipe);

      const pipeStages = stages.filter((s) => s.pipeline_id === activePipe);
      if (pipeStages.length > 0) {
        if (!selectedStageId || !pipeStages.some((s) => s.id === selectedStageId)) {
          setSelectedStageId(pipeStages[0].id);
        }
      }
    }

    // Always fetch fresh pipelines and stages to ensure sync with pipelines page
    const supabase = createClient();
    try {
      let query = supabase.from("pipelines").select("*").order("created_at");
      if (accountId) query = query.eq("account_id", accountId);
      let { data: pList } = await query;
      if (!pList || pList.length === 0) {
        const fallback = await supabase.from("pipelines").select("*").order("created_at");
        pList = fallback.data || [];
      }
      if (pList && pList.length > 0) {
        setPipelines(pList);
        const { data: sList } = await supabase
          .from("pipeline_stages")
          .select("*")
          .in("pipeline_id", pList.map((p) => p.id))
          .order("position");
        if (sList) {
          setStages(sList);
        }

        const activePipe =
          selectedPipelineId && pList.some((p) => p.id === selectedPipelineId)
            ? selectedPipelineId
            : pList[0].id;
        setSelectedPipelineId(activePipe);

        const pipeStages = (sList || []).filter((s) => s.pipeline_id === activePipe);
        if (pipeStages.length > 0) {
          setSelectedStageId(pipeStages[0].id);
        } else {
          setSelectedStageId("");
        }
      }
    } catch (err) {
      console.error("Error loading pipelines on dialog open:", err);
    }
  }, [
    pipelines,
    stages,
    selectedPipelineId,
    selectedStageId,
    defaultCurrency,
    conversation?.assigned_agent_id,
    profiles,
    accountId,
  ]);

  const handlePipelineChange = (pipeId: string) => {
    setSelectedPipelineId(pipeId);
    const pipeStages = stages.filter((s) => s.pipeline_id === pipeId);
    if (pipeStages.length > 0) {
      setSelectedStageId(pipeStages[0].id);
    } else {
      setSelectedStageId("");
    }
  };

  const handleCreateDeal = async () => {
    if (!contact) return;
    if (!newDealTitle.trim()) {
      toast.error("Please enter a deal title");
      return;
    }

    const targetAccountId =
      accountId ||
      contact.account_id ||
      pipelines.find((p) => p.id === selectedPipelineId)?.account_id;

    if (!targetAccountId) {
      toast.error("No active account found");
      return;
    }
    if (!selectedPipelineId) {
      toast.error("Please select a pipeline");
      return;
    }
    if (!selectedStageId) {
      toast.error("Please select a pipeline stage");
      return;
    }

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const currentUserId = user?.id || session?.user?.id;

    if (!currentUserId) {
      toast.error("You must be logged in to create a deal");
      return;
    }

    setCreatingDeal(true);
    try {
      const dealPayload = {
        user_id: currentUserId,
        account_id: targetAccountId,
        pipeline_id: selectedPipelineId,
        stage_id: selectedStageId,
        contact_id: contact.id,
        conversation_id: conversation?.id || null,
        title: newDealTitle.trim(),
        value: newDealValue ? parseFloat(newDealValue) : 0,
        currency: newDealCurrency || defaultCurrency || "USD",
        assigned_to: dealAssignedTo || null,
        status: "open" as const,
        notes: newDealNotes.trim() || null,
        expected_close_date: newDealExpectedClose || null,
        broadcast_id: (contact as any).last_broadcast_id || null,
      };

      const { data, error } = await supabase
        .from("deals")
        .insert(dealPayload)
        .select("*, stage:pipeline_stages(*), pipeline:pipelines(*)")
        .single();

      if (error) {
        console.error("Failed to create deal:", error);
        toast.error(error.message || "Failed to create deal");
        return;
      }

      if (data) {
        const enrichedDeal: Deal = {
          ...(data as Deal),
          stage: data.stage || stages.find((s) => s.id === selectedStageId),
          pipeline: data.pipeline || pipelines.find((p) => p.id === selectedPipelineId),
        };

        setDeals((prev) => [enrichedDeal, ...prev]);
        setNewDealTitle("");
        setNewDealValue("");
        setNewDealNotes("");
        setNewDealExpectedClose("");
        setIsDealDialogOpen(false);
        toast.success("Deal created and synced to pipeline");
      }
    } catch (err: any) {
      console.error("Unexpected error creating deal:", err);
      toast.error(err?.message || "Failed to create deal");
    } finally {
      setCreatingDeal(false);
    }
  };

  const handleCreateTask = async () => {
    if (!contact || !newTaskTitle.trim()) return;
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          contact_id: contact.id,
          target_date: format(new Date(), "yyyy-MM-dd"),
          status: "todo",
        }),
      });
      if (!res.ok) throw new Error("Failed to add task");
      const created = await res.json();
      setActionItems((prev) => [created, ...prev]);
      setNewTaskTitle("");
      setIsTaskDialogOpen(false);
      toast.success("Action item created");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleToggleTaskStatus = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === "completed" ? "todo" : "completed";
    setActionItems((prev) =>
      prev.map((item) => (item.id === taskId ? { ...item, status: newStatus } : item))
    );
    try {
      await fetch(`/api/action-items/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      setActionItems((prev) =>
        prev.map((item) => (item.id === taskId ? { ...item, status: currentStatus } : item))
      );
    }
  };

  if (!contact) {
    return (
      <div className="flex h-full w-72 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || (contact.instagram_username ? `@${contact.instagram_username}` : "Unknown Contact");
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="mt-3 flex items-center justify-center gap-1.5 max-w-[220px]">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {displayName}
              </h3>
              <button
                type="button"
                onClick={handleOpenEdit}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Edit Contact Name & Details"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone & Social Handles */}
          <div className="mt-4 space-y-2">
            {contact.phone && (
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left truncate">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            )}

            {contact.instagram_username && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground bg-pink-500/5 border border-pink-500/15">
                <Instagram className="h-4 w-4 text-pink-500 shrink-0" />
                <span className="truncate font-medium text-pink-600 dark:text-pink-400">@{contact.instagram_username}</span>
              </div>
            )}

            {contact.facebook_psid && !contact.instagram_username && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground bg-blue-500/5 border border-blue-500/15">
                <Facebook className="h-4 w-4 text-[#1877F2] shrink-0" />
                <span className="truncate text-xs font-mono">ID: {contact.facebook_psid.slice(-6)}</span>
              </div>
            )}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          <div className="my-4 border-t border-border" />

          {/* Assignment */}
          {conversation && (
            <div>
              <div className="flex items-center justify-between px-1 mb-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <UserPlus className="h-3 w-3" />
                  Assigned To
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" className="w-full justify-between h-9 px-3 font-normal" />}>
                  {conversation.assigned_agent_id 
                    ? profiles.find(p => p.user_id === conversation.assigned_agent_id)?.full_name || "Unknown Agent" 
                    : <span className="text-muted-foreground">Unassigned</span>}
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onClick={() => handleAssign(null)} className="text-muted-foreground">
                    Unassigned
                  </DropdownMenuItem>
                  {profiles.map(p => (
                    <DropdownMenuItem key={p.user_id} onClick={() => handleAssign(p.user_id)}>
                      {p.full_name || p.email}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <div className="my-4 border-t border-border" />
            </div>
          )}

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No tags</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Active Deals with Quick Create */}
          <div>
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <div
                className="flex items-center gap-2 cursor-pointer hover:text-foreground transition-colors"
                onClick={handleOpenDealDialog}
                title="Create Deal"
              >
                <DollarSign className="h-3 w-3" />
                Active Deals
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={handleOpenDealDialog}
                title="Create Deal"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <button
                  type="button"
                  onClick={handleOpenDealDialog}
                  className="w-full rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                >
                  + Add a deal for this contact
                </button>
              ) : (
                deals.map((deal) => {
                  const pipe = deal.pipeline || pipelines.find((p) => p.id === deal.pipeline_id);
                  const st = deal.stage || stages.find((s) => s.id === deal.stage_id);
                  return (
                    <div
                      key={deal.id}
                      className="group rounded-lg bg-muted px-3 py-2 transition-colors hover:bg-muted/80"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <Link
                          href={`/pipelines?pipeline=${deal.pipeline_id}`}
                          className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors flex-1 flex items-center gap-1"
                          title="Open in Pipeline"
                        >
                          <span className="truncate">{deal.title}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                        </Link>
                        <span className="text-xs font-semibold text-foreground shrink-0">
                          {deal.currency ?? "$"}
                          {Number(deal.value || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground gap-2">
                        <Link
                          href={`/pipelines?pipeline=${deal.pipeline_id}`}
                          className="text-[10px] text-muted-foreground truncate max-w-[110px] hover:text-primary transition-colors"
                        >
                          {pipe?.name || "Pipeline"}
                        </Link>
                        {st && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
                            style={{
                              backgroundColor: `${st.color}20`,
                              color: st.color,
                            }}
                          >
                            {st.name}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Action Items with Quick Create */}
          <div>
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-3 w-3" />
                Action Items
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => setIsTaskDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 space-y-1.5">
              {actionItems.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No tasks linked</p>
              ) : (
                actionItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs"
                  >
                    <button
                      onClick={() => handleToggleTaskStatus(item.id, item.status)}
                      className="text-muted-foreground hover:text-primary shrink-0"
                    >
                      {item.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </button>
                    <span
                      className={`flex-1 truncate ${
                        item.status === "completed" ? "line-through text-muted-foreground" : "text-foreground font-medium"
                      }`}
                    >
                      {item.title}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Quick Create Deal Dialog */}
      <Dialog open={isDealDialogOpen} onOpenChange={setIsDealDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              Create Deal for {displayName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">
                Deal Title <span className="text-destructive">*</span>
              </Label>
              <Input
                autoFocus
                placeholder="e.g. Enterprise License"
                value={newDealTitle}
                onChange={(e) => setNewDealTitle(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Pipeline & Stage Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Pipeline <span className="text-destructive">*</span>
                </Label>
                <select
                  value={selectedPipelineId}
                  onChange={(e) => handlePipelineChange(e.target.value)}
                  disabled={loadingPipelines && pipelines.length === 0}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                >
                  {pipelines.length === 0 ? (
                    <option value="">{loadingPipelines ? "Loading pipelines..." : "No pipeline available"}</option>
                  ) : (
                    pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Stage <span className="text-destructive">*</span>
                </Label>
                <select
                  value={selectedStageId}
                  onChange={(e) => setSelectedStageId(e.target.value)}
                  disabled={stages.filter((s) => s.pipeline_id === selectedPipelineId).length === 0}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                >
                  {stages.filter((s) => s.pipeline_id === selectedPipelineId).length === 0 ? (
                    <option value="">No stages found</option>
                  ) : (
                    stages
                      .filter((s) => s.pipeline_id === selectedPipelineId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))
                  )}
                </select>
              </div>
            </div>

            {/* Value & Currency */}
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Estimated Value</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={newDealValue}
                    onChange={(e) => setNewDealValue(e.target.value)}
                    className="h-9 pl-8 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Currency</Label>
                <select
                  value={newDealCurrency}
                  onChange={(e) => setNewDealCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Assignment & Expected Close */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Assignee</Label>
                <select
                  value={dealAssignedTo}
                  onChange={(e) => setDealAssignedTo(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">Unassigned</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">Expected Close</Label>
                <Input
                  type="date"
                  value={newDealExpectedClose}
                  onChange={(e) => setNewDealExpectedClose(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Deal Notes (Optional)</Label>
              <textarea
                rows={2}
                placeholder="Details about requirements, budget, etc."
                value={newDealNotes}
                onChange={(e) => setNewDealNotes(e.target.value)}
                className="w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsDealDialogOpen(false)}
              disabled={creatingDeal}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateDeal}
              disabled={!newDealTitle.trim() || !selectedPipelineId || !selectedStageId || creatingDeal}
              className="gap-1.5"
            >
              {creatingDeal && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Create Task Dialog */}
      <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Action Item for {displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label>Task Title</Label>
              <Input
                autoFocus
                placeholder="e.g. Follow up with quotation"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTaskDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateTask} disabled={!newTaskTitle.trim()}>Create Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Edit Contact Details Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Contact Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Jashwanth"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Input
                placeholder="Company name"
                value={editCompany}
                onChange={(e) => setEditCompany(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveContact} disabled={savingContact} className="gap-1.5">
              {savingContact && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
