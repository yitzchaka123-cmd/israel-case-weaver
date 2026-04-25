// Shared "visible models" store. Lets the user hide individual models / engines
// from picker dropdowns across the app WITHOUT disconnecting any provider.
//
// Backend, API keys and routing are untouched — we only filter what shows up
// in the <Select> menus so users aren't overwhelmed by long lists. A model
// already chosen as the active value still appears (with a "(hidden)" hint)
// so existing selections never disappear silently.
//
// The hidden set is stored in localStorage and broadcast via a plain DOM
// event so every picker re-renders immediately when the user toggles one.

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "hidden-models:v1";
const EVENT_NAME = "hidden-models:changed";

export type HiddenSet = ReadonlySet<string>;

function readSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((v) => typeof v === "string"));
  } catch { /* ignore */ }
  return new Set();
}

function writeSet(set: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getHiddenModels(): HiddenSet {
  return readSet();
}

export function isModelHidden(value: string): boolean {
  return readSet().has(value);
}

export function setModelHidden(value: string, hidden: boolean) {
  const set = readSet();
  if (hidden) set.add(value);
  else set.delete(value);
  writeSet(set);
}

export function clearHiddenModels() {
  writeSet(new Set());
}

/** React hook — re-renders whenever the hidden set changes anywhere in the app. */
export function useHiddenModels(): {
  hidden: HiddenSet;
  toggle: (value: string) => void;
  setHidden: (value: string, hidden: boolean) => void;
  clear: () => void;
  isHidden: (value: string) => boolean;
} {
  const [hidden, setHidden] = useState<HiddenSet>(() => readSet());

  useEffect(() => {
    const sync = () => setHidden(readSet());
    window.addEventListener(EVENT_NAME, sync);
    // Cross-tab updates.
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) sync(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const toggle = useCallback((value: string) => {
    const set = readSet();
    if (set.has(value)) set.delete(value);
    else set.add(value);
    writeSet(set);
  }, []);

  return {
    hidden,
    toggle,
    setHidden: setModelHidden,
    clear: clearHiddenModels,
    isHidden: (value: string) => hidden.has(value),
  };
}

/**
 * Filter a list of picker options against the hidden set.
 * - Group headers (`header: true` or value starting with `__`) are kept only
 *   if at least one selectable option below them survived.
 * - The currently-selected value is always preserved so the user never sees
 *   their saved choice disappear.
 */
export function filterModelOptions<T extends { value: string; label: string; header?: boolean }>(
  options: readonly T[],
  hidden: HiddenSet,
  currentValue?: string,
): T[] {
  const isHeader = (o: T) => o.header === true || o.value.startsWith("__");
  // First pass — keep non-hidden + the currently selected value.
  const kept: T[] = [];
  for (const o of options) {
    if (isHeader(o)) { kept.push(o); continue; }
    if (!hidden.has(o.value) || o.value === currentValue) kept.push(o);
  }
  // Second pass — drop headers that no longer have any selectable option after them.
  const result: T[] = [];
  for (let i = 0; i < kept.length; i++) {
    const o = kept[i];
    if (isHeader(o)) {
      // Look ahead until the next header.
      let hasContent = false;
      for (let j = i + 1; j < kept.length; j++) {
        if (isHeader(kept[j])) break;
        hasContent = true;
        break;
      }
      if (!hasContent) continue;
    }
    result.push(o);
  }
  return result;
}
