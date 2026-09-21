"use client";

import { useEffect, useState, useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { RequireRole } from "@/components/auth/require-role";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamPlanner } from "@/components/tasks/team-planner";
import type { ActionItem } from "@/components/tasks/types";

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  high: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  urgent: "bg-destructive/10 text-destructive border-destructive/20",
};

export default function TeamActionItemsPage() {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("plans");

  const fetchItems = async (date: Date) => {
    setLoading(true);
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      const res = await fetch(`/api/action-items?date=${dateStr}`);
      if (!res.ok) throw new Error("Failed to fetch team items");
      const data = await res.json();
      setItems(data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems(currentDate);
  }, [currentDate]);

  const isToday = format(currentDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  const groupedByAgent = useMemo(() => {
    const groups: Record<string, { agent: NonNullable<ActionItem['assignee']>; items: ActionItem[] }> = {};
    for (const item of items) {
      if (priorityFilter !== "all" && item.priority !== priorityFilter) continue;
      if (statusFilter !== "all" && item.status !== statusFilter) continue;

      const assignee = item.assignee || item.agent; // fallback if assignee not loaded somehow
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
    if (!isToday) return []; // Only alert for today
    
    // We only alert for agents who HAVE planned tasks but completed 0 of them.
    // (If they didn't plan any tasks, that's also bad, but we focus on completed = 0)
    return groupedByAgent
      .filter(([_, group]) => group.items.length > 0 && group.items.every(i => i.status !== 'completed'))
      .map(([_, group]) => group.agent?.full_name || "Unknown User");
  }, [groupedByAgent, isToday]);

  return (
    <RequireRole min="admin">
      <div className="flex h-full w-full flex-col space-y-6 overflow-hidden">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Team Action Items</h1>
            <p className="text-muted-foreground mt-1">Track what your agents are planning and completing.</p>
          </div>
          
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="plans">Weekly/Quarterly Plans</TabsTrigger>
              <TabsTrigger value="daily">Daily Tasks</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "plans" ? (
          <TeamPlanner />
        ) : (
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
            </div>

        <div className="flex items-center gap-4 shrink-0">
          <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val || "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
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
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by priority" />
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

        {agentsWithZeroCompleted.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Low Productivity Warning</AlertTitle>
            <AlertDescription>
              The following agents have tasks planned for today but have completed <strong>0</strong> of them so far: {agentsWithZeroCompleted.join(", ")}.
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="py-8 text-center text-muted-foreground shrink-0">Loading team tasks...</div>
        ) : groupedByAgent.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed rounded-lg shrink-0">
            <p className="text-muted-foreground">No action items found for this day.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 pr-2">
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {groupedByAgent.map(([agentId, { agent, items }]) => {
              const completedCount = items.filter(i => i.status === 'completed').length;
              const progress = items.length === 0 ? 0 : Math.round((completedCount / items.length) * 100);
              const initials = (agent?.full_name || "Unknown")
                .split(" ")
                .filter(Boolean)
                .map(n => n[0])
                .join("")
                .substring(0, 2)
                .toUpperCase();
              const isWarning = isToday && items.length > 0 && completedCount === 0;

              return (
                <Card key={agentId} className={isWarning ? 'border-destructive/50' : ''}>
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
                        className={`h-full transition-all duration-500 ${isWarning ? 'bg-destructive' : 'bg-emerald-500'}`} 
                        style={{ width: `${progress === 0 && isWarning ? 100 : progress}%` }} 
                      />
                    </div>
                    
                    {items.map((item) => {
                      const priorityColor = PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.normal;
                      
                      return (
                        <div 
                          key={item.id} 
                          className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                            item.status === 'completed' ? 'bg-muted/50 border-transparent' : 'bg-background'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 text-muted-foreground">
                              {item.status === 'completed' ? (
                                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                              ) : (
                                <Circle className="h-5 w-5" />
                              )}
                            </div>
                            <div>
                              <div className={`${item.status === 'completed' ? 'line-through text-muted-foreground' : 'font-medium'}`}>
                                {item.title}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className={`text-[10px] h-4 px-1 capitalize ${priorityColor}`}>
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
    </div>
  </RequireRole>
);
}
