/* The manager password: needed to draw on the band layer and to edit the
 * setlist. Checked by the API and remembered on this device. */
import { API } from './api.js';
import { el } from './util.js';

const KEY = 'marks:bandKey';   // name kept so devices already signed in stay signed in

export const managerPassword = () => localStorage.getItem(KEY);
export const forgetManagerPassword = () => localStorage.removeItem(KEY);

let dialog = null;
let pending = null;

function build() {
    const input = el('input', {
        attrs: { type: 'password', autocomplete: 'current-password', placeholder: 'סיסמת מנהל', 'aria-label': 'סיסמת מנהל' },
    });
    const error = el('div', { class: 'manager-error', attrs: { role: 'alert' } });
    const form = el('form', { class: 'manager-auth', attrs: { method: 'dialog' } }, [
        el('p', {}, 'הפעולה הזו דורשת סיסמת מנהל.'),
        input,
        error,
        el('div', { class: 'manager-actions' }, [
            el('button', { class: 'manager-btn primary', attrs: { type: 'submit' } }, 'אישור'),
            el('button', { class: 'manager-btn', attrs: { type: 'button' }, on: { click: () => dialog.close() } }, 'ביטול'),
        ]),
    ]);
    dialog = el('dialog', { class: 'manager-dialog', attrs: { 'aria-label': 'סיסמת מנהל' } }, form);
    document.body.append(dialog);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.textContent = '';
        try {
            const res = await fetch(`${API}/auth`, { method: 'POST', headers: { 'X-Band-Key': input.value } });
            if (res.status === 401) {
                error.textContent = 'הסיסמה שגויה.';
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            localStorage.setItem(KEY, input.value);
            pending?.(true);
            pending = null;
            dialog.close();
        } catch {
            error.textContent = 'אין חיבור. נסו שוב כשיש אינטרנט.';
        }
    });
    // Cancel, Escape, or closed after success (then pending is already null).
    dialog.addEventListener('close', () => {
        pending?.(false);
        pending = null;
    });
    return { input, error };
}

/** Resolves true once a correct password is stored, false if cancelled. */
export function askManagerPassword() {
    const { input, error } = dialog ? { input: dialog.querySelector('input'), error: dialog.querySelector('.manager-error') } : build();
    pending?.(false);
    input.value = '';
    error.textContent = '';
    dialog.showModal();
    input.focus();
    return new Promise((resolve) => { pending = resolve; });
}

/** True if a password is stored, or the manager just entered one. */
export async function ensureManager() {
    return !!managerPassword() || askManagerPassword();
}
