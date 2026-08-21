# Project Green

A desktop app I made for myself to stay productive. Has a Pomodoro timer, notepad, weekly planner, Google Drive browser, and a local AI assistant.

p.s. Select devices with GPUs are able to use the AI chatbot.. It is still a work in progress.

## Running it

```bash
npm install
npm start
```

## Google Drive

You need to set up a Google OAuth app to use this. Go to console.cloud.google.com, create a project, enable the Google Drive API, and create an OAuth 2.0 credential (Desktop app type). Then copy `src/config.example.js` to `src/config.js` and paste your Client ID and Secret in there. After that anyone using the app just signs in with their Google account normally.

## Music

Uses Jamendo for free music streaming. Get a free Client ID at developer.jamendo.com and paste it in when the music panel asks for it.

## AI Assistant

Needs [Ollama](https://ollama.com) installed locally. Pull the model once with `ollama pull qwen2.5`, then in the app go to the AI panel settings and point it to `http://localhost:11434/api`.

## Building

```bash
npm run build:win
npm run build:linux
```
