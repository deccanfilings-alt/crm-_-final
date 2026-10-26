export interface ActionItemEvent {
  id: string;
  action_item_id: string;
  account_id: string;
  actor_id: string | null;
  event: 'created' | 'status_changed' | 'reassigned' | 'due_changed' | 'priority_changed' | 'title_changed';
  from_value: string | null;
  to_value: string | null;
  created_at: string;
  actor?: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
  from_profile?: {
    full_name: string | null;
  } | null;
  to_profile?: {
    full_name: string | null;
  } | null;
}

export interface ActionItem {
  id: string;
  account_id: string;
  agent_id: string;
  assignee_id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'review' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  target_date: string;
  due_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  conversation_id?: string | null;
  source?: string;
  created_at: string;
  contact_id?: string | null;
  deal_id?: string | null;
  target_id?: string | null;
  estimated_hours?: number | null;
  subtasks?: {
    id: string;
    title: string;
    completed: boolean;
  }[];
  agent?: {
    full_name: string;
    avatar_url: string | null;
  };
  assignee?: {
    full_name: string;
    avatar_url: string | null;
  };
  events?: ActionItemEvent[];
}
