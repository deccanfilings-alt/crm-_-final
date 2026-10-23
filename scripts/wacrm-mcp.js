#!/usr/bin/env node
/**
 * WACRM MCP Stdio Bridge for Claude Code, Claude Desktop, Cursor, and Codex
 *
 * Usage:
 *   node scripts/wacrm-mcp.js --url https://crm.yourdomain.com --key wacrm_live_xxxx
 * Or via environment variables:
 *   WACRM_URL=https://crm.yourdomain.com WACRM_API_KEY=wacrm_live_xxxx node scripts/wacrm-mcp.js
 */

const readline = require('readline');

// Parse CLI flags and environment variables
const args = process.argv.slice(2);
let serverUrl = process.env.WACRM_URL || '';
let apiKey = process.env.WACRM_API_KEY || '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) {
    serverUrl = args[i + 1];
    i++;
  } else if (args[i] === '--key' && args[i + 1]) {
    apiKey = args[i + 1];
    i++;
  }
}

if (!serverUrl || !apiKey) {
  process.stderr.write(
    `[wacrm-mcp] Error: Both --url and --key (or WACRM_URL and WACRM_API_KEY env vars) are required.\n` +
    `Example:\n` +
    `  claude mcp add wacrm -- node ./scripts/wacrm-mcp.js --url https://crm.example.com --key wacrm_live_xxxx\n`
  );
  process.exit(1);
}

// Ensure serverUrl ends with /api/mcp
serverUrl = serverUrl.replace(/\/+$/, '');
const mcpEndpoint = serverUrl.endsWith('/api/mcp') ? serverUrl : `${serverUrl}/api/mcp`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const jsonMessage = JSON.parse(trimmed);

    // Forward JSON-RPC message to the live hosted WACRM backend
    const res = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(jsonMessage),
    });

    if (res.status === 204) {
      // Notification without return value
      return;
    }

    const data = await res.json();
    process.stdout.write(JSON.stringify(data) + '\n');
  } catch (err) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: `MCP Bridge Error: ${err?.message || String(err)}`,
      },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
});

process.stderr.write(`[wacrm-mcp] Bridge connected to ${mcpEndpoint}\n`);
