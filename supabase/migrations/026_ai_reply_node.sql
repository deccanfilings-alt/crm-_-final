-- Drop the bots schema created in 025_bots.sql as we are moving to Flows
DROP TABLE IF EXISTS bot_edges CASCADE;
DROP TABLE IF EXISTS bot_nodes CASCADE;
DROP TABLE IF EXISTS bots CASCADE;

-- Update flow_nodes to allow 'ai_reply' in the CHECK constraint
ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK (
  node_type IN (
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'end',
    'ai_reply'
  )
);
