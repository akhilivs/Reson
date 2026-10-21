import { useEffect, useRef, useState } from 'react';

/** YouTube-style on-screen badge confirming a keyboard action ("+5s · 1:23", "Volume 60%"). */
export function KeyFeedback() {
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    const onOsd = (e) => {
      clearTimeout(timer.current);
      // A new key replaces the badge and restarts its animation (key changes every time).
      setMsg({ ...e.detail, id: Date.now() });
      timer.current = setTimeout(() => setMsg(null), 900);
    };
    window.addEventListener('brook:osd', onOsd);
    return () => {
      window.removeEventListener('brook:osd', onOsd);
      clearTimeout(timer.current);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className="osd" key={msg.id} role="status" aria-live="polite">
      {msg.icon && <span className="osd__icon" aria-hidden>{msg.icon}</span>}
      <span>{msg.text}</span>
    </div>
  );
}
