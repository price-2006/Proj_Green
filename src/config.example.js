/* config.example.js — Credentials template
 *
 * Copy this file to config.js and fill in your values.
 * config.js is gitignored and never committed.
 *
 * To get a Google OAuth Client ID:
 *   1. console.cloud.google.com → create a project
 *   2. APIs & Services → enable Google Drive API
 *   3. Credentials → OAuth 2.0 Client ID → type: Desktop app
 *   4. Copy Client ID and Client Secret into config.js
 */
window.APP_CONFIG = {
  googleDrive: {
    client_id:     'YOUR_GOOGLE_CLIENT_ID',
    client_secret: 'YOUR_GOOGLE_CLIENT_SECRET',
  },
};
