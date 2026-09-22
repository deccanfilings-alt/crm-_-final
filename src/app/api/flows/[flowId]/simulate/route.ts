import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveTemplateExpression } from '@/lib/flows/expressions'
import type {
  FlowNodeRow,
  StartNodeConfig,
  SendMessageNodeConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  CollectInputNodeConfig,
  ConditionNodeConfig,
  SetTagNodeConfig,
  HttpFetchNodeConfig,
} from '@/lib/flows/types'

export interface SimulationStepTrace {
  node_key: string
  node_type: string
  action: string
  rendered_text?: string
  options?: Array<{ id: string; title: string }>
  chosen_option?: string
  captured_value?: string
  branch_taken?: string
  vars_snapshot?: Record<string, unknown>
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { flowId } = await params
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    const db = supabaseAdmin()

    // 1. Fetch flow and verify tenancy
    const { data: flow, error: flowErr } = await db
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (flowErr || !flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    // 2. Fetch all nodes for this flow
    const { data: rawNodes, error: nodesErr } = await db
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', flowId)

    if (nodesErr || !rawNodes || rawNodes.length === 0) {
      return NextResponse.json({ error: 'Flow has no configured nodes' }, { status: 400 })
    }

    const nodeMap = new Map<string, FlowNodeRow>(
      (rawNodes as FlowNodeRow[]).map((n) => [n.node_key, n])
    )

    const body = await request.json().catch(() => ({}))
    const initialVars = (body?.initial_vars as Record<string, unknown>) || {}
    const simulatedInputs: string[] = Array.isArray(body?.simulated_inputs)
      ? [...body.simulated_inputs]
      : []

    // 3. Dry-run simulation interpreter
    const currentVars: Record<string, unknown> = { ...initialVars }
    const steps: SimulationStepTrace[] = []

    let currentKey: string | null = flow.entry_node_id
    let inputIndex = 0
    let status: 'completed' | 'waiting_for_input' | 'handed_off' | 'failed' = 'completed'
    let stopReason = ''

    for (let hop = 0; hop < 64; hop++) {
      if (!currentKey) {
        status = 'completed'
        stopReason = 'end_of_path'
        break
      }

      const node = nodeMap.get(currentKey)
      if (!node) {
        status = 'failed'
        stopReason = `Node "${currentKey}" not found`
        break
      }

      switch (node.node_type) {
        case 'start': {
          const cfg = node.config as unknown as StartNodeConfig
          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: 'entered_start',
            vars_snapshot: { ...currentVars },
          })
          currentKey = cfg.next_node_key || null
          break
        }

        case 'send_message': {
          const cfg = node.config as unknown as SendMessageNodeConfig
          const rendered = resolveTemplateExpression(cfg.text, { vars: currentVars })
          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: 'sent_message',
            rendered_text: rendered,
            vars_snapshot: { ...currentVars },
          })
          currentKey = cfg.next_node_key || null
          break
        }

        case 'send_buttons': {
          const cfg = node.config as unknown as SendButtonsNodeConfig
          const rendered = resolveTemplateExpression(cfg.text, { vars: currentVars })
          const options = (cfg.buttons || []).map((b) => ({ id: b.reply_id, title: b.title }))

          if (inputIndex < simulatedInputs.length) {
            const nextInput = simulatedInputs[inputIndex++].trim().toLowerCase()
            const match = (cfg.buttons || []).find(
              (b) =>
                b.reply_id.toLowerCase() === nextInput ||
                b.title.toLowerCase() === nextInput
            )
            const chosen = match || cfg.buttons[0]
            steps.push({
              node_key: node.node_key,
              node_type: node.node_type,
              action: 'selected_button',
              rendered_text: rendered,
              options,
              chosen_option: chosen ? `${chosen.title} (${chosen.reply_id})` : 'none',
              vars_snapshot: { ...currentVars },
            })
            currentKey = chosen?.next_node_key || null
          } else {
            steps.push({
              node_key: node.node_key,
              node_type: node.node_type,
              action: 'waiting_for_button_click',
              rendered_text: rendered,
              options,
              vars_snapshot: { ...currentVars },
            })
            status = 'waiting_for_input'
            stopReason = 'Awaiting button click'
            currentKey = null
          }
          break
        }

        case 'send_list': {
          const cfg = node.config as unknown as SendListNodeConfig
          const rendered = resolveTemplateExpression(cfg.text, { vars: currentVars })
          const rows = (cfg.sections || []).flatMap((s) => s.rows || [])
          const options = rows.map((r) => ({ id: r.reply_id, title: r.title }))

          if (inputIndex < simulatedInputs.length) {
            const nextInput = simulatedInputs[inputIndex++].trim().toLowerCase()
            const match = rows.find(
              (r) =>
                r.reply_id.toLowerCase() === nextInput ||
                r.title.toLowerCase() === nextInput
            )
            const chosen = match || rows[0]
            steps.push({
              node_key: node.node_key,
              node_type: node.node_type,
              action: 'selected_list_row',
              rendered_text: rendered,
              options,
              chosen_option: chosen ? `${chosen.title} (${chosen.reply_id})` : 'none',
              vars_snapshot: { ...currentVars },
            })
            currentKey = chosen?.next_node_key || null
          } else {
            steps.push({
              node_key: node.node_key,
              node_type: node.node_type,
              action: 'waiting_for_list_selection',
              rendered_text: rendered,
              options,
              vars_snapshot: { ...currentVars },
            })
            status = 'waiting_for_input'
            stopReason = 'Awaiting list selection'
            currentKey = null
          }
          break
        }

        case 'collect_input': {
          const cfg = node.config as unknown as CollectInputNodeConfig
          const rendered = resolveTemplateExpression(cfg.prompt_text, { vars: currentVars })

          if (inputIndex < simulatedInputs.length) {
            const userInput = simulatedInputs[inputIndex++]
            if (cfg.var_key) {
              currentVars[cfg.var_key] = userInput
            }
            steps.push({
              node_key: node.node_key,
              node_type: node.node_type,
              action: 'captured_input',
              rendered_text: rendered,
              captured_value: userInput,
              vars_snapshot: { ...currentVars },
            })
            currentKey = cfg.next_node_key || null
          } else {
            steps.push({
              node_key: node.node_key,
              node_type: node.node_type,
              action: 'waiting_for_text_input',
              rendered_text: rendered,
              vars_snapshot: { ...currentVars },
            })
            status = 'waiting_for_input'
            stopReason = `Awaiting text for "${cfg.var_key}"`
            currentKey = null
          }
          break
        }

        case 'condition': {
          const cfg = node.config as unknown as ConditionNodeConfig
          let result = false
          const val = String(currentVars[cfg.subject_key] ?? '')

          if (cfg.operator === 'equals') {
            result = val.toLowerCase() === (cfg.value || '').toLowerCase()
          } else if (cfg.operator === 'contains') {
            result = val.toLowerCase().includes((cfg.value || '').toLowerCase())
          } else if (cfg.operator === 'present') {
            result = val.trim().length > 0
          } else if (cfg.operator === 'absent') {
            result = val.trim().length === 0
          }

          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: 'evaluated_condition',
            branch_taken: result ? 'true' : 'false',
            vars_snapshot: { ...currentVars },
          })
          currentKey = result ? cfg.true_next : cfg.false_next
          break
        }

        case 'set_tag': {
          const cfg = node.config as unknown as SetTagNodeConfig
          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: `${cfg.mode}_tag`,
            vars_snapshot: { ...currentVars },
          })
          currentKey = cfg.next_node_key || null
          break
        }

        case 'http_fetch': {
          const cfg = node.config as unknown as HttpFetchNodeConfig
          if (cfg.var_key) {
            currentVars[cfg.var_key] = { simulated_status: 200, mock_success: true }
          }
          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: 'simulated_http_fetch_success',
            vars_snapshot: { ...currentVars },
          })
          currentKey = cfg.next_node_key || null
          break
        }

        case 'handoff': {
          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: 'handed_off_to_agent',
            vars_snapshot: { ...currentVars },
          })
          status = 'handed_off'
          currentKey = null
          break
        }

        case 'end': {
          steps.push({
            node_key: node.node_key,
            node_type: node.node_type,
            action: 'flow_completed',
            vars_snapshot: { ...currentVars },
          })
          status = 'completed'
          currentKey = null
          break
        }

        default: {
          currentKey = null
          break
        }
      }
    }

    return NextResponse.json({
      success: true,
      flowId,
      status,
      stop_reason: stopReason || undefined,
      steps_count: steps.length,
      steps,
      final_vars: currentVars,
    })
  } catch (error) {
    console.error('[flows/simulate] Execution error:', error)
    return NextResponse.json({ error: 'Internal simulation error' }, { status: 500 })
  }
}
