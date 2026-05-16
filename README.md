# Project Green

An all-in-one productivity desktop app built with **Electron** — Apple Sequoia-inspired clean UI.

## Applets

| Applet | Description |
|--------|-------------|
| 🍅 Pomodoro | Focus timer with music player |
| 📝 Notepad | Rich text editor (bold/italic/bullets) — auto-saves |
| 📅 College Planner | Weekly calendar grid with task cards |
| ☁️ Google Drive | Browse and open your Drive files |

## Running the App

```bash
npm install
npm start
```

## Adding Music

Drop `.mp3`, `.wav`, `.ogg`, `.flac`, or `.aac` files into:

```
public/music/
```

They will appear in the Pomodoro → Music player automatically.

## Google Drive Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library** → search "Google Drive API" → **Enable**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Desktop app**
6. Download the credentials JSON — note your **Client ID** and **Client Secret**
7. Open `src/features/drive/drive.js` and replace:
   ```js
   client_id:     'YOUR_GOOGLE_CLIENT_ID',
   client_secret: 'YOUR_GOOGLE_CLIENT_SECRET',
   ```
8. Restart the app and click **Sign in with Google**
9. Authorize in your browser, then paste the code shown back into the app

> **Note**: The redirect URI is set to `urn:ietf:wg:oauth:2.0:oob` (out-of-band) — this shows the auth code directly in the browser so you can paste it into the app.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause Pomodoro timer |
| `R` | Reset timer |
| `S` | Toggle Pomodoro settings |
| `Ctrl+B` | Bold (Notepad) |
| `Ctrl+I` | Italic (Notepad) |
| `Ctrl+U` | Underline (Notepad) |
| `F12` | Toggle DevTools |
| `F11` | Toggle Fullscreen |
