import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/views.css';
import './styles/motion.css';
import './styles/delight.css';
import { api } from './services/api.js';
import { player } from './services/player.js';
import { App } from './app/App.jsx';

async function start() {
  const settings = await api.settings.get();
  await player.init(settings);
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App settings={settings} />
    </StrictMode>,
  );
}

start().catch((err) => {
  console.error(err);
  const root = document.getElementById('root');
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `Reson could not start: ${err.message}`;
  root.append(box);
});
