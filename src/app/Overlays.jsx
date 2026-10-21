import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, X, XCircle } from 'lucide-react';
import { toastBus } from './toastBus.js';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

const TOAST_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function Toasts() {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  useEffect(
    () =>
      toastBus.subscribe((t) => {
        setToasts((list) => [...list.slice(-3), t]);
        setTimeout(() => dismiss(t.id), t.duration);
      }),
    [dismiss],
  );
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = TOAST_ICONS[t.type] ?? Info;
        return (
          <div
            key={t.id}
            className={`toast toast--${t.type}`}
            role={t.type === 'error' ? 'alert' : 'status'}
            data-countdown={t.action ? '' : undefined}
            style={t.action ? { '--toast-duration': `${t.duration}ms` } : undefined}
          >
            <Icon size={18} className="toast__icon" aria-hidden />
            <div className="toast__body">
              <div className="toast__title">{t.title}</div>
              {t.message && <div className="toast__message">{t.message}</div>}
            </div>
            {t.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  dismiss(t.id);
                  t.action.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn icon-btn--sm" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs (confirm / prompt)
// ---------------------------------------------------------------------------

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const open = useCallback(
    (config) =>
      new Promise((resolve) => {
        setDialog({ ...config, resolve });
      }),
    [],
  );
  const api = useMemo(
    () => ({
      confirm: (opts) => open({ kind: 'confirm', ...opts }),
      prompt: (opts) => open({ kind: 'prompt', ...opts }),
    }),
    [open],
  );
  const close = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <Dialog dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  );
}

function Dialog({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.initial ?? '');
  const ref = useRef(null);
  const isPrompt = dialog.kind === 'prompt';
  const cancelValue = isPrompt ? null : false;

  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current?.querySelector('input, [data-autofocus]');
    el?.focus();
    el?.select?.();
    return () => prev?.focus?.();
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (isPrompt) {
      if (!value.trim()) return;
      onClose(value.trim());
    } else onClose(true);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose(cancelValue);
    }
    if (e.key === 'Tab') {
      const focusables = [...ref.current.querySelectorAll('button, input')];
      const first = focusables[0];
      const last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose(cancelValue)}>
      <form
        ref={ref}
        className="modal glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onSubmit={submit}
        onKeyDown={onKeyDown}
      >
        <h2 id="dialog-title" className="modal__title">
          {dialog.title}
        </h2>
        {dialog.message && <p className="modal__message">{dialog.message}</p>}
        {isPrompt && (
          <label className="field">
            <span className="field__label">{dialog.label ?? 'Name'}</span>
            <input
              className="input"
              value={value}
              maxLength={dialog.maxLength ?? 120}
              onChange={(e) => setValue(e.target.value)}
              placeholder={dialog.placeholder}
            />
          </label>
        )}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onClose(cancelValue)}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${dialog.danger ? 'btn--danger' : 'btn--primary'}`}
            disabled={isPrompt && !value.trim()}
            data-autofocus={!isPrompt || undefined}
          >
            {dialog.confirmLabel ?? (isPrompt ? 'Save' : 'Confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useDialog() {
  return useContext(DialogContext);
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

const MenuContext = createContext(null);

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null);
  const openMenu = useCallback((event, items) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget?.getBoundingClientRect?.();
    // Keyboard/menu-button invocation has no pointer coordinates: anchor to the element.
    const fromKeyboard = !event.clientX && !event.clientY && rect;
    setMenu({
      x: fromKeyboard ? rect.left : event.clientX,
      y: fromKeyboard ? rect.bottom + 4 : event.clientY,
      items: items.filter(Boolean),
      returnFocus: document.activeElement,
    });
  }, []);
  const close = useCallback(() => {
    setMenu((m) => {
      m?.returnFocus?.focus?.();
      return null;
    });
  }, []);
  return (
    <MenuContext.Provider value={openMenu}>
      {children}
      {menu && <Menu {...menu} onClose={close} />}
    </MenuContext.Provider>
  );
}

export function useContextMenu() {
  return useContext(MenuContext);
}

function Menu({ x, y, items, onClose, level = 0, parentRect }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState(null);
  const actionable = items.map((it, i) => (it.type ? null : i)).filter((i) => i !== null && !items[i].disabled);

  useLayoutEffect(() => {
    const el = ref.current;
    const { width, height } = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (parentRect) {
      left = parentRect.right - 4;
      top = parentRect.top - 6;
      if (left + width > window.innerWidth - 8) left = parentRect.left - width + 4;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    setPos({ left, top, ready: true });
    el.focus();
  }, [x, y, parentRect, level]);

  useEffect(() => {
    if (level !== 0) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.menu')) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [level, onClose]);

  const select = (item) => {
    if (item.disabled) return;
    if (item.submenu) return;
    onClose();
    item.onSelect?.();
  };

  const openSub = (i, el) => {
    const item = items[i];
    if (item?.submenu?.length) setSubmenu({ index: i, rect: el.getBoundingClientRect() });
    else setSubmenu(null);
  };

  const onKeyDown = (e) => {
    const pos = actionable.indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(actionable[(pos + 1) % actionable.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(actionable[(pos - 1 + actionable.length) % actionable.length]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = items[active];
      if (item?.submenu) openSub(active, ref.current.children[active]);
      else if (item) select(item);
    } else if (e.key === 'ArrowRight' && items[active]?.submenu) {
      e.preventDefault();
      openSub(active, ref.current.children[active]);
    } else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && level > 0)) {
      e.preventDefault();
      e.stopPropagation();
      if (level > 0) e.currentTarget.dispatchEvent(new CustomEvent('submenu-close', { bubbles: true }));
      else onClose();
    }
  };

  useEffect(() => {
    if (active >= 0) ref.current?.children[active]?.focus();
  }, [active]);

  return (
    <>
      <div
        ref={ref}
        className="menu glass-panel"
        role="menu"
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.type === 'separator') return <div key={i} className="menu__sep" role="separator" />;
          if (item.type === 'label') return <div key={i} className="menu__label">{item.label}</div>;
          const Icon = item.icon;
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`menu__item${item.danger ? ' menu__item--danger' : ''}${submenu?.index === i ? ' is-open' : ''}`}
              disabled={item.disabled}
              aria-haspopup={item.submenu ? 'menu' : undefined}
              onMouseEnter={(e) => {
                setActive(i);
                openSub(i, e.currentTarget);
              }}
              onClick={(e) => (item.submenu ? openSub(i, e.currentTarget) : select(item))}
            >
              <span className="menu__icon">{Icon && <Icon size={16} />}</span>
              <span className="menu__text">{item.label}</span>
              {item.hint && <span className="menu__hint">{item.hint}</span>}
              {item.submenu && <ChevronRight size={14} className="menu__chevron" />}
            </button>
          );
        })}
      </div>
      {submenu && (
        <div
          onKeyDownCapture={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              const idx = submenu.index;
              setSubmenu(null);
              ref.current?.children[idx]?.focus();
            }
          }}
        >
          <Menu x={0} y={0} items={items[submenu.index].submenu} onClose={onClose} level={level + 1} parentRect={submenu.rect} />
        </div>
      )}
    </>
  );
}
