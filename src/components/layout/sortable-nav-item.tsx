"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pin, PinOff, LayoutDashboard } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
}

interface SortableNavItemProps {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  isPinned: boolean;
  isCustomizing: boolean;
  showUnreadDot: boolean;
  totalUnread: number;
  onTogglePin: (href: string) => void;
}

export function SortableNavItem({
  item,
  isActive,
  isCollapsed,
  isPinned,
  isCustomizing,
  showUnreadDot,
  totalUnread,
  onTogglePin,
}: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const linkContent = (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex items-center rounded-xl text-sm font-medium transition-all duration-150 select-none overflow-hidden",
        isCollapsed ? "justify-center px-0 py-2.5 lg:py-2" : "px-2.5 py-2 lg:py-1.5 gap-2",
        isActive
          ? "bg-primary/12 text-primary font-semibold shadow-xs before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r-full before:bg-primary before:shadow-[0_0_8px_var(--color-primary)]"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        isDragging && "opacity-40 scale-[0.98] z-50 bg-accent/60 shadow-md",
        isCustomizing && "border border-dashed border-border/70 hover:border-primary/50"
      )}
    >
      {/* Drag handle visible when customizing or on hover when expanded */}
      {!isCollapsed && isCustomizing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
          title="Drag to reorder"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Main Link Area */}
      <Link
        href={item.href}
        className={cn(
          "flex items-center flex-1 min-w-0 transition-transform duration-150",
          isCollapsed ? "justify-center" : "gap-2.5"
        )}
      >
        <div className="relative flex shrink-0 items-center justify-center transition-transform duration-150 group-hover:scale-105">
          <item.icon
            className={cn(
              "h-4 w-4 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          {showUnreadDot && (
            <span
              aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
              className="absolute -right-1.5 -top-1.5 flex h-2 w-2"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
          )}
        </div>

        <span className={cn("flex-1 truncate tracking-tight text-left", isCollapsed && "lg:hidden")}>
          {item.label}
        </span>

        {item.beta && !isCollapsed && (
          <span
            aria-label="Beta feature"
            className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
          >
            Beta
          </span>
        )}
      </Link>

      {/* Pin button toggle */}
      {!isCollapsed && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTogglePin(item.href);
          }}
          className={cn(
            "p-1 rounded-md transition-all shrink-0",
            isPinned
              ? "text-amber-500 hover:text-amber-600 opacity-100"
              : isCustomizing
              ? "text-muted-foreground/50 hover:text-foreground opacity-100"
              : "text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100"
          )}
          title={isPinned ? "Unpin from favorites" : "Pin to top favorites"}
          aria-label={isPinned ? "Unpin item" : "Pin item"}
        >
          <Pin
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              isPinned ? "fill-amber-500 rotate-45" : "hover:rotate-12"
            )}
          />
        </button>
      )}
    </div>
  );

  return (
    <li className="relative">
      {isCollapsed ? (
        <Tooltip>
          <TooltipTrigger className="w-full">{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            <span>{item.label}</span>
            {isPinned && (
              <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-0.5">
                ★ Pinned
              </span>
            )}
            {item.beta && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                Beta
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      ) : (
        linkContent
      )}
    </li>
  );
}
