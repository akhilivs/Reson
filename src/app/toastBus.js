// Tiny event bus so non-React services (e.g. the playback controller) can raise toasts.
const listeners = new Set();
let counter = 0;

export const toastBus = {
  push(toast) {
    const t = { id: ++counter, type: 'info', duration: toast.type === 'error' || toast.action ? 6500 : 3200, ...toast };
    for (const fn of listeners) fn(t);
    return t.id;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
