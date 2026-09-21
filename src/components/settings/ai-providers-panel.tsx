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
import { Loader2 } from 'lucide-react';

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', url: 'https://platform.openai.com/api-keys', note: 'LLM + embeddings' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/keys', note: 'LLM (recommended)' },
  { id: 'cohere', name: 'Cohere', url: 'https://dashboard.cohere.com/api-keys', note: 'Embeddings (free tier)' },
  { id: 'sarvam', name: 'Sarvam AI', url: 'https://sarvam.ai', note: 'Indian language LLM' },
] as const;

export function AiProvidersPanel() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/ai-providers')
      .then(res => res.json())
      .then(data => {
        if (data.providers) {
          const map: Record<string, string> = {};
          data.providers.forEach((p: any) => {
            map[p.provider] = p.api_key;
          });
          setKeys(map);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (providerId: string) => {
    setSaving(providerId);
    try {
      const res = await fetch('/api/settings/ai-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          api_key: keys[providerId] || '',
          is_active: true
        })
      });
      
      if (!res.ok) throw new Error('Failed to save');
      toast.success(`${providerId} API key saved`);
    } catch (e) {
      toast.error('Failed to save API key');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="AI Providers"
        description="Configure API keys for various LLM providers to use in your Automations."
      />
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          PROVIDERS.map((provider) => (
            <Card key={provider.id}>
              <CardHeader>
                <CardTitle className="text-lg">{provider.name}</CardTitle>
                <CardDescription>
                  Enter your API key from <a href={provider.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{provider.name}</a>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys[provider.id] || ''}
                  onChange={(e) => setKeys({ ...keys, [provider.id]: e.target.value })}
                />
              </CardContent>
              <CardFooter className="border-t border-border px-6 py-4 bg-muted/50 flex justify-end">
                <Button 
                  onClick={() => handleSave(provider.id)} 
                  disabled={saving === provider.id}
                >
                  {saving === provider.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Key
                </Button>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}
