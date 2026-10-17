import { useCallback, useState } from "react";
import type { CardCondition } from "../types";

// The condition cards go in as when nobody graded them: chosen once in Quick
// approve or in the review screen, and remembered on this device (most
// batches are one condition). Storage may be unavailable (private mode), so
// every access is guarded and NM is the fallback.

const KEY = "gg-scan-default-condition";
const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

function load(): CardCondition {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value && (CONDITIONS as string[]).includes(value)) return value as CardCondition;
  } catch {
    // Storage blocked: use the default.
  }
  return "NM";
}

export function useDefaultCondition(): [CardCondition, (next: CardCondition) => void] {
  const [condition, setCondition] = useState<CardCondition>(load);
  const update = useCallback((next: CardCondition) => {
    setCondition(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Not remembered, but still used for this visit.
    }
  }, []);
  return [condition, update];
}
