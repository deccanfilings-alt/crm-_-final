"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { format, startOfWeek, startOfMonth } from "date-fns";
import {
  CheckCircle2,
  Trophy,
  Send,
  CheckCheck,
  IndianRupee,
  Plus,
  Trash2,
  Target,
  Sparkles,
  ChevronRight,
  TrendingUp,
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
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface KpiTargetProgress {
  target_id: string;
  user_id: string;
  metric:
    | "tasks_completed_on_time"
    | "deals_won"
    | "quotes_sent"
    | "quotes_accepted"
    | "amount_collected";
  period: "week" | "month";
  period_start: string;
  target_value: number;
  actual_value: number;
  percentage: number;
  created_by?: string;
  user?: {
    user_id: string;
    full_name: string;
    avatar_url?: string;
    account_role?: string;
    team?: string;
  };
}

const METRIC_CONFIG = {
  tasks_completed_on_time: {
    label: "On-Time Tasks",
    icon: CheckCircle2,
    color: "emerald",
    format: (v: number) => Math.round(v).toLocaleString("en-IN"),
    unit: "tasks",
    description: "Completed on or before due date",
  },
  deals_won: {
    label: "Deals Won",
    icon: Trophy,
    color: "amber",
    format: (v: number) => Math.round(v).toLocaleString("en-IN"),
    unit: "deals",
    description: "Deals marked as Won",
  },
  quotes_sent: {
    label: "Quotes Sent",
    icon: Send,
    color: "blue",
    format: (v: number) => Math.round(v).toLocaleString("en-IN"),
    unit: "quotes",
    description: "Quotations sent to clients",
  },
  quotes_accepted: {
    label: "Quotes Accepted",
    icon: CheckCheck,
    color: "purple",
    format: (v: number) => Math.round(v).toLocaleString("en-IN"),
    unit: "quotes",
    description: "Client accepted proposals",
  },
  amount_collected: {
    label: "Amount Collected",
    icon: IndianRupee,
    color: "teal",
    format: (v: number) =>
      "₹" + Math.round(v).toLocaleString("en-IN"),
    unit: "",
    description: "Total accepted quote revenue",
  },
} as const;

interface KpiProgressCardsProps {
  userId?: string; // If specified, scope to this user; otherwise scope to logged in user or team
  isTeamView?: boolean;
}

export function KpiProgressCards({
  userId: propUserId,
  isTeamView = false,
}: KpiProgressCardsProps) {
  const { user, profile } = useAuth();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [targets, setTargets] = useState<KpiTargetProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);

  // Dialog form state
  const [formUserId, setFormUserId] = useState<string>("");
  const [formMetric, setFormMetric] = useState<string>("tasks_completed_on_time");
  const [formValue, setFormValue] = useState<string>("10");
  const [saving, setSaving] = useState(false);

  const effectiveUserId = propUserId || user?.id;
  const isAdminOrOwner =
    profile?.account_role === "admin" || profile?.account_role === "owner";

  const periodStart = useMemo(() => {
    const now = new Date();
    if (period === "month") {
      return format(startOfMonth(now), "yyyy-MM-dd");
    }
    return format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
  }, [period]);

  const loadTargets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        period,
        period_start: periodStart,
      });
      if (effectiveUserId && !isTeamView) {
        params.set("user_id", effectiveUserId);
      }
      const res = await fetch(`/api/kpi-targets?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load KPI targets");
      const data = await res.json();
      setTargets(Array.isArray(data) ? data : []);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to load targets");
    } finally {
      setLoading(false);
    }
  }, [user, period, periodStart, effectiveUserId, isTeamView]);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  // Load team members for target assignment dropdown
  useEffect(() => {
    if (!isAdminOrOwner) return;
    fetch("/api/account/members")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          // Exclude owner if current user is not owner
          const filtered =
            profile?.account_role === "owner"
              ? data
              : data.filter((m: any) => m.account_role !== "owner");
          setMembers(filtered);
          if (filtered.length > 0 && !formUserId) {
            setFormUserId(effectiveUserId || filtered[0].user_id);
          }
        }
      })
      .catch((e) => console.error("Failed to load members:", e));
  }, [isAdminOrOwner, profile?.account_role, effectiveUserId]);

  const handleSaveTarget = async () => {
    const num = Number(formValue);
    if (isNaN(num) || num <= 0) {
      toast.error("Please enter a target value greater than 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/kpi-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: formUserId || effectiveUserId,
          metric: formMetric,
          period,
          period_start: periodStart,
          target_value: num,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to set target");
      }
      toast.success("KPI Target set successfully!");
      setModalOpen(false);
      loadTargets();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTarget = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/kpi-targets/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove target");
      toast.success("Target removed");
      setTargets((prev) => prev.filter((t) => t.target_id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Group targets by user in team view or single list in personal view
  const myTargets = useMemo(() => {
    if (isTeamView) return targets;
    return targets.filter((t) => !effectiveUserId || t.user_id === effectiveUserId);
  }, [targets, effectiveUserId, isTeamView]);

  return (
    <div className="space-y-3">
      {/* Header with period toggle and action */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight">
            {isTeamView ? "Team Performance & KPI Targets" : "My Measurable Targets"}
          </h2>
          <div className="inline-flex items-center rounded-lg bg-muted p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setPeriod("week")}
              className={cn(
                "rounded-md px-2.5 py-1 transition-all",
                period === "week"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => setPeriod("month")}
              className={cn(
                "rounded-md px-2.5 py-1 transition-all",
                period === "month"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              This Month
            </button>
          </div>
        </div>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-medium" />}>
            <Plus className="h-3.5 w-3.5" /> Set Target
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" />
                Set Measurable KPI Target
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {isAdminOrOwner && members.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Team Member</Label>
                  <Select value={formUserId} onValueChange={(val) => setFormUserId(val || "")}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select member" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m: any) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email} ({m.account_role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">KPI Metric</Label>
                <Select value={formMetric} onValueChange={(val) => val && setFormMetric(val)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METRIC_CONFIG).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>
                        {cfg.label} ({cfg.description})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  Target Goal ({period === "week" ? "Weekly" : "Monthly"})
                </Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  className="h-9"
                  placeholder="e.g. 20"
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
                onClick={handleSaveTarget}
              >
                {saving ? "Saving..." : "Save Target"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Target cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-border/50 bg-card/40 animate-pulse p-4"
            />
          ))}
        </div>
      ) : myTargets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-5 text-center bg-card/20">
          <Target className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs font-medium text-foreground">
            No KPI targets configured for this {period}.
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Set numeric targets for on-time tasks, deals won, or revenue to track live progress.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalOpen(true)}
            className="mt-3 h-8 text-xs gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Add Your First Target
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {myTargets.map((item) => {
            const config = METRIC_CONFIG[item.metric] || METRIC_CONFIG.tasks_completed_on_time;
            const Icon = config.icon;
            const pct = Math.min(Math.max(item.percentage || 0, 0), 100);
            const isCompleted = (item.percentage || 0) >= 100;
            const isOnTrack = (item.percentage || 0) >= 70;
            const isInProgress = (item.percentage || 0) >= 40;

            let progressColor = "bg-rose-500";
            let statusBadge = "Needs Attention";
            let badgeVariant = "border-rose-500/30 text-rose-500 bg-rose-500/10";

            if (isCompleted) {
              progressColor = "bg-emerald-500";
              statusBadge = "Achieved 🎉";
              badgeVariant = "border-emerald-500/30 text-emerald-500 bg-emerald-500/10";
            } else if (isOnTrack) {
              progressColor = "bg-primary";
              statusBadge = "On Track";
              badgeVariant = "border-primary/30 text-primary bg-primary/10";
            } else if (isInProgress) {
              progressColor = "bg-amber-500";
              statusBadge = "In Progress";
              badgeVariant = "border-amber-500/30 text-amber-500 bg-amber-500/10";
            }

            return (
              <div
                key={item.target_id}
                className="group relative rounded-xl border border-border/70 bg-card p-3.5 transition-all hover:border-primary/40 hover:shadow-sm"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-1.5 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-lg bg-muted text-foreground/80 shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate leading-tight">
                        {config.label}
                      </p>
                      {item.user && isTeamView && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {item.user.full_name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                        badgeVariant
                      )}
                    >
                      {statusBadge}
                    </span>
                    {(isAdminOrOwner || item.user_id === user?.id) && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteTarget(item.target_id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/60 hover:text-destructive transition-all rounded"
                        title="Delete target"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Score row */}
                <div className="flex items-baseline justify-between mt-1 mb-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold tracking-tight">
                      {config.format(item.actual_value || 0)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      / {config.format(item.target_value)} {config.unit}
                    </span>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-foreground/80">
                    {Math.round(item.percentage || 0)}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      progressColor
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
