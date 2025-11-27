/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/utils/sessionUtils.ts
export const generateSessionId = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `session_${timestamp}_${random}`;
};

export const getFingerprint = (): string => {
  const components = [
    navigator.userAgent,
    navigator.language,
    (navigator as any).languages?.join(','),
    navigator.platform,
    (navigator as any).hardwareConcurrency,
    (navigator as any).deviceMemory,
    screen.width,
    screen.height,
    screen.colorDepth,
  ].join('|');

  // Simple hash function for fingerprint
  let hash = 0;
  for (let i = 0; i < components.length; i++) {
    const char = components.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `fp_${Math.abs(hash).toString(16)}`;
};

export const shouldCreateNewSession = (session: any): boolean => {
  if (!session || !session.sessionId || !session.fingerprint || !session.createdAt) {
    return true;
  }
  return isSessionExpired(session);
};

export const isSessionExpired = (session: any): boolean => {
  if (!session?.createdAt) return true;
  const sessionAge = Date.now() - session.createdAt;
  return sessionAge > 3 * 60 * 60 * 1000; // 3 hours
};