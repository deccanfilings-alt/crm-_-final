"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Download,
  Eye,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { Lock } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{label} unavailable</span>
    </div>
  );
}

function getExtensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/ogg":
      return ".ogg";
    case "audio/aac":
      return ".aac";
    case "audio/wav":
      return ".wav";
    case "audio/ogg; codecs=opus":
    case "audio/ogg;codecs=opus":
    case "audio/opus":
      return ".ogg";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}

async function handleDownload(url: string, defaultFilename: string) {
  try {
    let downloadUrl = url;
    let filename = defaultFilename;

    if (url.startsWith("/api/whatsapp/media/")) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch media");
      const blob = await res.blob();
      downloadUrl = URL.createObjectURL(blob);

      const hasExtension = filename.includes(".");
      if (!hasExtension && blob.type) {
        const ext = getExtensionFromMime(blob.type);
        filename = `${filename}${ext}`;
      }
    } else {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          downloadUrl = URL.createObjectURL(blob);
          const hasExtension = filename.includes(".");
          if (!hasExtension && blob.type) {
            const ext = getExtensionFromMime(blob.type);
            filename = `${filename}${ext}`;
          }
        }
      } catch (e) {
        console.warn("CORS fetch failed, falling back to direct download link", e);
      }
    }

    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (downloadUrl.startsWith("blob:")) {
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);
    }
  } catch (error) {
    console.error("Download failed:", error);
    toast.error("Failed to download media file");
  }
}

interface MediaPreviewModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  type: "image" | "video";
  filename: string;
}

function MediaPreviewModal({
  isOpen,
  onOpenChange,
  url,
  type,
  filename,
}: MediaPreviewModalProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    let localBlobUrl = "";
    setLoading(true);
    setError(false);

    const load = async () => {
      if (url.startsWith("/api/whatsapp/media/")) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed to load preview");
          const blob = await res.blob();
          if (active) {
            localBlobUrl = URL.createObjectURL(blob);
            setSrc(localBlobUrl);
          }
        } catch {
          if (active) setError(true);
        } finally {
          if (active) setLoading(false);
        }
      } else {
        if (active) {
          setSrc(url);
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      active = false;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [url, isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl w-full border-none bg-black/90 p-0 text-white shadow-2xl ring-0 focus-visible:outline-none overflow-hidden"
        showCloseButton={true}
      >
        <DialogTitle className="sr-only font-heading">Media Preview - {filename}</DialogTitle>
        <div className="relative flex flex-col items-center justify-center p-6 min-h-[60vh] max-h-[85vh]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <ImageOff className="h-12 w-12 text-zinc-500" />
              <p className="text-sm text-zinc-400">Failed to load preview</p>
            </div>
          )}

          {!loading && !error && src && (
            <div className="flex-1 flex items-center justify-center w-full h-full overflow-hidden">
              {type === "image" ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={src}
                  alt={filename}
                  className="max-h-[70vh] max-w-full rounded-lg object-contain select-none shadow-lg animate-in fade-in zoom-in duration-200"
                />
              ) : (
                <video
                  src={src}
                  controls
                  autoPlay
                  className="max-h-[70vh] max-w-full rounded-lg object-contain shadow-lg animate-in fade-in zoom-in duration-200"
                />
              )}
            </div>
          )}

          {/* Controls footer */}
          <div className="mt-4 flex items-center justify-between w-full border-t border-zinc-800 pt-4 px-2 bg-black/40 backdrop-blur-sm">
            <span className="text-xs text-zinc-400 truncate max-w-[70%] font-medium">
              {filename}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(url, filename)}
              className="border-zinc-700 bg-zinc-800/50 text-white hover:bg-zinc-800 hover:text-white"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MediaWrapper({
  children,
  url,
  type,
  filename,
}: {
  children: React.ReactNode;
  url: string;
  type: "image" | "video";
  filename: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="group relative inline-block overflow-hidden rounded-lg">
      <div
        onClick={type === "image" ? () => setModalOpen(true) : undefined}
        className={cn(type === "image" && "cursor-pointer hover:brightness-95 transition-all")}
      >
        {children}
      </div>

      {/* Floating controls in top-right */}
      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-10">
        <Button
          variant="secondary"
          size="icon-xs"
          className="h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-white border-none shadow-md backdrop-blur-xs"
          onClick={(e) => {
            e.stopPropagation();
            setModalOpen(true);
          }}
          title="Preview"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="secondary"
          size="icon-xs"
          className="h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-white border-none shadow-md backdrop-blur-xs"
          onClick={(e) => {
            e.stopPropagation();
            handleDownload(url, filename);
          }}
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      <MediaPreviewModal
        isOpen={modalOpen}
        onOpenChange={setModalOpen}
        url={url}
        type={type}
        filename={filename}
      />
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <img
      src={src ?? ""}
      alt={alt}
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function MessageContent({ message }: { message: Message }) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image": {
      const filename = message.content_text
        ? `${message.content_text.substring(0, 20)}`
        : `image_${message.id.substring(0, 8)}`;
      return (
        <div>
          {message.media_url ? (
            <MediaWrapper
              url={message.media_url}
              type="image"
              filename={filename}
            >
              <MediaImage url={message.media_url} alt="Shared image" />
            </MediaWrapper>
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );
    }

    case "video": {
      const filename = message.content_text
        ? `${message.content_text.substring(0, 20)}`
        : `video_${message.id.substring(0, 8)}`;
      return (
        <div>
          {message.media_url ? (
            <MediaWrapper
              url={message.media_url}
              type="video"
              filename={filename}
            >
              <video
                src={message.media_url}
                controls
                className="max-h-64 max-w-60 rounded-lg object-cover"
              />
            </MediaWrapper>
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );
    }

    case "audio": {
      const filename = `audio_${message.id.substring(0, 8)}`;
      return (
        <div className="flex items-center gap-2">
          {message.media_url ? (
            <>
              <audio src={message.media_url} controls className="max-w-60" />
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "h-8 w-8 rounded-full shrink-0 transition-colors",
                  isAgent
                    ? "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
                )}
                onClick={() => handleDownload(message.media_url!, filename)}
                title="Download Audio"
              >
                <Download className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );
    }

    case "document": {
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      const filename = message.content_text || "document";
      return (
        <div className="flex items-center gap-2">
          <a
            href={message.media_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              handleDownload(message.media_url!, filename);
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors w-full max-w-60 min-w-40 border",
              isAgent
                ? "bg-primary-foreground/10 border-primary-foreground/20 hover:bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted/50 border-muted hover:bg-muted text-foreground"
            )}
          >
            <FileText className={cn("h-5 w-5 shrink-0", isAgent ? "text-primary-foreground/80" : "text-muted-foreground")} />
            <span className="truncate flex-1 font-medium text-left">
              {filename}
            </span>
            <Download className={cn("h-4 w-4 shrink-0", isAgent ? "text-primary-foreground/75" : "text-muted-foreground")} />
          </a>
        </div>
      );
    }

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            Template
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || "[Interactive reply]"}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || "[Unsupported message type]"}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          message.is_internal
            ? "rounded-br-md bg-yellow-100 text-yellow-900 border border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-100 dark:border-yellow-700"
            : isAgent
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {message.is_internal && (
          <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
            <Lock className="h-3 w-3" />
            Internal Note
          </div>
        )}
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span
            className={cn(
              "ml-2 text-[10px]",
              message.is_internal
                ? "text-yellow-600/70 dark:text-yellow-400/70"
                : isAgent
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && !message.is_internal && (
            <span className="ml-1">
              <StatusIcon status={message.status} />
            </span>
          )}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
