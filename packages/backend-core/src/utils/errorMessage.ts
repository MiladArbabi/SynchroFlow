// packages/backend-core/src/utils/errorMessage.ts
//
// getErrorMessage
// ---------------
// Safely extracts a string message from an unknown catch value.
// Use this in every catch block instead of casting to `any`.
//
// Usage: catch (err: unknown) { getErrorMessage(err) }
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}