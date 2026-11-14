/* Keeps the screen on while a setlist page is visible (Screen Wake Lock API).
 *
 * Safari has it since iOS/iPadOS 16.4 in the browser, and since 18.4 in a Home
 * Screen web app too. The system drops the lock whenever the page is hidden
 * (app switch, screen locked), so it is asked for again each time the page
 * becomes visible. Where a request is refused (no user gesture yet, Low Power
 * Mode) it is retried on the next tap. Without the API this does nothing.
 */

export function keepScreenOn() {
    if (!('wakeLock' in navigator)) return null;
    let lock = null;
    let asking = false;

    const visible = () => document.visibilityState === 'visible';

    async function request() {
        if (lock || asking || !visible()) return;
        asking = true;
        try {
            lock = await navigator.wakeLock.request('screen');
            lock.addEventListener('release', () => { lock = null; });
        } catch {
            lock = null;   // refused for now: the next tap tries again
        } finally {
            asking = false;
        }
    }

    document.addEventListener('visibilitychange', request);
    // Capture phase, so a handler that stops the event can't block it.
    document.addEventListener('pointerdown', request, { capture: true, passive: true });
    document.addEventListener('click', request, { capture: true, passive: true });
    request();

    return { get active() { return !!lock && !lock.released; } };
}
