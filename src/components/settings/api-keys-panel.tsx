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
  ShieldAlert,
  Sparkles,
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

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://your-crm-domain.com';

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
    <section className="max-w-3xl space-y-6 animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Agent Connectors & API Keys"
        description="Connect Claude Code CLI, Cursor, OpenAI Codex, or external agentic platforms to your live CRM using Model Context Protocol (MCP) or REST APIs."
      />

      {/* Claude Code Quick Connect Instructions */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Connect to Claude Code CLI</CardTitle>
          </div>
          <CardDescription>
            Claude Code connects directly to this live instance using Model Context Protocol (MCP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-semibold text-foreground">Option 1: Remote MCP Server (SSE / HTTP)</span>
            <div className="mt-1 flex items-center justify-between rounded-md bg-muted/80 p-2.5 font-mono text-xs">
              <span className="truncate mr-2">
                claude mcp add wacrm {currentOrigin}/api/mcp --header &quot;Authorization: Bearer YOUR_API_KEY&quot;
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 shrink-0"
                onClick={() =>
                  copyToClipboard(
                    `claude mcp add wacrm ${currentOrigin}/api/mcp --header "Authorization: Bearer YOUR_API_KEY"`,
                    'opt1'
                  )
                }
              >
                {copied === 'opt1' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div>
            <span className="font-semibold text-foreground">Option 2: Local Stdio Bridge</span>
            <div className="mt-1 flex items-center justify-between rounded-md bg-muted/80 p-2.5 font-mono text-xs">
              <span className="truncate mr-2">
                claude mcp add wacrm -- node ./scripts/wacrm-mcp.js --url {currentOrigin} --key YOUR_API_KEY
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 shrink-0"
                onClick={() =>
                  copyToClipboard(
                    `claude mcp add wacrm -- node ./scripts/wacrm-mcp.js --url ${currentOrigin} --key YOUR_API_KEY`,
                    'opt2'
                  )
                }
              >
                {copied === 'opt2' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
            <a
              href={`${currentOrigin}/api/v1/openapi.json`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              OpenAPI 3.1 Specification
            </a>
            <span>•</span>
            <span>13 Tools Available (Contacts, Messaging, Deals, KB, Tasks)</span>
          </div>
        </CardContent>
      </Card>

      {/* Newly Created Key Alert */}
      {newlyCreatedKey && (
        <Card className="border-emerald-500/50 bg-emerald-500/10">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
              <KeyRound className="h-5 w-5" />
              API Key Generated Successfully
            </div>
            <CardDescription className="text-foreground/80">
              Please copy your API key now. For security, you will not be able to view the full key again!
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

      {/* Generate New Key Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create New API Key</CardTitle>
          <CardDescription>
            Generate an access token for external agents (Claude Code, OpenAI Codex, Cursor, AutoGen).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="e.g. Claude Code CLI (MacBook)"
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
            Tokens authorized to call your CRM tools and endpoints.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No API keys generated yet. Create one above to connect Claude Code.
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
