import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateStepsForActivation } from './validate';
import { runAutomationsForTrigger } from './engine';

const mockInsert = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'task-new-123' }, error: null }),
  }),
});

const mockNotificationsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

let mockConversationsData: any = null;
let mockContactData: any = { id: 'c-1', name: 'Aarav Patel', phone: '+919876543210' };

vi.mock('./admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'action_items') {
        return {
          insert: mockInsert,
        };
      }
      if (table === 'notifications') {
        return {
          insert: mockNotificationsInsert,
        };
      }
      if (table === 'contacts') {
        const contactChain: any = {
          select: vi.fn(() => contactChain),
          eq: vi.fn(() => contactChain),
          maybeSingle: vi.fn().mockImplementation(() => {
            return Promise.resolve({ data: mockContactData, error: null });
          }),
        };
        return contactChain;
      }
      if (table === 'conversations') {
        const convChain: any = {
          select: vi.fn(() => convChain),
          eq: vi.fn(() => convChain),
          order: vi.fn(() => convChain),
          limit: vi.fn(() => convChain),
          maybeSingle: vi.fn().mockImplementation(() => {
            return Promise.resolve({ data: mockConversationsData, error: null });
          }),
        };
        return convChain;
      }
      if (table === 'automations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'auto-1',
                      account_id: 'acc-1',
                      user_id: 'user-creator',
                      name: 'Create Task on Breach',
                      trigger_type: 'sla_breach',
                      trigger_config: {},
                      status: 'active',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'automation_steps') {
        const stepResults = [
          {
            id: 'step-1',
            automation_id: 'auto-1',
            step_type: 'create_task',
            step_config: {
              title: 'Follow up with {{contact.name}}',
              description: 'SLA breached for phone {{contact.phone}}',
              assignee: 'conversation_assignee',
              due_in_days: 2,
              priority: 'urgent',
            },
            position: 0,
            parent_step_id: null,
            branch: null,
          },
        ];
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          order: vi.fn(() => chain),
          is: vi.fn(() => chain),
          then: (resolve: any) => resolve({ data: stepResults, error: null }),
        };
        return chain;
      }
      if (table === 'automation_logs') {
        const logChain: any = {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { results: [] }, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: { results: [] }, error: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
        return logChain;
      }
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

describe('Task 7: create_task automation step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationsData = null;
    mockContactData = { id: 'c-1', name: 'Aarav Patel', phone: '+919876543210' };
  });

  describe('Validation', () => {
    it('flags missing title on create_task step', () => {
      const issues = validateStepsForActivation([
        {
          step_type: 'create_task',
          step_config: {
            title: '',
            assignee: 'conversation_assignee',
          },
        },
      ]);
      expect(issues).toContainEqual({
        path: 'steps[0].title',
        message: 'title is required',
      });
    });

    it('flags missing assignee_id when assignee mode is "specific"', () => {
      const issues = validateStepsForActivation([
        {
          step_type: 'create_task',
          step_config: {
            title: 'Call customer',
            assignee: 'specific',
            assignee_id: '',
          },
        },
      ]);
      expect(issues).toContainEqual({
        path: 'steps[0].assignee_id',
        message: 'assignee is required when assignee is "specific"',
      });
    });

    it('passes validation with valid config', () => {
      const issues = validateStepsForActivation([
        {
          step_type: 'create_task',
          step_config: {
            title: 'Call customer',
            assignee: 'conversation_assignee',
            due_in_days: 1,
          },
        },
      ]);
      expect(issues).toEqual([]);
    });
  });

  describe('Execution Engine', () => {
    it('resolves contact placeholders, creates task with source automation, and notifies assignee', async () => {
      mockConversationsData = { id: 'conv-101', assigned_agent_id: 'agent-priya' };

      await runAutomationsForTrigger({
        triggerType: 'sla_breach',
        accountId: 'acc-1',
        contactId: 'c-1',
        context: {
          conversation_id: 'conv-101',
        },
      });

      // Verify task insert call
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 'acc-1',
          agent_id: 'user-creator',
          assignee_id: 'agent-priya',
          title: 'Follow up with Aarav Patel',
          description: 'SLA breached for phone +919876543210',
          priority: 'urgent',
          contact_id: 'c-1',
          conversation_id: 'conv-101',
          source: 'automation',
        })
      );

      // Verify notification insert call
      expect(mockNotificationsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'agent-priya',
          type: 'task_assigned',
          title: 'Task assigned: Follow up with Aarav Patel',
          link: '/action-items?task=task-new-123',
        })
      );
    });
  });
});
