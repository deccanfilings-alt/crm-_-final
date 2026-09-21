"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  KeyboardEvent,
} from "react";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import { ReplyQuote } from "./reply-quote";
import type { CannedResponse } from "@/types";

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = "image" | "video" | "document" | "audio";

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = "chat-media";

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string, isInternal?: boolean) => void;
  onSendMedia: (payload: SendMediaPayload & { isInternal?: boolean }) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  onTyping?: (isTyping: boolean) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
  onTyping,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftRef = useRef<MediaDraft | null>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedFilter, setCannedFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    fetch("/api/canned-responses")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setCannedResponses(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (sessionExpired && !isInternal) return; // Cannot send to customer if session expired

    setSending(true);
    // Let the parent manage the Promise so the UI is snappy;
    // clearing the text immediately is standard chat UX.
    onSend(trimmed, replyTo?.id, isInternal);
    setText("");
    onClearReply?.();
    setSending(false);
    
    if (onTyping) onTyping(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    
    textareaRef.current?.focus();
  }, [text, sending, sessionExpired, isInternal, onSend, replyTo?.id, onClearReply, onTyping]);

  const filteredCanned = cannedResponses.filter((c) =>
    c.shortcut.toLowerCase().includes(cannedFilter) || 
    c.content.toLowerCase().includes(cannedFilter)
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showCanned && filteredCanned.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCanned.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          setText(filteredCanned[selectedIndex].content);
          setShowCanned(false);
          setTimeout(adjustHeight, 0);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowCanned(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showCanned, filteredCanned, selectedIndex, adjustHeight]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();

      const val = e.target.value;
      if (val.startsWith("/")) {
        setShowCanned(true);
        setCannedFilter(val.slice(1).toLowerCase());
        setSelectedIndex(0);
      } else {
        setShowCanned(false);
      }

      if (onTyping) {
        onTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => {
          onTyping(false);
        }, 3000);
      }
    },
    [adjustHeight, onTyping]
  );

  const handleAiSuggest = useCallback(async () => {
    if (sessionExpired || aiSuggesting) return;
    setAiSuggesting(true);
    try {
      const res = await fetch(`/api/whatsapp/conversations/${conversationId}/ai-suggest`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate AI suggestion");
      setText(data.suggestion);
      // Wait for React to apply text, then resize box
      setTimeout(adjustHeight, 0);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate AI suggestion");
    } finally {
      setAiSuggesting(false);
    }
  }, [conversationId, sessionExpired, aiSuggesting, adjustHeight]);

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
            max / 1024 / 1024,
          )} MB.`,
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({ kind, mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged],
  );

  const handlePicked = useCallback(
    (kind: "image" | "video" | "document", file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload],
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
        type: "audio/ogg",
      });
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error("Recording is too long (over 16 MB).");
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        removeStaged(draftRef.current?.path);
        setDraft({ kind: "audio", mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged],
  );

  const startRecording = useCallback(async () => {
    if ((!isInternal && sessionExpired) || busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error("Microphone access denied or unavailable.");
    }
  }, [isInternal, sessionExpired, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(() => {
    if (!draft || busy) return;
    onSendMedia({
      kind: draft.kind,
      mediaUrl: draft.mediaUrl,
      path: draft.path,
      // Audio takes no caption (Meta rejects it). Everything else: the
      // trimmed caption, or undefined when blank.
      caption:
        draft.kind === "audio" ? undefined : draft.caption.trim() || undefined,
      filename: draft.kind === "document" ? draft.filename : undefined,
      replyToId: replyTo?.id,
      isInternal,
    });
    // The object is now owned by the sent message — clear without GC.
    setDraft(null);
    onClearReply?.();
  }, [draft, busy, onSendMedia, replyTo?.id, onClearReply, isInternal]);

  // Discard GCs the staged object — it was uploaded but never sent.
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path);
    setDraft(null);
  }, [draft?.path, removeStaged]);

  const setCaption = useCallback((caption: string) => {
    setDraft((d) => (d ? { ...d, caption } : d));
  }, []);

  // ---- Render --------------------------------------------------------

  return (
    <div className="border-t border-border bg-card">
      {replyTo && (
        <div className="p-3 pb-0">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          handlePicked("image", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked("video", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked("document", e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="flex w-full items-center gap-4 py-2 px-3">
        <div className="flex items-center gap-1">
          <button 
            type="button" 
            onClick={() => setIsInternal(false)} 
            className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", !isInternal ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            Reply
          </button>
          <button 
            type="button" 
            onClick={() => setIsInternal(true)} 
            className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", isInternal ? "bg-yellow-500 text-white" : "text-muted-foreground hover:bg-muted")}
          >
            Internal Note
          </button>
        </div>
      </div>

      {draft ? (
        <div className="p-3">
          <MediaDraftPreview
            draft={draft}
            busy={busy}
            readOnly={readOnly}
            onCaptionChange={setCaption}
            onDiscard={discardDraft}
            onSend={sendDraft}
          />
        </div>
      ) : recording ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5 m-3">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="flex-1 text-sm text-foreground">
            Recording… {formatDuration(recordSeconds)} /{" "}
            {formatDuration(MAX_RECORDING_SECONDS)}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
          >
            Cancel
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90"
            title="Stop and attach"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-end gap-2 px-3 pb-3">
          {/* Attach menu — photo / video / document / voice. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={(!isInternal && sessionExpired) || busy || !canSend}
              title={
                !canSend
                  ? "Read-only — your role can't send messages"
                  : (!isInternal && sessionExpired)
                    ? "Session expired - use a template"
                    : "Attach media"
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                Photo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                Video
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" />
                Document
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void startRecording()}>
                <Mic className="mr-2 h-4 w-4" />
                Voice note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            title={readOnly ? undefined : "Send template"}
            className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="h-4 w-4" />
          </GatedButton>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={(!isInternal && sessionExpired) || aiSuggesting}
            title={readOnly ? undefined : "Generate AI Reply"}
            className={cn(
              "h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-purple-500",
              aiSuggesting && "animate-pulse text-purple-500"
            )}
            onClick={handleAiSuggest}
          >
            {aiSuggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </GatedButton>

          <div className="relative flex-1">
            {showCanned && filteredCanned.length > 0 && (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-full max-w-sm rounded-lg border bg-popover text-popover-foreground shadow-md outline-none animate-in slide-in-from-bottom-2 max-h-64 overflow-y-auto">
                <div className="p-1">
                  {filteredCanned.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded-sm px-2 py-1.5 text-sm outline-none",
                        i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-foreground"
                      )}
                      onClick={() => {
                        setText(c.content);
                        setShowCanned(false);
                        setTimeout(adjustHeight, 0);
                        textareaRef.current?.focus();
                      }}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      <span className="font-semibold text-primary">{c.shortcut}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground text-left">{c.content}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={
                readOnly
                  ? "Read-only — viewers can browse but not reply"
                  : (!isInternal && sessionExpired)
                    ? "Session expired - use a template"
                    : isInternal 
                      ? "Type an internal note... (only visible to team)" 
                      : "Type a message... (Shift+Enter for new line)"
              }
              disabled={(!isInternal && sessionExpired) || readOnly}
              rows={1}
              // Textarea keeps its own inline title — the GatedButton
              // wrapping pattern doesn't apply to non-button inputs.
              // The placeholder text also surfaces the read-only state.
              title={readOnly ? "Read-only — your role can't send messages" : undefined}
              className={cn(
                "w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary/50",
                (!isInternal && sessionExpired || readOnly) ? "cursor-not-allowed opacity-50 bg-muted text-foreground placeholder-muted-foreground" : 
                isInternal ? "bg-yellow-500/10 text-yellow-900 dark:text-yellow-100 placeholder-yellow-700/50 border-yellow-500/30 focus:border-yellow-500/50" : "bg-muted text-foreground placeholder-muted-foreground",
              )}
            />
          </div>

          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || (!isInternal && sessionExpired) || sending}
            onClick={handleSend}
            className={cn("h-9 w-9 shrink-0 p-0 disabled:opacity-40", isInternal ? "bg-yellow-500 hover:bg-yellow-600 text-white" : "bg-primary hover:bg-primary/90 text-primary-foreground")}
          >
            <Send className="h-4 w-4" />
          </GatedButton>
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge. */}
      {!sessionExpired && !draft && !recording && (
        <p className="mt-1 pl-[5.5rem] text-[10px] text-muted-foreground">
          Type &apos;/&apos; for quick replies
        </p>
      )}
    </div>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  draft,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
}: {
  draft: MediaDraft;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === "video" && (
            <video src={draft.mediaUrl} controls className="max-h-40 rounded-lg" />
          )}
          {draft.kind === "audio" && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === "document" && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          aria-label="Remove attachment"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {draft.kind !== "audio" && (
          <input
            value={draft.caption}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Add a caption…"
            className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50"
          />
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy}
          onClick={onSend}
          className={cn(
            "h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40",
            draft.kind === "audio" && "ml-auto",
          )}
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>
    </div>
  );
}
