'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  KeyRound,
  Copy,
  Check,
  Trash2,
  Loader2,
  Terminal,
  Bot,
  ExternalLink,
  Sparkles,
  Cpu,
  Code2,
  Layers,
  Globe,
  Info,
} from 'lucide-react';

interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

type ClientTab = 'claude' | 'codex' | 'cursor' | 'desktop' | 'rest';

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientTab>('claude');

  const currentOrigin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://your-crm-domain.com';

  const activeKeyPlaceholder = newlyCreatedKey || 'YOUR_API_KEY';

  const fetchKeys = async () => {
    try {
      const res = await fetch('/api/settings/api-keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.api_keys || []);
      }
    } catch {
      toast.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async () => {
    if (!keyName.trim()) {
      toast.error('Please enter a name for the key');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: keyName.trim(),
          scopes: ['all'],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');

      setNewlyCreatedKey(data.apiKey.rawKey);
      setKeyName('');
      toast.success('API key generated successfully!');
      fetchKeys();
    } catch (e: any) {
      toast.error(e.message || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) throw new Error('Failed to revoke key');
      toast.success('API key revoked');
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete key');
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section className="max-w-4xl space-y-6 animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Agent Connectors & API Keys"
        description="Connect Claude Code CLI, OpenAI Codex, Cursor, Claude Desktop, or custom AI agents directly to your live CRM using Model Context Protocol (MCP) or OpenAPI."
      />

      {/* Newly Created Key Alert Banner */}
      {newlyCreatedKey && (
        <Card className="border-emerald-500/50 bg-emerald-500/10">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
              <KeyRound className="h-5 w-5" />
              API Key Generated Successfully
            </div>
            <CardDescription className="text-foreground/80">
              Please copy your API key now. It has been automatically populated into the connection guides below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-md bg-background border border-emerald-500/30 p-2.5 font-mono text-xs text-foreground">
              <span className="break-all mr-2">{newlyCreatedKey}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 shrink-0"
                onClick={() => copyToClipboard(newlyCreatedKey, 'new_key')}
              >
                {copied === 'new_key' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                Copy Key
              </Button>
            </div>
          </CardContent>
          <CardFooter className="pt-0">
            <Button variant="ghost" size="sm" onClick={() => setNewlyCreatedKey(null)}>
              Done
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Interactive Agent Connection Guide */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Agent & Assistant Connection Guide</CardTitle>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                13 CRM Tools Ready
              </span>
              <span>•</span>
              <a
                href={`${currentOrigin}/api/v1/openapi.json`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
              >
                <ExternalLink className="h-3 w-3" />
                OpenAPI Spec
              </a>
            </div>
          </div>
          <CardDescription>
            Select your platform below for instant setup commands. Anyone in your workspace can use these instructions to connect their AI tools.
          </CardDescription>

          {/* Client Selector Tabs */}
          <div className="flex flex-wrap gap-1.5 pt-3 border-b border-border/60 pb-3">
            {[
              { id: 'claude', label: 'Claude Code CLI', icon: Terminal },
              { id: 'codex', label: 'OpenAI Codex / ChatGPT', icon: Cpu },
              { id: 'cursor', label: 'Cursor IDE', icon: Code2 },
              { id: 'desktop', label: 'Claude Desktop', icon: Layers },
              { id: 'rest', label: 'cURL & REST', icon: Globe },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = selectedClient === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedClient(tab.id as ClientTab)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="pt-2 space-y-4 text-sm">
          {/* TAB 1: CLAUDE CODE CLI */}
          {selectedClient === 'claude' && (
            <div className="space-y-3.5">
              <div className="text-xs text-muted-foreground">
                Connect Claude Code CLI via Model Context Protocol (MCP) to let Claude view contacts, send WhatsApp messages, query deals, and manage action items.
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                  <span>Option 1: Direct Remote MCP (Recommended)</span>
                  <span className="text-[11px] font-normal text-muted-foreground">Works from any machine</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/80 p-2.5 font-mono text-xs">
                  <span className="truncate mr-2">
                    claude mcp add wacrm {currentOrigin}/api/mcp --header &quot;Authorization: Bearer {activeKeyPlaceholder}&quot;
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 shrink-0"
                    onClick={() =>
                      copyToClipboard(
                        `claude mcp add wacrm ${currentOrigin}/api/mcp --header "Authorization: Bearer ${activeKeyPlaceholder}"`,
                        'claude_opt1'
                      )
                    }
                  >
                    {copied === 'claude_opt1' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                  <span>Option 2: Local Stdio Bridge</span>
                  <span className="text-[11px] font-normal text-muted-foreground">When running locally from repo root</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/80 p-2.5 font-mono text-xs">
                  <span className="truncate mr-2">
                    claude mcp add wacrm -- node ./scripts/wacrm-mcp.js --url {currentOrigin} --key {activeKeyPlaceholder}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 shrink-0"
                    onClick={() =>
                      copyToClipboard(
                        `claude mcp add wacrm -- node ./scripts/wacrm-mcp.js --url ${currentOrigin} --key ${activeKeyPlaceholder}`,
                        'claude_opt2'
                      )
                    }
                  >
                    {copied === 'claude_opt2' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="rounded-md bg-primary/5 border border-primary/15 p-2.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Verification prompt:</span> Run{' '}
                <code className="text-primary font-mono font-medium">claude -p &quot;List the latest 5 contacts in CRM&quot;</code> to test the integration.
              </div>
            </div>
          )}

          {/* TAB 2: OPENAI CODEX / CHATGPT */}
          {selectedClient === 'codex' && (
            <div className="space-y-3.5">
              <div className="text-xs text-muted-foreground">
                Connect OpenAI Codex, Custom GPTs, or OpenAI Assistants using the live OpenAPI 3.1 schema.
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-foreground">Step 1: Copy your OpenAPI 3.1 Schema URL</span>
                <div className="flex items-center justify-between rounded-md bg-muted/80 p-2.5 font-mono text-xs">
                  <span className="truncate mr-2">{currentOrigin}/api/v1/openapi.json</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 shrink-0"
                    onClick={() => copyToClipboard(`${currentOrigin}/api/v1/openapi.json`, 'codex_url')}
                  >
                    {copied === 'codex_url' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="rounded-md bg-muted/40 border border-border/80 p-3 text-xs space-y-2">
                <span className="font-semibold text-foreground block">Step 2: Configure in OpenAI Platform / Custom GPT</span>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Navigate to your Custom GPT or Assistant editor.</li>
                  <li>Click <strong className="text-foreground">Add Action</strong> &rarr; select <strong className="text-foreground">Import from URL</strong>.</li>
                  <li>Paste the schema URL above.</li>
                  <li>Under <strong className="text-foreground">Authentication</strong>, select <strong className="text-foreground">API Key</strong> &rarr; Auth Type: <strong className="text-foreground">Bearer</strong>.</li>
                  <li>Paste your generated API key (<code className="font-mono text-primary">{activeKeyPlaceholder}</code>).</li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 3: CURSOR IDE */}
          {selectedClient === 'cursor' && (
            <div className="space-y-3.5">
              <div className="text-xs text-muted-foreground">
                Enable Cursor&apos;s background agent to view your CRM database, manage deals, and inspect conversation logs directly from your IDE.
              </div>

              <div className="rounded-md bg-muted/40 border border-border/80 p-3 text-xs space-y-2">
                <span className="font-semibold text-foreground block">Add to Cursor MCP:</span>
                <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                  <li>Open Cursor &rarr; Settings &rarr; <strong className="text-foreground">Features</strong> &rarr; <strong className="text-foreground">MCP Servers</strong>.</li>
                  <li>Click <strong className="text-foreground">Add New MCP Server</strong>.</li>
                  <li>Set Name: <code className="font-mono text-primary font-semibold">wacrm</code></li>
                  <li>Set Type: <code className="font-mono text-primary">command</code></li>
                  <li>
                    Command:
                    <div className="mt-1 flex items-center justify-between rounded bg-muted/80 p-2 font-mono text-[11px]">
                      <span className="truncate mr-2">
                        node ./scripts/wacrm-mcp.js --url {currentOrigin} --key {activeKeyPlaceholder}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 shrink-0"
                        onClick={() =>
                          copyToClipboard(
                            `node ./scripts/wacrm-mcp.js --url ${currentOrigin} --key ${activeKeyPlaceholder}`,
                            'cursor_cmd'
                          )
                        }
                      >
                        {copied === 'cursor_cmd' ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 4: CLAUDE DESKTOP */}
          {selectedClient === 'desktop' && (
            <div className="space-y-3.5">
              <div className="text-xs text-muted-foreground">
                Add to your Claude Desktop application configuration (<code className="font-mono text-[11px]">claude_desktop_config.json</code>).
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                  <span>Configuration Snippet</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={() =>
                      copyToClipboard(
                        JSON.stringify(
                          {
                            mcpServers: {
                              wacrm: {
                                command: 'node',
                                args: [
                                  './scripts/wacrm-mcp.js',
                                  '--url',
                                  currentOrigin,
                                  '--key',
                                  activeKeyPlaceholder,
                                ],
                              },
                            },
                          },
                          null,
                          2
                        ),
                        'desktop_json'
                      )
                    }
                  >
                    {copied === 'desktop_json' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy JSON
                  </Button>
                </div>
                <pre className="rounded-md bg-muted/80 p-3 font-mono text-xs overflow-x-auto text-foreground">
{JSON.stringify(
  {
    mcpServers: {
      wacrm: {
        command: 'node',
        args: [
          './scripts/wacrm-mcp.js',
          '--url',
          currentOrigin,
          '--key',
          activeKeyPlaceholder,
        ],
      },
    },
  },
  null,
  2
)}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 5: cURL & REST */}
          {selectedClient === 'rest' && (
            <div className="space-y-3.5">
              <div className="text-xs text-muted-foreground">
                Call the JSON-RPC MCP endpoint directly using any HTTP library (Python requests, fetch, axios, curl).
              </div>

              <div>
                <span className="text-xs font-semibold text-foreground block mb-1">Test Connection (ping / status):</span>
                <div className="flex items-center justify-between rounded-md bg-muted/80 p-2.5 font-mono text-xs">
                  <span className="truncate mr-2">
                    curl -H &quot;Authorization: Bearer {activeKeyPlaceholder}&quot; {currentOrigin}/api/mcp
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 shrink-0"
                    onClick={() =>
                      copyToClipboard(
                        `curl -H "Authorization: Bearer ${activeKeyPlaceholder}" ${currentOrigin}/api/mcp`,
                        'curl_ping'
                      )
                    }
                  >
                    {copied === 'curl_ping' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold text-foreground block mb-1">Invoke a Tool (Search Contacts):</span>
                <pre className="rounded-md bg-muted/80 p-3 font-mono text-xs overflow-x-auto text-foreground">
{`curl -X POST "${currentOrigin}/api/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${activeKeyPlaceholder}" \\
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"search_contacts","arguments":{"query":"Alice"}}}'`}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate New Key Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Generate API Key</CardTitle>
          <CardDescription>
            Create a secure API key for yourself or team members to link Claude Code, Codex, or external agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="e.g. Claude Code CLI (MacBook) or Codex Assistant"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <Button onClick={handleCreate} disabled={creating || !keyName.trim()} className="shrink-0 gap-1.5">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Key
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active Keys List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active API Keys</CardTitle>
          <CardDescription>
            Tokens authorized to access this CRM workspace. Revoking a key immediately disconnects that agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No API keys generated yet. Create one above to connect Claude Code or Codex.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((k) => (
                <div key={k.id} className="py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">{k.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {k.key_prefix}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>Created {new Date(k.created_at).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'Never used'}</span>
                      <span>•</span>
                      <span>Scopes: {k.scopes.join(', ')}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                    onClick={() => handleDelete(k.id)}
                    disabled={deletingId === k.id}
                  >
                    {deletingId === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
