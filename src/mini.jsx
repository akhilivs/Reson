import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/mini.css';
import './styles/motion.css';
import { MiniPlayer } from './features/mini-player/MiniPlayer.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MiniPlayer />
  </StrictMode>,
);
