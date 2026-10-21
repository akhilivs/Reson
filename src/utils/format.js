export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatLongDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function plural(n, word, pluralWord = word + 's') {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return formatDate(ts);
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Yohohoho, still up?'; // the Soul King keeps late hours
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function trackFormatLabel(t) {
  const codec = t.codec?.replace('MPEG 1 Layer 3', 'MP3') ?? '';
  const rate = t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1).replace('.0', '')} kHz` : '';
  return [codec, rate].filter(Boolean).join(' · ');
}
