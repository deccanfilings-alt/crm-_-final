'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Search, Loader2, MessageSquare } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Contact } from '@/types';

interface NewConversationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewConversationModal({ open, onOpenChange }: NewConversationModalProps) {
  const router = useRouter();
  const supabase = createClient();

  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [initiatingId, setInitiatingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Fetch contacts whenever modal is open, search, or page changes
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    const fetchContacts = async () => {
      let query = supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * 50, (page + 1) * 50 - 1);

      if (search.trim()) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data, error } = await query;

      if (!cancelled) {
        if (!error && data) {
          if (page === 0) {
            setContacts(data);
          } else {
            setContacts((prev) => {
              const newContacts = [...prev];
              for (const contact of data) {
                if (!newContacts.some((c) => c.id === contact.id)) {
                  newContacts.push(contact);
                }
              }
              return newContacts;
            });
          }
          setHasMore(data.length === 50);
        }
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      fetchContacts();
    }, 300); // debounce search

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, page, supabase]);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [search]);

  const handleInitiate = useCallback(async (contactId: string) => {
    setInitiatingId(contactId);
    try {
      const res = await fetch('/api/conversations/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to init conversation');
      }
      if (data.conversationId) {
        onOpenChange(false);
        router.push(`/inbox?c=${data.conversationId}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start conversation');
    } finally {
      setInitiatingId(null);
    }
  }, [onOpenChange, router]);

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  // Clear search when modal closes
  useEffect(() => {
    if (!open) {
      setSearch('');
      setContacts([]);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-6 pb-2 border-b border-border">
          <DialogTitle>New Conversation</DialogTitle>
          <DialogDescription>
            Search for a contact to start messaging.
          </DialogDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="pl-9 border-border focus-visible:ring-primary/50"
            />
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden min-h-0 relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/50 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          <ScrollArea className="h-[400px]">
            <div className="p-4 flex flex-col gap-2">
              {contacts.length === 0 && !loading && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No contacts found.
                </div>
              )}
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <Avatar className="h-10 w-10 shrink-0 border border-border">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                        {getInitials(contact.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-sm text-foreground truncate">
                        {contact.name || 'Unknown'}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {contact.phone}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 ml-2 h-8"
                    disabled={initiatingId === contact.id}
                    onClick={() => handleInitiate(contact.id)}
                  >
                    {initiatingId === contact.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <MessageSquare className="h-3.5 w-3.5 mr-2" />
                        Message
                      </>
                    )}
                  </Button>
                </div>
              ))}
              {hasMore && contacts.length > 0 && (
                <div className="pt-2 pb-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Load More
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
