"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GitBranch,
  Plus,
  ChevronDown,
  Settings,
  Loader2,
  Pin,
  PinOff,
} from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { usePipelinePins } from "@/hooks/use-pipeline-pins";
import { pickDefaultPipeline, splitPinnedPipelines } from "@/lib/pipelines/pins";
import { cn } from "@/lib/utils";
import { GatedButton } from "@/components/ui/gated-button";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
];

export default function PipelinesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PipelinesPageInner />
    </Suspense>
  );
}

function PipelinesPageInner() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const queryPipelineId = searchParams.get("pipeline");
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  // Personal pins. Until the user picks a pipeline themselves, the page
  // opens on their first pinned pipeline once pins have loaded.
  const pins = usePipelinePins();
  const autoPick = useRef(true);
  const selectPipeline = useCallback((id: string) => {
    autoPick.current = false;
    setSelectedPipelineId(id);
  }, []);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Sales Pipeline" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) => {
          if (queryPipelineId && list.some((p) => p.id === queryPipelineId)) {
            return queryPipelineId;
          }
          return prev && list.some((p) => p.id === prev) ? prev : list[0].id;
        });
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline, queryPipelineId]);

  // Once pins arrive, open the first pinned pipeline, unless the URL
  // names one or the user has already chosen.
  useEffect(() => {
    if (!pins.loaded || !autoPick.current || pipelines.length === 0) return;
    autoPick.current = false;
    if (queryPipelineId) return;
    const next = pickDefaultPipeline(pipelines, pins.pinnedIds);
    // Runs once (guarded by autoPick) after pins load asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next) setSelectedPipelineId(next);
  }, [pins.loaded, pins.pinnedIds, pipelines, queryPipelineId]);

  // Synchronize when queryPipelineId in the URL changes
  useEffect(() => {
    if (queryPipelineId && pipelines.some((p) => p.id === queryPipelineId)) {
      setSelectedPipelineId(queryPipelineId);
    }
  }, [queryPipelineId, pipelines]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // Realtime subscription: sync deals when created or updated anywhere (e.g. contact sidebar)
  useEffect(() => {
    if (!selectedPipelineId) return;

    const channel = supabase
      .channel(`pipeline-deals-sync-${selectedPipelineId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `pipeline_id=eq.${selectedPipelineId}`,
        },
        () => {
          refreshDeals();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedPipelineId, supabase, refreshDeals]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error("Failed to move deal");
        refreshDeals();
      }
    },
    [supabase, refreshDeals],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error("Your profile is not linked to an account.");
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error("Failed to create pipeline");
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    selectPipeline(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success("Pipeline created");
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const { pinned: pinnedPipelines, others: otherPipelines } = splitPinnedPipelines(
    pipelines,
    pins.pinnedIds,
  );
  const selectedIsPinned = !!selectedPipeline && pins.isPinned(selectedPipeline.id);

  const renderPipelineItem = (p: Pipeline) => {
    const pinned = pins.isPinned(p.id);
    return (
      <DropdownMenuItem
        key={p.id}
        onClick={() => selectPipeline(p.id)}
        className={cn(
          "flex items-center justify-between gap-2",
          p.id === selectedPipelineId ? "text-primary" : "text-popover-foreground",
        )}
      >
        <span className="flex min-w-0 items-center">
          <GitBranch className="mr-2 h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{p.name}</span>
        </span>
        {pins.available && (
          <button
            type="button"
            onClick={(e) => {
              // Pin without selecting the pipeline or closing the menu.
              e.preventDefault();
              e.stopPropagation();
              void pins.togglePin(p.id);
            }}
            title={pinned ? "Unpin" : "Pin to top"}
            aria-label={pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
            aria-pressed={pinned}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pinned ? "text-primary" : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
          </button>
        )}
      </DropdownMenuItem>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? "Select Pipeline"}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  No pipelines yet
                </DropdownMenuItem>
              )}
              {pinnedPipelines.length > 0 && (
                <>
                  <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Pinned
                  </div>
                  {pinnedPipelines.map(renderPipelineItem)}
                  {otherPipelines.length > 0 && (
                    <>
                      <DropdownMenuSeparator className="bg-border" />
                      <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        All pipelines
                      </div>
                    </>
                  )}
                </>
              )}
              {otherPipelines.map(renderPipelineItem)}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Manage Pipelines
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Pin / unpin the pipeline being viewed */}
          {pins.available && selectedPipeline && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void pins.togglePin(selectedPipeline.id)}
              aria-pressed={selectedIsPinned}
              title={selectedIsPinned ? "Unpin this pipeline" : "Pin this pipeline for quick access"}
              className={cn(
                "border-border bg-card",
                selectedIsPinned
                  ? "text-primary hover:bg-muted"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {selectedIsPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {selectedIsPinned ? "Unpin" : "Pin"}
              </span>
            </Button>
          )}

          {/* Quick switch between pinned pipelines */}
          {pinnedPipelines.length > 0 && (
            <nav
              aria-label="Pinned pipelines"
              className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto"
            >
              {pinnedPipelines.map((p) => {
                const active = p.id === selectedPipelineId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPipeline(p.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex max-w-[12rem] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Pin className="h-3 w-3 shrink-0 fill-current" />
                    <span className="truncate">{p.name}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Pipeline
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Deal
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            No pipelines yet
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a pipeline to start tracking deals
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Create Pipeline
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />
          <PipelineBoard
            stages={stages}
            deals={deals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">New Pipeline</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">Pipeline Name</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="e.g., Enterprise Sales"
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Default stages (New Lead → Won) will be created automatically.
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? "Creating..." : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
