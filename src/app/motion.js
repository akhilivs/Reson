import { flushSync } from 'react-dom';

/** True when the user (or Windows) asked for reduced motion; see themeService.applyPreferences. */
export function prefersReducedMotion() {
  return document.documentElement.dataset.reduceMotion === 'true';
}

/**
 * Applies a React state update inside a View Transition so the browser can animate between the
 * old and new UI (page slides, shared-element morphs). Falls back to an instant update when motion
 * is reduced, the API is unavailable, or the window is hidden (e.g. running in the tray).
 *
 * direction: 'forward' | 'back' | 'up' | 'down' — read by CSS via :root[data-nav-dir].
 */
export function withViewTransition(update, { direction } = {}) {
  const root = document.documentElement;
  if (!document.startViewTransition || prefersReducedMotion() || document.visibilityState !== 'visible') {
    update();
    return;
  }
  if (direction) root.dataset.navDir = direction;
  const transition = document.startViewTransition(() => flushSync(update));
  // Safety net: never let an animation hold the UI (e.g. if frames stop while minimized).
  const guard = setTimeout(() => transition.skipTransition(), 1200);
  const done = () => {
    clearTimeout(guard);
    if (root.dataset.navDir === direction) delete root.dataset.navDir;
  };
  // A transition can be skipped (e.g. superseded by a newer one); that is not an error for us.
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch(() => {});
  transition.finished.then(done, done);
}

/** Temporarily names an element for a shared-element morph into the next view. */
export function nameForTransition(el, name) {
  if (!el) return;
  el.style.viewTransitionName = name;
  setTimeout(() => {
    if (el.isConnected) el.style.viewTransitionName = '';
  }, 1000);
}
