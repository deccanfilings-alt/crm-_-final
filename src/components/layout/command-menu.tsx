"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, User, DollarSign, CheckSquare, Compass, Loader2 } from "lucide-react";

interface SearchResults {
  contacts: any[];
  deals: any[];
  action_items: any[];
}

const NAVIGATION_ITEMS = [
  { title: "Inbox", href: "/inbox", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Dashboard", href: "/dashboard", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Contacts", href: "/contacts", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Pipelines", href: "/pipelines", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Action Items", href: "/action-items", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Broadcasts", href: "/broadcasts", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Automations", href: "/automations", icon: <Compass className="mr-2 h-4 w-4" /> },
  { title: "Settings", href: "/settings", icon: <Compass className="mr-2 h-4 w-4" /> },
];

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults>({ contacts: [], deals: [], action_items: [] });

  // Toggle with Cmd+K or Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults({ contacts: [], deals: [], action_items: [] });
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error("Search failed", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  }, [router]);

  // Client-side filter navigation items
  const navResults = query
    ? NAVIGATION_ITEMS.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
    : NAVIGATION_ITEMS;

  const hasResults =
    results.contacts.length > 0 ||
    results.deals.length > 0 ||
    results.action_items.length > 0 ||
    navResults.length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 max-w-2xl gap-0">
        <div className="flex items-center border-b border-border px-4 py-3">
          <Search className="mr-2 h-5 w-5 shrink-0 text-muted-foreground opacity-50" />
          <input
            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Search contacts, deals, tasks, or pages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>
        
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!query && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Type to start searching...
            </div>
          )}

          {query && !hasResults && !loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found for "{query}".
            </div>
          )}

          {/* Navigation */}
          {navResults.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Navigation</div>
              {navResults.map((item) => (
                <button
                  key={item.href}
                  onClick={() => handleSelect(item.href)}
                  className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-muted hover:text-accent-foreground transition-colors"
                >
                  {item.icon}
                  {item.title}
                </button>
              ))}
            </div>
          )}

          {/* Contacts */}
          {results.contacts.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Contacts</div>
              {results.contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => handleSelect(`/contacts`)}
                  className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-muted transition-colors"
                >
                  <User className="mr-2 h-4 w-4 text-primary" />
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="font-medium truncate">{contact.name || contact.phone}</span>
                    <span className="text-xs text-muted-foreground truncate">{contact.email || contact.instagram_username || "No details"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Deals */}
          {results.deals.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Deals</div>
              {results.deals.map((deal) => (
                <button
                  key={deal.id}
                  onClick={() => handleSelect(`/pipelines`)}
                  className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-muted transition-colors"
                >
                  <DollarSign className="mr-2 h-4 w-4 text-emerald-500" />
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="font-medium truncate">{deal.title}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      ${deal.value} • {deal.contact?.name || "Unknown"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Action Items */}
          {results.action_items.length > 0 && (
            <div>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Tasks</div>
              {results.action_items.map((task) => (
                <button
                  key={task.id}
                  onClick={() => handleSelect(`/action-items`)}
                  className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-muted transition-colors"
                >
                  <CheckSquare className="mr-2 h-4 w-4 text-blue-500" />
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="font-medium truncate">{task.title}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {task.status.toUpperCase()} • {task.contact?.name || "General"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
