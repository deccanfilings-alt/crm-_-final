-- Adds `ai_intent` to the allowed node_types for Flow Builder.
ALTER TABLE public.flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'ai_reply',
    'ai_intent',
    'end'
  ));
