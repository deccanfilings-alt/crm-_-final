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
}
