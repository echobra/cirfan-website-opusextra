// src/scripts/main.ts
// Single client entry point, bundled by Astro into one small module.
import { initTheme } from './theme';
import { initMenu } from './menu';
import { initPlayers } from './players';
import { initCopy } from './copy';

initTheme();
initMenu();
initPlayers();
initCopy();
