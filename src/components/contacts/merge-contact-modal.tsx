"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, AlertTriangle, User, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface MergeContactModalProps {
  survivorId: string;
  survivorName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialLoser?: any | null;
}

export function MergeContactModal({ survivorId, survivorName, open, onOpenChange, onSuccess, initialLoser }: MergeContactModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [selectedLoser, setSelectedLoser] = useState<any | null>(initialLoser || null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (open && initialLoser) {
      setSelectedLoser(initialLoser);
    } else if (!open) {
      setSelectedLoser(null);
      setQuery("");
    }
  }, [open, initialLoser]);

  // Debounced search
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          // Filter out the survivor contact from results
          setResults(data.contacts?.filter((c: any) => c.id !== survivorId) || []);
        }
      } catch (err) {
        console.error("Search failed", err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, survivorId]);

  const handleMerge = async () => {
    if (!selectedLoser) return;
    setMerging(true);
    
    try {
      const res = await fetch(`/api/contacts/${survivorId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loserId: selectedLoser.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to merge contacts");
      }

      toast.success("Contacts merged successfully");
      onOpenChange(false);
      if (onSuccess) onSuccess();
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setMerging(false);
    }
  };

  const handleClose = () => {
    if (merging) return;
    setQuery("");
    setSelectedLoser(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge Contact</DialogTitle>
          <DialogDescription>
            Find a duplicate contact to merge into <strong>{survivorName}</strong>.
          </DialogDescription>
        </DialogHeader>

        {!selectedLoser ? (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, or email..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <div className="h-[200px] overflow-y-auto border rounded-md">
              {loading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : results.length > 0 ? (
                <div className="p-1 space-y-1">
                  {results.map((contact) => (
                    <button
                      key={contact.id}
                      onClick={() => setSelectedLoser(contact)}
                      className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors text-left"
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={contact.avatar_url || ""} />
                        <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{contact.name || contact.phone || 'Unnamed'}</p>
                        {(contact.phone || contact.email) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {contact.phone} {contact.phone && contact.email && '•'} {contact.email}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : query.length >= 2 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No other contacts found.
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Start typing to search...
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center p-4 bg-muted/50 rounded-lg border gap-4">
              <div className="flex items-center w-full gap-2">
                <div className="flex-1 p-3 border rounded-md bg-background flex flex-col items-center text-center opacity-70">
                  <span className="text-xs font-semibold text-destructive uppercase mb-1">Loser</span>
                  <Avatar className="h-10 w-10 mb-2">
                    <AvatarImage src={selectedLoser.avatar_url || ""} />
                    <AvatarFallback><User className="h-5 w-5" /></AvatarFallback>
                  </Avatar>
                  <p className="text-sm font-medium truncate w-full">{selectedLoser.name || selectedLoser.phone || 'Unnamed'}</p>
                  <p className="text-xs text-muted-foreground truncate w-full">{selectedLoser.phone || 'No phone'}</p>
                </div>
                
                <ArrowRight className="h-6 w-6 text-muted-foreground shrink-0" />
                
                <div className="flex-1 p-3 border-2 border-primary rounded-md bg-background flex flex-col items-center text-center">
                  <span className="text-xs font-semibold text-primary uppercase mb-1">Survivor</span>
                  <Avatar className="h-10 w-10 mb-2">
                    {/* Assuming we don't have survivor avatar in props, just use fallback */}
                    <AvatarFallback><User className="h-5 w-5" /></AvatarFallback>
                  </Avatar>
                  <p className="text-sm font-medium truncate w-full">{survivorName || 'Unnamed'}</p>
                  <p className="text-xs text-primary/80 truncate w-full">Primary Profile</p>
                </div>
              </div>
            </div>
            
            <div className="bg-destructive/10 border-l-4 border-destructive p-4 rounded-r-md">
              <div className="flex gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                <div className="text-sm text-destructive-foreground">
                  <p className="font-semibold mb-1">Warning: Irreversible Action</p>
                  <p>
                    All conversations, deals, and notes from <strong>{selectedLoser.name || selectedLoser.phone || 'the selected contact'}</strong> will be permanently moved into <strong>{survivorName}</strong>. 
                    The loser profile will be deleted forever.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" onClick={() => selectedLoser ? setSelectedLoser(null) : handleClose()} disabled={merging}>
            {selectedLoser ? "Back to Search" : "Cancel"}
          </Button>
          {selectedLoser && (
            <Button variant="destructive" onClick={handleMerge} disabled={merging}>
              {merging ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Merging...</>
              ) : (
                "Merge Permanently"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
