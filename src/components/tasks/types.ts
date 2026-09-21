export interface ActionItem {
  id: string;
  account_id: string;
  agent_id: string;
  assignee_id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'review' | 'completed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  target_date: string;
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
