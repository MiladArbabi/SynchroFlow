// modules/wms/src/ui/hooks/useWebPush.ts
import { useEffect, useRef } from 'react';
/**
 * WEB PUSH SUBSCRIPTION HOOK (WM-22)
 * ------------------------------------
 * Registers the browser for Web Push notifications on first WMS load.
 *
 * Flow:
 * 1. Check browser support (serviceWorker + PushManager)
 * 2. Request notification permission if not yet granted
 * 3. Subscribe via PushManager with VAPID public key
 * 4. POST subscription to /api/v1/notifications/subscribe/web
 *
 * Idempotent — safe to call on every mount:
 * - If already subscribed, PushManager returns existing subscription
 * - Backend upserts on (user_id, endpoint) — no duplicates
 *
 * VITE_VAPID_PUBLIC_KEY must be set in .env
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const arr = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++)
        arr[i] = rawData.charCodeAt(i);
    return arr.buffer;
}
export function useWebPush({ httpPost, enabled = true }) {
    const registered = useRef(false);
    useEffect(() => {
        if (!enabled || registered.current)
            return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.info('[WEB_PUSH] Not supported in this browser');
            return;
        }
        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
            console.warn('[WEB_PUSH] VITE_VAPID_PUBLIC_KEY not set — skipping subscription');
            return;
        }
        const register = async () => {
            try {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.info('[WEB_PUSH] Notification permission denied');
                    return;
                }
                const reg = await navigator.serviceWorker.ready;
                const subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidKey),
                });
                const json = subscription.toJSON();
                await httpPost('/api/v1/notifications/subscribe/web', {
                    endpoint: json.endpoint,
                    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
                });
                registered.current = true;
                console.info('[WEB_PUSH] Subscription registered');
            }
            catch (err) {
                console.error('[WEB_PUSH] Subscription failed:', err.message);
            }
        };
        register();
    }, [enabled, httpPost]);
}
//# sourceMappingURL=useWebPush.js.map