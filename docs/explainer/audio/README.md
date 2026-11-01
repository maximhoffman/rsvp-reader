# Soundtrack sources

- `narration.txt`: the script, one line per scene (`scene|startSec|endSec|text`).
- `voice1.wav` … `voice6.wav`: the narration, ElevenLabs voice "Matilda" (model eleven_v3), 48 kHz mono; scene 1 time-stretched by 7 % to fit its window.
- `music.mp3`: the 60-second instrumental bed, ElevenLabs Music, prompt: "Minimal modern electronic background music for a 60-second tech product explainer…".

Rebuild the mix and mux it onto the silent render (needs ffmpeg and a Playwright install for the cue times):

```
PLAYWRIGHT_DIR=<pw> node docs/explainer/soundtrack.mjs docs/explainer/audio <workDir> docs/explainer/audio/music.mp3
```

Generated with the owner's ElevenLabs account on a paid plan (commercial license). The API key is never stored in this repository.
