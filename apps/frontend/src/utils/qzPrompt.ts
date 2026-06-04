// apps/frontend/src/utils/qzPrompt.ts
// WM-47 — QZ Tray onboarding prompt localStorage helpers

const STORAGE_KEY = 'lasyncro:qz_tray_prompt_dismissed';

export function hasQzPromptBeenDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissQzPrompt(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // localStorage unavailable — fail silently
  }
}