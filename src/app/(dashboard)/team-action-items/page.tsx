"use client";

import { useEffect, useState, useMemo, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  format,
  addDays,
  subDays,
  startOfWeek,
  subWeeks,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Circle,
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  AlertTriangle,
  Clock,
  TrendingUp,
  Crown,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { RequireRole } from "@/components/auth/require-role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TeamPlanner } from "@/components/tasks/team-planner";
import { TaskSheet } from "@/components/tasks/task-sheet";
import type { ActionItem } from "@/components/tasks/types";
import { todayIST } from "@/lib/dates";

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  high: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
};

interface PersonStats {
  user_id: string;
  full_name: string;
  team: string | null;
  open_count: number;
  overdue_count: number;
  due_today_count: number;
  completed_count: number;
  completed_on_time: number;
  avg_days_late: number | null;
  oldest_overdue_date: string | null;
}

function TeamActionItemsContent() {
  const { isOwner, isAdmin, user } = useAuth();
  const searchParams = useSearchParams();
  const taskParam = searchParams?.get("task");

  const [activeTab, setActiveTab] = useState("dashboard");

  // Dashboard range and team filter
  const [rangePreset, setRangePreset] = useState("this_week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");

  // Dashboard data
  const [stats, setStats] = useState<PersonStats[]>([]);
  const [teamOverdueTasks, setTeamOverdueTasks] = useState<ActionItem[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  // Daily Tasks state
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Task editor state
  const [activeTask, setActiveTask] = useState<ActionItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Compute active date range (from / to) in IST format YYYY-MM-DD
  const dateRange = useMemo(() => {
    const today = todayIST();
    const todayDate = new Date(today);

    if (rangePreset === "last_week") {
      const mon = subWeeks(startOfWeek(todayDate, { weekStartsOn: 1 }), 1);
      const sun = addDays(mon, 6);
      return { from: format(mon, "yyyy-MM-dd"), to: format(sun, "yyyy-MM-dd") };
    }
    if (rangePreset === "this_month") {
      const start = startOfMonth(todayDate);
      const end = endOfMonth(todayDate);
      return { from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") };
    }
    if (rangePreset === "custom" && customFrom && customTo) {
      return { from: customFrom, to: customTo };
    }

    // Default: this_week (Mon to Sun)
    const mon = startOfWeek(todayDate, { weekStartsOn: 1 });
    const sun = addDays(mon, 6);
    return { from: format(mon, "yyyy-MM-dd"), to: format(sun, "yyyy-MM-dd") };
  }, [rangePreset, customFrom, customTo]);

  // Fetch Dashboard Stats & Overdue Tasks
  const fetchDashboardData = useCallback(async () => {
    setLoadingDashboard(true);
    try {
      const [statsRes, overdueRes] = await Promise.all([
        fetch(`/api/action-items/stats?from=${dateRange.from}&to=${dateRange.to}`),
        fetch(`/api/action-items?overdue=true&scope=team`),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(Array.isArray(statsData) ? statsData : []);
      }
      if (overdueRes.ok) {
        const overdueData = await overdueRes.json();
        setTeamOverdueTasks(Array.isArray(overdueData) ? overdueData : []);
      }
    } catch (err: any) {
      console.error("Failed to load dashboard data:", err);
      toast.error(err.message || "Failed to load dashboard stats");
    } finally {
      setLoadingDashboard(false);
    }
  }, [dateRange]);

  useEffect(() => {
    if (activeTab === "dashboard") {
      fetchDashboardData();
    }
  }, [activeTab, fetchDashboardData]);

  // Deep-link handling: ?task=<id>
  useEffect(() => {
    if (!taskParam) return;
    fetch(`/api/action-items/${taskParam}`)
      .then((res) => {
        if (!res.ok) throw new Error("Task not found");
        return res.json();
      })
      .then((task) => {
        setActiveTask(task);
        setSheetOpen(true);
      })
      .catch((err) => {
        console.error("Failed to load deep linked task in team view:", err);
      });
  }, [taskParam]);

  // Daily Tasks fetch
  const fetchDailyItems = async (date: Date) => {
    setLoadingDaily(true);
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      const res = await fetch(`/api/action-items?date=${dateStr}`);
      if (!res.ok) throw new Error("Failed to fetch team items");
      const data = await res.json();
      setItems(data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoadingDaily(false);
    }
  };

  useEffect(() => {
    if (activeTab === "daily") {
      fetchDailyItems(currentDate);
    }
  }, [currentDate, activeTab]);

  const isToday = format(currentDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  // Distinct teams for team filter dropdown
  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    stats.forEach((s) => {
      if (s.team && s.team.trim()) set.add(s.team.trim());
    });
    return Array.from(set);
  }, [stats]);

  // Filtered stats by selected team
  const filteredStats = useMemo(() => {
    if (teamFilter === "all") return stats;
    return stats.filter(
      (s) => s.team?.toLowerCase() === teamFilter.toLowerCase()
    );
  }, [stats, teamFilter]);

  // Filtered overdue tasks by selected team
  const filteredOverdueTasks = useMemo(() => {
    if (teamFilter === "all") return teamOverdueTasks;
    return teamOverdueTasks.filter(
      (t) => (t.assignee as any)?.team?.toLowerCase() === teamFilter.toLowerCase()
    );
  }, [teamOverdueTasks, teamFilter]);

  // Summary tiles computation
  const summaryMetrics = useMemo(() => {
    let totalOpen = 0;
    let totalOverdue = 0;
    let totalCompleted = 0;
    let totalOnTime = 0;

    for (const row of filteredStats) {
      totalOpen += Number(row.open_count || 0);
      totalOverdue += Number(row.overdue_count || 0);
      totalCompleted += Number(row.completed_count || 0);
      totalOnTime += Number(row.completed_on_time || 0);
    }

    const onTimeRate =
      totalCompleted > 0 ? Math.round((totalOnTime / totalCompleted) * 100) : 100;

    return { totalOpen, totalOverdue, totalCompleted, onTimeRate };
  }, [filteredStats]);

  // Per-person table sorted by overdue count desc, then on-time %
  const sortedPersonStats = useMemo(() => {
    return [...filteredStats].sort((a, b) => {
      const oA = Number(a.overdue_count || 0);
      const oB = Number(b.overdue_count || 0);
      if (oB !== oA) return oB - oA;

      const rateA =
        Number(a.completed_count || 0) > 0
          ? Number(a.completed_on_time || 0) / Number(a.completed_count)
          : 1;
      const rateB =
        Number(b.completed_count || 0) > 0
          ? Number(b.completed_on_time || 0) / Number(b.completed_count)
          : 1;
      return rateA - rateB;
    });
  }, [filteredStats]);

  // Daily grouping
  const groupedByAgent = useMemo(() => {
    const groups: Record<
      string,
      { agent: NonNullable<ActionItem["assignee"]>; items: ActionItem[] }
    > = {};
    for (const item of items) {
      if (priorityFilter !== "all" && item.priority !== priorityFilter) continue;
      if (statusFilter !== "all" && item.status !== statusFilter) continue;

      const assignee = item.assignee || item.agent;
      if (!assignee) continue;

      const id = item.assignee_id || item.agent_id;
      if (!groups[id]) {
        groups[id] = { agent: assignee, items: [] };
      }
      groups[id].items.push(item);
    }
    return Object.entries(groups);
  }, [items, priorityFilter, statusFilter]);

  const agentsWithZeroCompleted = useMemo(() => {
    if (!isToday) return [];
    return groupedByAgent
      .filter(
        ([_, group]) =>
          group.items.length > 0 &&
          group.items.every((i) => i.status !== "completed")
      )
      .map(([_, group]) => group.agent?.full_name || "Unknown User");
  }, [groupedByAgent, isToday]);

  const handleUpdateTask = (updated: ActionItem) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    setTeamOverdueTasks((prev) =>
      updated.status === "completed" || updated.status === "cancelled"
        ? prev.filter((item) => item.id !== updated.id)
        : prev.map((item) => (item.id === updated.id ? updated : item))
    );
    setActiveTask(updated);
    if (activeTab === "dashboard") {
      fetchDashboardData();
    }
  };

  const handleDeleteTask = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setTeamOverdueTasks((prev) => prev.filter((item) => item.id !== id));
    setActiveTask(null);
    if (activeTab === "dashboard") {
      fetchDashboardData();
    }
  };

  return (
    <RequireRole min="admin">
      <div className="flex h-full w-full flex-col space-y-6 overflow-hidden">
        {/* Header and Tab switcher */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Team Action Items</h1>
            <p className="text-muted-foreground mt-1">
              Accountability dashboard, productivity metrics, and team management.
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="dashboard" className="gap-1.5">
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </TabsTrigger>
              <TabsTrigger value="plans" className="gap-1.5">
                <CalendarDays className="h-4 w-4" /> Weekly/Quarterly Plans
              </TabsTrigger>
              <TabsTrigger value="daily" className="gap-1.5">
                <CheckSquare className="h-4 w-4" /> Daily Tasks
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* TAB 1: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            {/* Range and Team Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-muted/40 rounded-xl border">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Date Range
                </span>
                <Select value={rangePreset} onValueChange={(val) => setRangePreset(val || "this_week")}>
                  <SelectTrigger className="w-[150px] h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="this_week">This Week</SelectItem>
                    <SelectItem value="last_week">Last Week</SelectItem>
                    <SelectItem value="this_month">This Month</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>

                {rangePreset === "custom" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="h-8 px-2 text-xs rounded border bg-background"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="h-8 px-2 text-xs rounded border bg-background"
                    />
                  </div>
                )}
                <span className="text-xs text-muted-foreground ml-2">
                  ({dateRange.from} to {dateRange.to})
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Team
                </span>
                <Select value={teamFilter} onValueChange={(val) => setTeamFilter(val || "all")}>
                  <SelectTrigger className="w-[150px] h-8 text-xs bg-background">
                    <SelectValue placeholder="All Teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {availableTeams.map((tm) => (
                      <SelectItem key={tm} value={tm}>
                        {tm.charAt(0).toUpperCase() + tm.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 4 Summary Tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-card shadow-sm border">
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Open Tasks</span>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-bold">{summaryMetrics.totalOpen}</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Active across all members</p>
                </CardContent>
              </Card>

              <Card className={`shadow-sm border ${summaryMetrics.totalOverdue > 0 ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}>
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Overdue Tasks</span>
                  <AlertTriangle className={`h-4 w-4 ${summaryMetrics.totalOverdue > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className={`text-2xl font-bold ${summaryMetrics.totalOverdue > 0 ? "text-destructive" : ""}`}>
                    {summaryMetrics.totalOverdue}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Need immediate attention</p>
                </CardContent>
              </Card>

              <Card className="bg-card shadow-sm border">
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Done in Range</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {summaryMetrics.totalCompleted}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Completed by team</p>
                </CardContent>
              </Card>

              <Card className="bg-card shadow-sm border">
                <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">On-Time Delivery</span>
                  <TrendingUp className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-bold">{summaryMetrics.onTimeRate}%</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Completed on or before deadline</p>
                </CardContent>
              </Card>
            </div>

            {/* Per-Person Accountability Table */}
            <Card className="border bg-card">
              <CardHeader className="p-4 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Team Members Accountability</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Sorted by overdue count and on-time performance</p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingDashboard ? (
                  <div className="py-12 text-center text-xs text-muted-foreground">Loading team stats...</div>
                ) : sortedPersonStats.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground">No member records found</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Member</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-center">Open</TableHead>
                        <TableHead className="text-center">Overdue</TableHead>
                        <TableHead className="text-center">Due Today</TableHead>
                        <TableHead className="text-center">Done in Range</TableHead>
                        <TableHead className="text-center">On-Time %</TableHead>
                        <TableHead className="text-right">Avg Days Late</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedPersonStats.map((person) => {
                        const hasNoTasksToday =
                          Number(person.due_today_count || 0) === 0 &&
                          Number(person.open_count || 0) === 0;

                        const compCount = Number(person.completed_count || 0);
                        const onTimeCount = Number(person.completed_on_time || 0);
                        const onTimePercent =
                          compCount > 0 ? Math.round((onTimeCount / compCount) * 100) : null;

                        const overdue = Number(person.overdue_count || 0);

                        return (
                          <TableRow key={person.user_id} className="text-xs hover:bg-muted/40">
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-6 w-6">
                                  <AvatarFallback className="text-[10px]">
                                    {(person.full_name || "U").substring(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <span>{person.full_name}</span>
                                {hasNoTasksToday && (
                                  <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground border-dashed">
                                    No tasks today
                                  </Badge>
                                )}
                              </div>
                            </TableCell>

                            <TableCell>
                              {person.team ? (
                                <Badge variant="secondary" className="capitalize text-[10px]">
                                  {person.team}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-[11px] italic">—</span>
                              )}
                            </TableCell>

                            <TableCell className="text-center font-medium">
                              {person.open_count}
                            </TableCell>

                            <TableCell className="text-center">
                              {overdue > 0 ? (
                                <span className="font-semibold text-destructive">
                                  {overdue}
                                  {person.oldest_overdue_date && (
                                    <span className="text-[10px] text-muted-foreground font-normal ml-1">
                                      (since {format(new Date(person.oldest_overdue_date), "MMM d")})
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>

                            <TableCell className="text-center font-medium">
                              {person.due_today_count}
                            </TableCell>

                            <TableCell className="text-center font-medium">
                              {person.completed_count}
                            </TableCell>

                            <TableCell className="text-center">
                              {onTimePercent !== null ? (
                                <Badge
                                  variant="outline"
                                  className={
                                    onTimePercent >= 80
                                      ? "text-emerald-600 border-emerald-500/30 font-semibold"
                                      : onTimePercent >= 50
                                      ? "text-amber-500 border-amber-500/30"
                                      : "text-destructive border-destructive/30"
                                  }
                                >
                                  {onTimePercent}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-[11px]">—</span>
                              )}
                            </TableCell>

                            <TableCell className="text-right text-muted-foreground">
                              {person.avg_days_late !== null && Number(person.avg_days_late) > 0
                                ? `${Number(person.avg_days_late).toFixed(1)} d`
                                : "0 d"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Overdue Tasks List Across Days */}
            <Card className="border bg-card">
              <CardHeader className="p-4 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Overdue Tasks Across All Days
                    <Badge variant="destructive" className="ml-1 text-xs">
                      {filteredOverdueTasks.length}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Click any task to reassign, move deadline, or cancel with a reason.
                  </p>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                {filteredOverdueTasks.length === 0 ? (
                  <div className="py-8 text-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ All clear! No open overdue tasks in the account.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredOverdueTasks.map((task) => {
                      const today = todayIST();
                      const daysOverdue = Math.max(
                        1,
                        Math.round(
                          (new Date(today).getTime() - new Date(task.target_date).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      );
                      const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal;

                      return (
                        <div
                          key={task.id}
                          onClick={() => {
                            setActiveTask(task);
                            setSheetOpen(true);
                          }}
                          className="p-3 rounded-lg border border-border bg-background hover:border-destructive/50 transition-all cursor-pointer space-y-2 shadow-xs group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold line-clamp-1 group-hover:text-primary transition-colors">
                              {task.title}
                            </span>
                            <Badge variant="outline" className={`text-[9px] h-4 px-1 capitalize shrink-0 ${priorityColor}`}>
                              {task.priority}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/40">
                            <span className="font-medium text-foreground truncate">
                              {(task.assignee as any)?.full_name || "Unassigned"}
                            </span>
                            <span className="text-destructive font-semibold shrink-0">
                              {daysOverdue} day{daysOverdue > 1 ? "s" : ""} overdue
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB 2: PLANS */}
        {activeTab === "plans" && <TeamPlanner />}

        {/* TAB 3: DAILY TASKS */}
        {activeTab === "daily" && (
          <>
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4 bg-muted/50 rounded-lg p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentDate(subDays(currentDate, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="w-32 text-center font-medium">
                  {isToday ? "Today" : format(currentDate, "MMM d, yyyy")}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentDate(addDays(currentDate, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val || "all")}>
                  <SelectTrigger className="w-[160px] h-9 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={priorityFilter} onValueChange={(val) => setPriorityFilter(val || "all")}>
                  <SelectTrigger className="w-[160px] h-9 text-xs">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {agentsWithZeroCompleted.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Low Productivity Warning</AlertTitle>
                <AlertDescription>
                  The following agents have tasks planned for today but have completed <strong>0</strong> of them so far:{" "}
                  {agentsWithZeroCompleted.join(", ")}.
                </AlertDescription>
              </Alert>
            )}

            {loadingDaily ? (
              <div className="py-8 text-center text-muted-foreground shrink-0">Loading team tasks...</div>
            ) : groupedByAgent.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed rounded-lg shrink-0">
                <p className="text-muted-foreground">No action items found for this day.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto min-h-0 pr-2">
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {groupedByAgent.map(([agentId, { agent, items }]) => {
                    const completedCount = items.filter((i) => i.status === "completed").length;
                    const progress =
                      items.length === 0 ? 0 : Math.round((completedCount / items.length) * 100);
                    const initials = (agent?.full_name || "Unknown")
                      .split(" ")
                      .filter(Boolean)
                      .map((n) => n[0])
                      .join("")
                      .substring(0, 2)
                      .toUpperCase();
                    const isWarning = isToday && items.length > 0 && completedCount === 0;

                    return (
                      <Card key={agentId} className={isWarning ? "border-destructive/50" : ""}>
                        <CardHeader className="pb-4 border-b bg-muted/20 flex flex-row items-center gap-4">
                          <Avatar className="h-10 w-10">
                            {agent?.avatar_url && <AvatarImage src={agent.avatar_url} />}
                            <AvatarFallback className="text-xs">{initials || "U"}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <CardTitle className="text-lg">{agent?.full_name || "Unknown User"}</CardTitle>
                            <div className="text-sm text-muted-foreground mt-1">
                              {completedCount} of {items.length} tasks completed ({progress}%)
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-4 space-y-2">
                          <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-4">
                            <div
                              className={`h-full transition-all duration-500 ${
                                isWarning ? "bg-destructive" : "bg-emerald-500"
                              }`}
                              style={{ width: `${progress === 0 && isWarning ? 100 : progress}%` }}
                            />
                          </div>

                          {items.map((item) => {
                            const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.normal;

                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setActiveTask(item);
                                  setSheetOpen(true);
                                }}
                                className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors cursor-pointer hover:border-primary/50 ${
                                  item.status === "completed"
                                    ? "bg-muted/50 border-transparent"
                                    : "bg-background"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 text-muted-foreground">
                                    {item.status === "completed" ? (
                                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                    ) : (
                                      <Circle className="h-5 w-5" />
                                    )}
                                  </div>
                                  <div>
                                    <div
                                      className={`${
                                        item.status === "completed"
                                          ? "line-through text-muted-foreground"
                                          : "font-medium"
                                      }`}
                                    >
                                      {item.title}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] h-4 px-1 capitalize ${priorityColor}`}
                                      >
                                        {item.priority}
                                      </Badge>
                                      <Badge variant="secondary" className="text-[10px] h-4 px-1 capitalize">
                                        {STATUS_LABELS[item.status] || item.status}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <TaskSheet
          task={activeTask}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onUpdate={handleUpdateTask}
          onDelete={handleDeleteTask}
        />
      </div>
    </RequireRole>
  );
}

export default function TeamActionItemsPage() {
  return (
    <Suspense
      fallback={<div className="p-6 text-center text-muted-foreground">Loading team action items...</div>}
    >
      <TeamActionItemsContent />
    </Suspense>
  );
}
