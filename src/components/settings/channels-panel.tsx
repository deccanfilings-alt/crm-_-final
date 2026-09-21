'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { InstagramIcon as Instagram, FacebookIcon as Facebook } from '@/components/icons/social-icons';
import type { ChannelConnection } from '@/types';

export function ChannelsPanel() {
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form states
  const [fbPageId, setFbPageId] = useState('');
  const [fbAccessToken, setFbAccessToken] = useState('');
  const [fbVerifyToken, setFbVerifyToken] = useState('wacrm_meta_verify_token');

  const [igPageId, setIgPageId] = useState('');
  const [igAccessToken, setIgAccessToken] = useState('');
  const [igVerifyToken, setIgVerifyToken] = useState('wacrm_meta_verify_token');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchConnections = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/channels');
      const data = await res.json();
      if (Array.isArray(data)) {
        setConnections(data);
      }
    } catch (e) {
      console.error('Error loading channels:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const handleConnect = async (channelType: 'instagram' | 'facebook') => {
    try {
      setSaving(channelType);
      setErrorMsg(null);
      setSuccessMsg(null);

      const pageId = channelType === 'facebook' ? fbPageId : igPageId;
      const accessToken = channelType === 'facebook' ? fbAccessToken : igAccessToken;
      const verifyToken = channelType === 'facebook' ? fbVerifyToken : igVerifyToken;

      if (!pageId || !accessToken) {
        setErrorMsg('Please enter both Facebook Page ID and Page Access Token.');
        return;
      }

      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_type: channelType,
          page_id: pageId.trim(),
          access_token: accessToken.trim(),
          verify_token: verifyToken.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setErrorMsg(data.error || 'Failed to connect channel');
        return;
      }

      setSuccessMsg(
        channelType === 'instagram'
          ? `Successfully connected Instagram (@${data.instagram_username || data.page_name})!`
          : `Successfully connected Facebook Page (${data.page_name})!`
      );

      if (channelType === 'facebook') {
        setFbAccessToken('');
      } else {
        setIgAccessToken('');
      }

      await fetchConnections();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect channel');
    } finally {
      setSaving(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this channel?')) return;
    try {
      const res = await fetch(`/api/channels?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConnections(prev => prev.filter(c => c.id !== id));
        setSuccessMsg('Channel disconnected.');
      }
    } catch (e) {
      console.error('Error disconnecting channel:', e);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fbConn = connections.find(c => c.channel_type === 'facebook');
  const igConn = connections.find(c => c.channel_type === 'instagram');

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-crm-domain.com';
  const igWebhookUrl = `${origin}/api/webhooks/instagram`;
  const fbWebhookUrl = `${origin}/api/webhooks/facebook`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Social Channels & Bots
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect your Instagram Business accounts and Facebook Pages to enable automated bots, comment-to-DM triggers, and multi-channel messaging in your inbox.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 text-sm rounded-lg bg-destructive/15 text-destructive border border-destructive/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 p-3 text-sm rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Grid of Social Channels */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Instagram Card */}
        <Card className="border-border/60 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-pink-500 to-purple-600" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 text-white shadow-sm">
                  <Instagram className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Instagram Direct & Bot</CardTitle>
                  <CardDescription className="text-xs">DMs, Story Replies & Comment-to-DM</CardDescription>
                </div>
              </div>
              {igConn ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 gap-1 text-xs">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Not Connected</Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 text-sm">
            {igConn ? (
              <div className="p-3.5 rounded-lg bg-muted/50 border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Connected Account:</span>
                  <span className="font-medium text-foreground">
                    @{igConn.instagram_username || igConn.page_name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Page ID:</span>
                  <span className="font-mono text-xs text-muted-foreground">{igConn.page_id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Connected on:</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(igConn.connected_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="pt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8"
                    onClick={() => handleDisconnect(igConn.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="ig-page-id" className="text-xs">Facebook Page ID (Linked to IG)</Label>
                  <Input
                    id="ig-page-id"
                    placeholder="e.g. 104829104928"
                    value={igPageId}
                    onChange={e => setIgPageId(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ig-token" className="text-xs">Page Access Token</Label>
                  <Input
                    id="ig-token"
                    type="password"
                    placeholder="EAAB..."
                    value={igAccessToken}
                    onChange={e => setIgAccessToken(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <Button
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white text-xs h-9"
                  onClick={() => handleConnect('instagram')}
                  disabled={saving === 'instagram'}
                >
                  {saving === 'instagram' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Instagram className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Connect Instagram
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Facebook Card */}
        <Card className="border-border/60 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#1877F2]" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#1877F2] text-white shadow-sm">
                  <Facebook className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Facebook Messenger</CardTitle>
                  <CardDescription className="text-xs">Page Chats, Ads & Automated Replies</CardDescription>
                </div>
              </div>
              {fbConn ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 gap-1 text-xs">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Not Connected</Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 text-sm">
            {fbConn ? (
              <div className="p-3.5 rounded-lg bg-muted/50 border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Connected Page:</span>
                  <span className="font-medium text-foreground">{fbConn.page_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Page ID:</span>
                  <span className="font-mono text-xs text-muted-foreground">{fbConn.page_id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Connected on:</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(fbConn.connected_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="pt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8"
                    onClick={() => handleDisconnect(fbConn.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="fb-page-id" className="text-xs">Facebook Page ID</Label>
                  <Input
                    id="fb-page-id"
                    placeholder="e.g. 104829104928"
                    value={fbPageId}
                    onChange={e => setFbPageId(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fb-token" className="text-xs">Page Access Token</Label>
                  <Input
                    id="fb-token"
                    type="password"
                    placeholder="EAAB..."
                    value={fbAccessToken}
                    onChange={e => setFbAccessToken(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <Button
                  className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white text-xs h-9"
                  onClick={() => handleConnect('facebook')}
                  disabled={saving === 'facebook'}
                >
                  {saving === 'facebook' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Facebook className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Connect Facebook Page
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Webhook Configuration Instructions */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <CardTitle className="text-sm font-semibold">Meta Developer Webhook Configuration</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Copy these Webhook URLs and Verify Tokens into your Meta Developer App to receive real-time messages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Instagram Webhook */}
          <div className="p-3 rounded-lg bg-muted/40 border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Instagram className="w-3.5 h-3.5 text-pink-500" /> Instagram Webhook URL
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => copyToClipboard(igWebhookUrl, 'ig_url')}
              >
                {copiedKey === 'ig_url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <code className="block p-2 rounded bg-background text-xs font-mono break-all text-muted-foreground border">
              {igWebhookUrl}
            </code>
          </div>

          {/* Facebook Webhook */}
          <div className="p-3 rounded-lg bg-muted/40 border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Facebook className="w-3.5 h-3.5 text-[#1877F2]" /> Facebook Messenger Webhook URL
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => copyToClipboard(fbWebhookUrl, 'fb_url')}
              >
                {copiedKey === 'fb_url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <code className="block p-2 rounded bg-background text-xs font-mono break-all text-muted-foreground border">
              {fbWebhookUrl}
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
