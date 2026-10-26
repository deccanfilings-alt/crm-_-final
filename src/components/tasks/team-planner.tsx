"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  format, startOfWeek, startOfQuarter,
  addWeeks, subWeeks, addQuarters, subQuarters,
} from "date-fns";
import {
  ChevronLeft, ChevronRight, Target, Clock, Activity,
  CheckCircle2, Circle, ChevronDown, ChevronUp, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogTrigger, DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

interface ActionItem {
  id: string;
  title: string;
  status: string;
  estimated_hours: number | null;
  priority?: string;
}

interface UserTarget {
  id: string;
  user_id: string;
  created_by?: string | null;
  creator?: {
    full_name: string;
  } | null;
  period_type: "weekly" | "quarterly";
  period_start_date: string;
  title: string;
  description: string | null;
  status: "planned" | "in_progress" | "completed";
  action_items: ActionItem[];
  agent: {
    full_name: string;
    avatar_url: string;
  };
}

const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

export function TeamPlanner() {
  const { isOwner, isAdmin } = useAuth();
  const [periodType, setPeriodType] = useState<"weekly" | "quarterly">("weekly");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [targets, setTargets] = useState<UserTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set());

  // Add target dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [targetMemberId, setTargetMemberId] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [targetDescription, setTargetDescription] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  useEffect(() => {
    if (isOwner || isAdmin) {
      fetch("/api/account/members")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.members) setMembers(data.members);
        })
        .catch(() => null);
    }
  }, [isOwner, isAdmin]);

  const getPeriodStart = (date: Date, type: "weekly" | "quarterly") =>
    type === "weekly"
      ? startOfWeek(date, { weekStartsOn: 1 })
      : startOfQuarter(date);

  const periodStart = getPeriodStart(currentDate, periodType);

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    try {
      const dateStr = format(periodStart, "yyyy-MM-dd");
      const res = await fetch(
        `/api/user-targets?period_type=${periodType}&period_start_date=${dateStr}`
      );
      if (!res.ok) throw new Error("Failed to fetch team targets");
      const data: UserTarget[] = await res.json();
      setTargets(data);
      // Auto-expand all agents
      const agentIds = new Set(data.map((t) => t.user_id));
      setExpandedAgents(agentIds);
      setExpandedGoals(new Set(data.map((t) => t.id)));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [periodStart.toISOString(), periodType]);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  const handleAddTarget = async () => {
    if (!targetMemberId || !targetTitle.trim()) return;
    setSavingTarget(true);
    try {
      const dateStr = format(periodStart, "yyyy-MM-dd");
      const res = await fetch("/api/user-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetMemberId,
          period_type: periodType,
          period_start_date: dateStr,
          title: targetTitle.trim(),
          description: targetDescription.trim() || null,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Failed to create target");
      }

      toast.success("Target created for team member");
      setAddDialogOpen(false);
      setTargetTitle("");
      setTargetDescription("");
      await fetchTargets();
    } catch (err: any) {
      toast.error(err.message || "Failed to create target");
    } finally {
      setSavingTarget(false);
    }
  };

  const handleNext = () =>
    setCurrentDate((prev) =>
      periodType === "weekly" ? addWeeks(prev, 1) : addQuarters(prev, 1)
    );
  const handlePrev = () =>
    setCurrentDate((prev) =>
      periodType === "weekly" ? subWeeks(prev, 1) : subQuarters(prev, 1)
    );

  const toggleAgent = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGoal = (id: string) => {
    setExpandedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group targets by agent
  const groupedByAgent = useMemo(() => {
    const groups: Record<
      string,
      { agent: { full_name: string; avatar_url: string }; targets: UserTarget[] }
    > = {};
    for (const target of targets) {
      const id = target.user_id;
      if (!groups[id]) {
        groups[id] = { agent: target.agent, targets: [] };
      }
      groups[id].targets.push(target);
    }
    return Object.entries(groups);
  }, [targets]);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <Tabs
          value={periodType}
          onValueChange={(val: any) => {
            setPeriodType(val);
            setCurrentDate(new Date());
          }}
        >
          <TabsList>
            <TabsTrigger value="weekly">Weekly Plans</TabsTrigger>
            <TabsTrigger value="quarterly">Quarterly Plans</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handlePrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium w-[170px] text-center">
            {periodType === "weekly"
              ? `Week of ${format(periodStart, "MMM d, yyyy")}`
              : `Q${Math.floor(periodStart.getMonth() / 3) + 1} ${format(periodStart, "yyyy")}`}
          </span>
          <Button variant="outline" size="icon" onClick={handleNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          {(isOwner || isAdmin) && (
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger render={<Button size="sm" className="gap-1.5 ml-2" />}>
                <Plus className="h-4 w-4" />
                Add target for...
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Target for Team Member</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label>Team Member</Label>
                    <Select value={targetMemberId} onValueChange={(val) => setTargetMemberId(val || "")}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.filter((m) => isOwner || m.role !== 'owner').map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.full_name || m.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Target Title</Label>
                    <Input
                      placeholder="e.g. Close 5 Enterprise Deals"
                      value={targetTitle}
                      onChange={(e) => setTargetTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Description (optional)</Label>
                    <Textarea
                      placeholder="Strategic context or milestone criteria..."
                      value={targetDescription}
                      onChange={(e) => setTargetDescription(e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddTarget}
                    disabled={savingTarget || !targetMemberId || !targetTitle.trim()}
                  >
                    {savingTarget ? "Saving..." : "Create Target"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-4">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">
            Loading team plans...
          </div>
        ) : groupedByAgent.length === 0 ? (
          <div className="text-center border-2 border-dashed rounded-xl p-12">
            <Target className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No goals set</h3>
            <p className="text-sm text-muted-foreground mt-1">
              No agents have set their {periodType} targets yet.
            </p>
          </div>
        ) : (
          groupedByAgent.map(([agentId, { agent, targets: agentTargets }]) => {
            const initials = (agent?.full_name || "Unknown")
              .split(" ")
              .filter(Boolean)
              .map((n) => n[0])
              .join("")
              .substring(0, 2)
              .toUpperCase();

            const totalGoals = agentTargets.length;
            const completedGoals = agentTargets.filter(
              (t) => t.status === "completed"
            ).length;
            const totalTasks = agentTargets.reduce(
              (sum, t) => sum + (t.action_items?.length || 0),
              0
            );
            const completedTasks = agentTargets.reduce(
              (sum, t) =>
                sum +
                (t.action_items?.filter((i) => i.status === "completed").length || 0),
              0
            );
            const totalHours = agentTargets.reduce(
              (sum, t) =>
                sum +
                (t.action_items?.reduce(
                  (s, i) => s + (i.estimated_hours || 0),
                  0
                ) || 0),
              0
            );
            const isAgentExpanded = expandedAgents.has(agentId);

            return (
              <Card key={agentId} className="overflow-hidden">
                {/* Agent Header */}
                <CardHeader
                  className="cursor-pointer hover:bg-muted/30 transition-colors pb-3"
                  onClick={() => toggleAgent(agentId)}
                >
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      {agent?.avatar_url && (
                        <AvatarImage src={agent.avatar_url} />
                      )}
                      <AvatarFallback className="text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg">
                        {agent?.full_name || "Unknown User"}
                      </CardTitle>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span>
                          {completedGoals}/{totalGoals} goals done
                        </span>
                        <span className="flex items-center gap-1">
                          <Activity className="h-3 w-3" />
                          {completedTasks}/{totalTasks} tasks
                        </span>
                        {totalHours > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {totalHours}h planned
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Agent-level progress */}
                    <div className="flex items-center gap-3 shrink-0">
                      {totalTasks > 0 && (
                        <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.round((completedTasks / totalTasks) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                      {isAgentExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </CardHeader>

                {/* Goals inside this Agent */}
                {isAgentExpanded && (
                  <CardContent className="pt-0 pb-4 border-t space-y-3">
                    {agentTargets.map((target) => {
                      const goalCompleted =
                        target.action_items?.filter(
                          (i) => i.status === "completed"
                        ).length || 0;
                      const goalTotal = target.action_items?.length || 0;
                      const goalHours =
                        target.action_items?.reduce(
                          (s, i) => s + (i.estimated_hours || 0),
                          0
                        ) || 0;
                      const goalProgress =
                        goalTotal === 0
                          ? 0
                          : Math.round((goalCompleted / goalTotal) * 100);
                      const isGoalExpanded = expandedGoals.has(target.id);

                      return (
                        <div
                          key={target.id}
                          className="rounded-lg border bg-background overflow-hidden"
                        >
                          {/* Goal Row */}
                          <div
                            className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20 transition-colors"
                            onClick={() => toggleGoal(target.id)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate">
                                  {target.title}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] shrink-0 ${STATUS_COLORS[target.status]}`}
                                >
                                  {STATUS_LABELS[target.status]}
                                </Badge>
                                {target.creator?.full_name && target.created_by && target.created_by !== target.user_id && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] bg-muted/60 text-muted-foreground font-normal shrink-0"
                                  >
                                    Set by {target.creator.full_name}
                                  </Badge>
                                )}
                              </div>
                              {target.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  {target.description}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                              {goalHours > 0 && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {goalHours}h
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Activity className="h-3 w-3" />
                                {goalCompleted}/{goalTotal}
                              </span>
                              {goalTotal > 0 && (
                                <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      goalProgress === 100
                                        ? "bg-emerald-500"
                                        : "bg-primary"
                                    }`}
                                    style={{ width: `${goalProgress}%` }}
                                  />
                                </div>
                              )}
                              {isGoalExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </div>
                          </div>

                          {/* Tasks under this Goal */}
                          {isGoalExpanded && goalTotal > 0 && (
                            <div className="border-t px-3 py-2 space-y-0.5 bg-muted/10">
                              {target.action_items.map((task) => (
                                <div
                                  key={task.id}
                                  className="flex items-center gap-3 py-1.5 px-1 text-sm"
                                >
                                  <span className="shrink-0 text-muted-foreground">
                                    {task.status === "completed" ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                      <Circle className="h-4 w-4" />
                                    )}
                                  </span>
                                  <span
                                    className={`flex-1 ${
                                      task.status === "completed"
                                        ? "line-through text-muted-foreground"
                                        : ""
                                    }`}
                                  >
                                    {task.title}
                                  </span>
                                  {task.estimated_hours && (
                                    <span className="text-xs text-muted-foreground shrink-0">
                                      {task.estimated_hours}h
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
