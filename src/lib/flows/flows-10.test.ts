import { describe, it, expect } from 'vitest'
import {
  detectZeroInputCycles,
  validateFlowForActivation,
} from './validate'
import { resolveTemplateExpression, getNestedValue } from './expressions'
import { evaluateConversationSla } from '../automations/sla-monitor'
import type { NodeInput, FlowInput } from './validate'

describe('Automations & Flows 10/10 Enterprise Features', () => {
  describe('10-Button Support & Validation', () => {
    it('accepts send_buttons with up to 10 buttons/options', () => {
      const buttons = Array.from({ length: 10 }, (_, i) => ({
        reply_id: `btn_${i + 1}`,
        title: `Option ${i + 1}`,
        next_node_key: 'end_node',
      }))

      const flow: FlowInput = {
        name: '10-Button Test Flow',
        trigger_type: 'keyword',
        trigger_config: { keywords: ['menu'], match_type: 'exact' },
        entry_node_id: 'btn_node',
      }

      const nodes: NodeInput[] = [
        {
          node_key: 'btn_node',
          node_type: 'send_buttons',
          config: {
            text: 'Please choose from the following 10 options:',
            buttons,
          },
        },
        {
          node_key: 'end_node',
          node_type: 'end',
          config: {},
        },
      ]

      const issues = validateFlowForActivation(flow, nodes)
      const errorIssues = issues.filter((i) => i.severity === 'error')
      expect(errorIssues).toHaveLength(0)
    })

    it('rejects send_buttons with 11 buttons (exceeds Meta cap)', () => {
      const buttons = Array.from({ length: 11 }, (_, i) => ({
        reply_id: `btn_${i + 1}`,
        title: `Option ${i + 1}`,
        next_node_key: 'end_node',
      }))

      const flow: FlowInput = {
        name: '11-Button Overflow Flow',
        trigger_type: 'keyword',
        trigger_config: { keywords: ['menu'], match_type: 'exact' },
        entry_node_id: 'btn_node',
      }

      const nodes: NodeInput[] = [
        {
          node_key: 'btn_node',
          node_type: 'send_buttons',
          config: {
            text: 'Too many buttons:',
            buttons,
          },
        },
        {
          node_key: 'end_node',
          node_type: 'end',
          config: {},
        },
      ]

      const issues = validateFlowForActivation(flow, nodes)
      const buttonIssues = issues.filter(
        (i) => i.field === 'buttons' && i.message.includes('10 buttons')
      )
      expect(buttonIssues.length).toBeGreaterThan(0)
    })
  })

  describe('Zero-Input Graph Cycle Trap Detection', () => {
    it('detects a fatal auto-advance infinite loop (condition -> set_tag -> condition)', () => {
      const nodes: NodeInput[] = [
        {
          node_key: 'cond_1',
          node_type: 'condition',
          config: {
            subject: 'var',
            subject_key: 'status',
            operator: 'equals',
            value: 'active',
            true_next: 'tag_1',
            false_next: 'tag_1',
          },
        },
        {
          node_key: 'tag_1',
          node_type: 'set_tag',
          config: {
            mode: 'add',
            tag_id: 'tag-uuid-1',
            next_node_key: 'cond_1',
          },
        },
      ]

      const cycles = detectZeroInputCycles(nodes)
      expect(cycles.length).toBeGreaterThan(0)
      expect(cycles[0]).toContain('cond_1')
      expect(cycles[0]).toContain('tag_1')
    })

    it('does NOT flag safe conversational loops (loops with customer input)', () => {
      // Re-prompt loop: collect_input -> condition -> collect_input
      // Since collect_input waits for customer reply, it does NOT deadlock the runner
      const nodes: NodeInput[] = [
        {
          node_key: 'input_1',
          node_type: 'collect_input',
          config: {
            prompt_text: 'Enter your email:',
            var_key: 'email',
            next_node_key: 'cond_1',
          },
        },
        {
          node_key: 'cond_1',
          node_type: 'condition',
          config: {
            subject: 'var',
            subject_key: 'email',
            operator: 'contains',
            value: '@',
            true_next: 'end_node',
            false_next: 'input_1', // loop back to collect input again
          },
        },
        {
          node_key: 'end_node',
          node_type: 'end',
          config: {},
        },
      ]

      const cycles = detectZeroInputCycles(nodes)
      expect(cycles).toHaveLength(0)
    })
  })

  describe('Safe Nested Expression Resolver', () => {
    it('resolves top-level and deeply nested properties', () => {
      const context = {
        vars: {
          user: {
            profile: {
              first_name: 'Sophia',
            },
          },
          items: [{ sku: 'PRO-100', price: 49 }],
        },
        contact: {
          name: 'Alex Vance',
        },
      }

      expect(resolveTemplateExpression('Hello {{vars.user.profile.first_name}}!', context)).toBe(
        'Hello Sophia!'
      )
      expect(resolveTemplateExpression('Item: {{vars.items.0.sku}}', context)).toBe(
        'Item: PRO-100'
      )
      expect(resolveTemplateExpression('Contact: {{contact.name}}', context)).toBe(
        'Contact: Alex Vance'
      )
    })

    it('uses fallbacks when properties are missing or null', () => {
      const context = {
        vars: {},
      }

      const res1 = resolveTemplateExpression(
        'Hello {{vars.missing_name || "Valued Customer"}}!',
        context
      )
      expect(res1).toBe('Hello Valued Customer!')

      const res2 = resolveTemplateExpression(
        'Status: {{vars.non_existent | "Pending"}}',
        context
      )
      expect(res2).toBe('Status: Pending')
    })

    it('handles null object safely without crashing', () => {
      expect(getNestedValue(null, 'user.name')).toBeUndefined()
      expect(getNestedValue(undefined, 'user.name')).toBeUndefined()
      expect(resolveTemplateExpression('Empty: {{vars.a.b.c}}', {})).toBe('Empty: ')
    })
  })

  describe('Automated SLA Breach Monitor', () => {
    it('detects a breach when customer message is older than threshold and unanswered', () => {
      const thirtyFiveMinsAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString()
      const fortyMinsAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString()

      const conv = {
        status: 'open',
        last_customer_message_at: thirtyFiveMinsAgo,
        last_message_at: fortyMinsAgo, // agent has not messaged since customer
        sla_breached_at: null,
        sla_threshold_minutes: 30,
      }

      const evalResult = evaluateConversationSla(conv)
      expect(evalResult.isBreached).toBe(true)
      expect(evalResult.elapsedMinutes).toBeGreaterThanOrEqual(35)
    })

    it('returns not breached if agent messaged after customer', () => {
      const thirtyFiveMinsAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString()
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

      const conv = {
        status: 'open',
        last_customer_message_at: thirtyFiveMinsAgo,
        last_message_at: tenMinsAgo, // agent replied 10 mins ago!
        sla_breached_at: null,
        sla_threshold_minutes: 30,
      }

      const evalResult = evaluateConversationSla(conv)
      expect(evalResult.isBreached).toBe(false)
    })

    it('does not re-flag a conversation that is already marked as breached', () => {
      const thirtyFiveMinsAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString()

      const conv = {
        status: 'open',
        last_customer_message_at: thirtyFiveMinsAgo,
        last_message_at: thirtyFiveMinsAgo,
        sla_breached_at: new Date().toISOString(), // already breached
        sla_threshold_minutes: 30,
      }

      const evalResult = evaluateConversationSla(conv)
      expect(evalResult.isBreached).toBe(false)
    })
  })
})
