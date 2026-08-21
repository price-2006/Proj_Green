/* music-player-entry.js — Entry point for the Jamendo music player module.
 * This is loaded as type="module" from index.html.
 * It calls init() after DOMContentLoaded and wires up external link handling.
 */

import { init } from './music-player.js';

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Open Jamendo developer link in system browser (not in the app)
  ['music-jamendo-link', 'music-jamendo-link-footer'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI?.driveOpenUrl?.('https://developer.jamendo.com/v3.0');
    });
  });
});
