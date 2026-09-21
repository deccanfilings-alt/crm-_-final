'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Phone,
  Mail,
  Copy,
  Check,
  MessageSquare,
  RefreshCw,
  Filter,
  GitMerge,
  AlertTriangle,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { MergeContactModal } from '@/components/contacts/merge-contact-modal';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Checkbox } from '@/components/ui/checkbox';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTagId, setFilterTagId] = useState<string | 'all'>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const router = useRouter();

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Merge Contact state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSurvivor, setMergeSurvivor] = useState<{ id: string; name: string } | null>(null);
  const [mergeLoser, setMergeLoser] = useState<Contact | null>(null);

  const handleOpenMerge = useCallback((contact: Contact) => {
    setMergeSurvivor({ id: contact.id, name: contact.name || contact.phone || 'Unnamed' });
    setMergeLoser(null);
    setMergeOpen(true);
  }, []);

  const handleMergeSelected = useCallback(() => {
    const selectedIds = Array.from(selected);
    if (selectedIds.length !== 2) return;
    const c1 = contacts.find((c) => c.id === selectedIds[0]);
    const c2 = contacts.find((c) => c.id === selectedIds[1]);
    if (!c1 || !c2) return;
    // Survivor is the older contact or the one with a name
    const survivor = (!c2.name && c1.name) ? c1 : (!c1.name && c2.name) ? c2 : (new Date(c1.created_at) <= new Date(c2.created_at) ? c1 : c2);
    const loser = survivor.id === c1.id ? c2 : c1;
    setMergeSurvivor({ id: survivor.id, name: survivor.name || survivor.phone || 'Unnamed' });
    setMergeLoser(loser);
    setMergeOpen(true);
  }, [selected, contacts]);

  // Detect potential duplicate contacts in currently loaded list
  const duplicatePairs = useMemo(() => {
    const pairs: Array<{ contact1: Contact; contact2: Contact }> = [];
    for (let i = 0; i < contacts.length; i++) {
      for (let j = i + 1; j < contacts.length; j++) {
        const c1 = contacts[i];
        const c2 = contacts[j];
        if (c1.phone && c2.phone && phonesMatch(c1.phone, c2.phone)) {
          pairs.push({ contact1: c1, contact2: c2 });
        }
      }
    }
    return pairs;
  }, [contacts]);

  // Copy phone helper
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopyPhone = useCallback(async (e: React.MouseEvent, id: string, phone?: string | null) => {
    e.stopPropagation();
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedId(id);
      toast.success('Phone number copied');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  const handleMessage = useCallback(async (contactId: string) => {
    try {
      const res = await fetch('/api/conversations/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize conversation');
      }
      
      if (data.conversationId) {
        router.push(`/inbox?c=${data.conversationId}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to initialize conversation');
    }
  }, [router]);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
    }
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    let filteredQuery = supabase
      .from('contacts')
      .select('*, contact_tags!inner(tag_id)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)
      .eq('contact_tags.tag_id', filterTagId);

    // @ts-ignore - TS complains about conditional query builder assignments
    let activeQuery = filterTagId === 'all' ? query : filteredQuery;

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      activeQuery = activeQuery.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    const { data, count, error } = await activeQuery;

    if (error) {
      toast.error('Failed to load contacts');
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    if (!data || data.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = data.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = data.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [supabase, page, search, tagsMap, filterTagId]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete contact');
    } else {
      toast.success('Contact deleted');
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error('Failed to delete contacts');
    } else {
      toast.success(`${ids.length} contact${ids.length === 1 ? '' : 's'} deleted`);
      setSelected(new Set());
      fetchContacts();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your contact list. {totalCount > 0 && `${totalCount} total contacts.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={fetchContacts}
            disabled={loading}
            className="border-border text-muted-foreground hover:bg-muted shrink-0"
            title="Refresh contacts"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setCustomFieldsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-4" />
              Custom fields
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            Import
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            Add Contact
          </GatedButton>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // Reset pagination when the query changes — the result
              // set shrinks/grows, page N may no longer be valid.
              setPage(0);
            }}
            placeholder="Search by name, phone, or email..."
            className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger 
            render={
              <Button variant="outline" className={`border-border gap-2 w-full sm:w-auto ${filterTagId !== 'all' ? 'text-primary border-primary/50 bg-primary/5 hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`} />
            }
          >
            <Filter className="size-4" />
            {filterTagId === 'all' ? 'Filter by Tag' : tagsMap[filterTagId]?.name || 'Unknown Tag'}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => { setFilterTagId('all'); setPage(0); }} className={filterTagId === 'all' ? 'bg-muted' : ''}>
              All Contacts
            </DropdownMenuItem>
            {Object.values(tagsMap).map((tag) => (
              <DropdownMenuItem 
                key={tag.id} 
                onClick={() => { setFilterTagId(tag.id); setPage(0); }}
                className={filterTagId === tag.id ? 'bg-muted flex items-center justify-between' : 'flex items-center justify-between'}
              >
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-2">
          <p className="text-sm text-foreground">
            <span className="font-medium">{selected.size}</span>{' '}
            {selected.size === 1 ? 'contact' : 'contacts'} selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
            {selected.size === 2 && (
              <GatedButton
                variant="outline"
                size="sm"
                canAct={canEdit}
                gateReason="merge contacts"
                onClick={handleMergeSelected}
                className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
              >
                <GitMerge className="size-4" />
                Merge 2 Contacts
              </GatedButton>
            )}
            <GatedButton
              variant="destructive"
              size="sm"
              canAct={canEdit}
              gateReason="delete contacts"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              Delete selected
            </GatedButton>
          </div>
        </div>
      )}

      {/* Duplicate Contacts Notice Banner */}
      {!loading && duplicatePairs.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            <span className="truncate">
              Detected {duplicatePairs.length} potential duplicate {duplicatePairs.length === 1 ? 'contact' : 'contacts'} with matching phone numbers ({duplicatePairs[0].contact1.name || duplicatePairs[0].contact1.phone} &amp; {duplicatePairs[0].contact2.name || duplicatePairs[0].contact2.phone}).
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const p = duplicatePairs[0];
              const survivor = (!p.contact2.name && p.contact1.name) ? p.contact1 : (!p.contact1.name && p.contact2.name) ? p.contact2 : (new Date(p.contact1.created_at) <= new Date(p.contact2.created_at) ? p.contact1 : p.contact2);
              const loser = survivor.id === p.contact1.id ? p.contact2 : p.contact1;
              setMergeSurvivor({ id: survivor.id, name: survivor.name || survivor.phone || 'Unnamed' });
              setMergeLoser(loser);
              setMergeOpen(true);
            }}
            className="shrink-0 gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/20 dark:text-amber-300"
          >
            <GitMerge className="size-3.5" />
            Review &amp; Merge
          </Button>
        </div>
      )}

      {/* Table & Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 border border-border border-dashed rounded-lg bg-card/50">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground mt-2">Loading contacts...</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border border-border border-dashed rounded-lg bg-card/50 text-center px-4">
          <Users className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">
            {search ? 'No contacts match your search.' : 'No contacts yet.'}
          </p>
          {!search && (
            <Button
              variant="outline"
              size="sm"
              onClick={openAddForm}
              className="mt-4 border-border text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-3.5" />
              Add your first contact
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && someOnPageSelected}
                      onCheckedChange={toggleSelectAll}
                      disabled={contacts.length === 0}
                      aria-label="Select all contacts on this page"
                    />
                  </TableHead>
                  <TableHead className="text-muted-foreground">Name</TableHead>
                  <TableHead className="text-muted-foreground">Phone</TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">Email</TableHead>
                  <TableHead className="text-muted-foreground hidden lg:table-cell">Services</TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">Tags</TableHead>
                  <TableHead className="text-muted-foreground hidden lg:table-cell">Created</TableHead>
                  <TableHead className="text-muted-foreground w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => {
                  const isNew = contact.created_at === contact.updated_at;
                  return (
                  <TableRow
                    key={contact.id}
                    className={`border-border hover:bg-muted/50 cursor-pointer ${isNew ? 'bg-primary/5 dark:bg-primary/10' : ''}`}
                    onClick={() => openDetail(contact.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(contact.id)}
                        onCheckedChange={() => toggleSelect(contact.id)}
                        aria-label={`Select ${contact.name || contact.phone}`}
                      />
                    </TableCell>
                    <TableCell className="text-foreground font-medium">
                      <div className="flex items-center gap-2">
                        {contact.name || <span className="text-muted-foreground italic">Unnamed</span>}
                        {isNew && <span className="text-[10px] leading-none uppercase font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-sm">New</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {contact.phone}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                      {contact.email || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden lg:table-cell text-sm">
                      {contact.company || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {contact.tags && contact.tags.length > 0 ? (
                          contact.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: tag.color + '20',
                                color: tag.color,
                              }}
                            >
                              {tag.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                        {contact.tags && contact.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{contact.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                      {new Date(contact.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-popover border-border"
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMessage(contact.id);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <MessageSquare className="size-4" />
                            Message
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditForm(contact);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenMerge(contact);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <GitMerge className="size-4" />
                            Merge with Duplicate...
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDelete(contact);
                            }}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card List View */}
          <div className="block md:hidden space-y-3">
            {contacts.map((contact) => {
              const isNew = contact.created_at === contact.updated_at;
              const initials = (contact.name || "Customer")
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2);

              return (
                <div
                  key={contact.id}
                  onClick={() => openDetail(contact.id)}
                  className={`rounded-xl border bg-card p-4 space-y-3 hover:bg-muted/40 transition-all cursor-pointer relative ${isNew ? 'border-primary/50 bg-primary/5 dark:bg-primary/10' : 'border-border'}`}
                >
                  {isNew && (
                    <div className="absolute top-0 right-0 -mt-2 -mr-2">
                       <span className="text-[10px] leading-none uppercase font-bold bg-primary text-primary-foreground px-2 py-1 rounded-full shadow-sm border border-background">New</span>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Checkbox */}
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                        <Checkbox
                          checked={selected.has(contact.id)}
                          onCheckedChange={() => toggleSelect(contact.id)}
                          aria-label={`Select ${contact.name || contact.phone}`}
                        />
                      </div>
                      
                      {/* Initials Avatar */}
                      <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium text-xs shrink-0">
                        {initials}
                      </div>

                      {/* Name & Services */}
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground text-sm truncate">
                          {contact.name || <span className="text-muted-foreground italic">Unnamed</span>}
                        </h3>
                        {contact.company && (
                          <p className="text-xs text-muted-foreground truncate">
                            {contact.company}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions Menu */}
                    <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-popover border-border"
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMessage(contact.id);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <MessageSquare className="size-4" />
                            Message
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openEditForm(contact)}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenMerge(contact);
                            }}
                            className="text-popover-foreground focus:bg-muted focus:text-foreground"
                          >
                            <GitMerge className="size-4" />
                            Merge with Duplicate...
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => confirmDelete(contact)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Phone & Email Info */}
                  <div className="space-y-1.5 pt-1.5 border-t border-border/40">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground font-mono">
                        <Phone className="size-3.5" />
                        {contact.phone}
                      </span>
                      {/* Copy Action Button */}
                      <button
                        onClick={(e) => handleCopyPhone(e, contact.id, contact.phone)}
                        className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
                        title="Copy phone number"
                      >
                        {copiedId === contact.id ? (
                          <Check className="size-3.5 text-primary" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    </div>

                    {contact.email && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                        <Mail className="size-3.5" />
                        {contact.email}
                      </span>
                    )}
                  </div>

                  {/* Tags */}
                  {contact.tags && contact.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {contact.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{
                            backgroundColor: tag.color + "20",
                            color: tag.color,
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
            {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Merge Contact Modal */}
      {mergeSurvivor && (
        <MergeContactModal
          survivorId={mergeSurvivor.id}
          survivorName={mergeSurvivor.name}
          initialLoser={mergeLoser}
          open={mergeOpen}
          onOpenChange={(open) => {
            setMergeOpen(open);
            if (!open) {
              setMergeSurvivor(null);
              setMergeLoser(null);
            }
          }}
          onSuccess={() => {
            setSelected(new Set());
            fetchContacts();
          }}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Delete Contact</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Delete {selected.size} {selected.size === 1 ? 'Contact' : 'Contacts'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {selected.size} {selected.size === 1 ? 'contact' : 'contacts'}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
