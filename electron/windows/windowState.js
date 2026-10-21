import fs from 'node:fs';
import path from 'node:path';

/**
 * Returns bounds that are guaranteed to be meaningfully visible on one of the displays.
 * If the saved bounds no longer intersect any work area (monitor unplugged, resolution change),
 * the window is centered on the primary display instead.
 */
export function ensureVisible(bounds, displays, defaults) {
  const primary = displays.find((d) => d.primary) ?? displays[0];
  const center = (size) => {
    const wa = primary.workArea;
    const width = Math.min(size.width, wa.width);
    const height = Math.min(size.height, wa.height);
    return {
      width,
      height,
      x: Math.round(wa.x + (wa.width - width) / 2),
      y: Math.round(wa.y + (wa.height - height) / 2),
    };
  };
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return center(defaults);
  const width = Math.max(defaults.minWidth ?? 200, bounds.width);
  const height = Math.max(defaults.minHeight ?? 100, bounds.height);
  for (const d of displays) {
    const wa = d.workArea;
    const ix = Math.min(bounds.x + width, wa.x + wa.width) - Math.max(bounds.x, wa.x);
    const iy = Math.min(bounds.y + height, wa.y + wa.height) - Math.max(bounds.y, wa.y);
    // Require the title area to be reachable: at least 80px wide and 40px tall visible.
    if (ix >= Math.min(80, width) && iy >= Math.min(40, height) && bounds.y >= wa.y - 10) {
      return { x: bounds.x, y: bounds.y, width: Math.min(width, wa.width), height: Math.min(height, wa.height) };
    }
  }
  return center({ width, height });
}

export class WindowStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = {};
    try {
      this.state = JSON.parse(fs.readFileSync(filePath, 'utf8')) ?? {};
    } catch {
      this.state = {};
    }
    this.timer = null;
  }

  get(name) {
    return this.state[name] ?? null;
  }

  /** Tracks a window's geometry and saves it (debounced) when moved/resized/closed. */
  track(name, win) {
    const save = () => {
      if (win.isDestroyed()) return;
      const prev = this.state[name] ?? {};
      const maximized = win.isMaximized();
      this.state[name] = {
        bounds: maximized || win.isMinimized() ? prev.bounds : win.getBounds(),
        maximized,
      };
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 400);
    };
    for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'close']) win.on(ev, save);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.warn('Could not persist window state:', err.message);
    }
  }
}
