"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { arrayMove } from "@dnd-kit/sortable";

export const DEFAULT_CUSTOMIZABLE_HREFS = [
  "/inbox",
  "/team-chat",
  "/contacts",
  "/pipelines",
  "/quotations",
  "/broadcasts",
  "/action-items",
  "/automations",
  "/flows",
  "/team-action-items",
  "/knowledge-bases",
];

const STORAGE_KEY_PREFIX = "wacrm_sidebar_nav";

/**
 * Reorders hrefs array moving activeHref to the position of overHref.
 */
export function reorderNavHrefs(
  order: string[],
  activeHref: string,
  overHref: string
): string[] {
  if (activeHref === overHref) return order;
  const oldIndex = order.indexOf(activeHref);
  const newIndex = order.indexOf(overHref);
  if (oldIndex === -1 || newIndex === -1) return order;
  return arrayMove(order, oldIndex, newIndex);
}

/**
 * Toggles an item in the pinned list.
 */
export function togglePinnedHref(pinned: string[], href: string): string[] {
  if (pinned.includes(href)) {
    return pinned.filter((h) => h !== href);
  }
  return [...pinned, href];
}

/**
 * When an item is newly pinned, moves it to the top of the order list.
 */
export function applySidebarPinOrder(order: string[], href: string): string[] {
  const remaining = order.filter((h) => h !== href);
  return [href, ...remaining];
}

/**
 * Merges stored order with system defaults so any new routes are preserved.
 */
export function mergeNavHrefsWithDefaults(savedOrder: string[]): string[] {
  const validSet = new Set(DEFAULT_CUSTOMIZABLE_HREFS);
  const filtered = savedOrder.filter((href) => validSet.has(href));
  const missing = DEFAULT_CUSTOMIZABLE_HREFS.filter((href) => !filtered.includes(href));
  return [...filtered, ...missing];
}

export function useSidebarPreferences(userId?: string) {
  const [order, setOrder] = useState<string[]>(DEFAULT_CUSTOMIZABLE_HREFS);
  const [pinned, setPinned] = useState<string[]>([]);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const storageKey = useMemo(() => {
    return `${STORAGE_KEY_PREFIX}_${userId || "default"}`;
  }, [userId]);

  // Load preferences from localStorage on mount or when userId changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedOrderRaw = window.localStorage.getItem(`${storageKey}_order`);
      const storedPinnedRaw = window.localStorage.getItem(`${storageKey}_pinned`);

      if (storedOrderRaw) {
        const parsedOrder = JSON.parse(storedOrderRaw) as string[];
        if (Array.isArray(parsedOrder)) {
          setOrder(mergeNavHrefsWithDefaults(parsedOrder));
        }
      } else {
        setOrder(DEFAULT_CUSTOMIZABLE_HREFS);
      }

      if (storedPinnedRaw) {
        const parsedPinned = JSON.parse(storedPinnedRaw) as string[];
        if (Array.isArray(parsedPinned)) {
          setPinned(parsedPinned.filter((h) => DEFAULT_CUSTOMIZABLE_HREFS.includes(h)));
        }
      } else {
        setPinned([]);
      }
    } catch (e) {
      console.warn("Failed to read sidebar preferences from localStorage", e);
    } finally {
      setIsLoaded(true);
    }
  }, [storageKey]);

  const reorder = useCallback(
    (activeHref: string, overHref: string) => {
      setOrder((prev) => {
        const updated = reorderNavHrefs(prev, activeHref, overHref);
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(`${storageKey}_order`, JSON.stringify(updated));
          } catch (e) {
            console.warn("Failed to save sidebar order to localStorage", e);
          }
        }
        return updated;
      });
    },
    [storageKey]
  );

  const togglePin = useCallback(
    (href: string) => {
      setPinned((prevPinned) => {
        const isPinned = prevPinned.includes(href);
        const updatedPinned = togglePinnedHref(prevPinned, href);

        setOrder((prevOrder) => {
          if (!isPinned) {
            const newOrder = applySidebarPinOrder(prevOrder, href);
            if (typeof window !== "undefined") {
              try {
                window.localStorage.setItem(`${storageKey}_order`, JSON.stringify(newOrder));
              } catch (e) {}
            }
            return newOrder;
          }
          return prevOrder;
        });

        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(`${storageKey}_pinned`, JSON.stringify(updatedPinned));
          } catch (e) {}
        }
        return updatedPinned;
      });
    },
    [storageKey]
  );

  const resetToDefault = useCallback(() => {
    setOrder(DEFAULT_CUSTOMIZABLE_HREFS);
    setPinned([]);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(`${storageKey}_order`);
        window.localStorage.removeItem(`${storageKey}_pinned`);
      } catch (e) {
        console.warn("Failed to clear sidebar preferences", e);
      }
    }
  }, [storageKey]);

  const hasCustomization = useMemo(() => {
    if (pinned.length > 0) return true;
    if (order.length !== DEFAULT_CUSTOMIZABLE_HREFS.length) return true;
    return order.some((href, idx) => href !== DEFAULT_CUSTOMIZABLE_HREFS[idx]);
  }, [order, pinned]);

  return {
    order,
    pinned,
    isCustomizing,
    setIsCustomizing,
    reorder,
    togglePin,
    resetToDefault,
    hasCustomization,
    isLoaded,
  };
}
