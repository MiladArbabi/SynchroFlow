// apps/mobile/src/hooks/useForegroundToast.ts
//
// Foreground notification toast — §4 contract.
// Non-blocking: never navigates, never interrupts an active scan session.

import { useState, useCallback } from 'react';

export type ToastMessage = { title: string; body: string } | null;

export function useForegroundToast() {
  const [toast, setToast] = useState<ToastMessage>(null);

  const show = useCallback((title: string, body: string) => {
    setToast({ title, body });
    setTimeout(() => setToast(null), 3_500);
  }, []);

  return { toast, show };
}