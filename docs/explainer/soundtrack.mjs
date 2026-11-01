// Builds docs/explainer/soundtrack.m4a (voice + synthesized music bed + SFX) with
// ffmpeg, and muxes it onto the silent video.
//
//   PLAYWRIGHT_DIR=/tmp/pw node docs/explainer/soundtrack.mjs <audioDir> <workDir> [musicFile]
// With <musicFile> (any audio ffmpeg reads, e.g. an ElevenLabs Music MP3) that track is the
// bed: trimmed or padded to 60 s, levelled, faded. Without it the bed is synthesized below.
//
// <audioDir> holds voice1.wav … voice6.wav and narration.txt (scene|start|end|text);
// each clip starts at its scene's start second. Stems go to <workDir>/stems.
// SFX times are read from the page itself (window.__soundEvents in index.html),
// which derives them from the same word schedules the picture uses.
// <workDir>/explainer-silent.mp4 is the video without sound; when it is missing,
// the current rsvp-reader-explainer.mp4 is copied there first.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [audioDir, workDir, musicFile] = process.argv.slice(2)
if (!audioDir || !workDir) throw new Error('usage: node soundtrack.mjs <audioDir> <workDir>')
const stems = join(workDir, 'stems')
mkdirSync(stems, { recursive: true })

const SR = 48000
const DUR = 60
const TARGET_MIX = -14
const TARGET_VOICE = -16
const TARGET_MUSIC = -26
const TP_MAX = -1

function ff(args, { script } = {}) {
  const full = ['-hide_banner', '-nostats', '-y', ...args]
  if (script) {
    const path = join(stems, `graph-${Math.random().toString(36).slice(2)}.txt`)
    writeFileSync(path, script)
    const at = full.indexOf('@GRAPH')
    full.splice(at, 1, '-/filter_complex', path)
  }
  const r = spawnSync('ffmpeg', full, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ').slice(0, 200)}\n${r.stderr.slice(-2000)}`)
  return r.stderr
}

/** Integrated loudness and true peak, from loudnorm's measurement pass. */
function measure(file) {
  const err = ff(['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
  const json = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1))
  return { I: Number(json.input_i), TP: Number(json.input_tp), LRA: Number(json.input_lra) }
}
function peakDb(file) {
  const err = ff(['-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  return Number(/max_volume: (-?[\d.]+) dB/.exec(err)[1])
}
/** Renders `graph` (ending in [out]) to `out`, then scales it so its peak sits at `dB`. */
function sampleAtPeak(name, graph, dB) {
  const raw = join(stems, `${name}-raw.wav`)
  ff(['@GRAPH', '-map', '[out]', '-ar', String(SR), '-ac', '1', raw], { script: graph })
  const out = join(stems, `${name}.wav`)
  ff(['-i', raw, '-af', `volume=${(dB - peakDb(raw)).toFixed(2)}dB`, out])
  return out
}

// ---------- events from the page ----------
async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const dir = process.env.PLAYWRIGHT_DIR
    if (!dir) throw new Error('playwright not found: install it here or set PLAYWRIGHT_DIR')
    const require = createRequire(join(dir, 'package.json'))
    return import(pathToFileURL(require.resolve('playwright')).href)
  }
}
const pw = await loadPlaywright()
const chromium = pw.chromium ?? pw.default.chromium
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${pathToFileURL(join(here, 'index.html')).href}?t=0&freeze=1`)
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 })
const ev = await page.evaluate(() => window.__soundEvents)
await browser.close()
writeFileSync(join(stems, 'events.json'), JSON.stringify(ev, null, 1))

// ---------- voice ----------
const narration = readFileSync(join(audioDir, 'narration.txt'), 'utf8').trim().split('\n').map(line => {
  const [scene, start, end] = line.split('|')
  return { scene: Number(scene), start: Number(start), end: Number(end) }
})
for (const n of narration) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
    join(audioDir, `voice${n.scene}.wav`)], { encoding: 'utf8' })
  n.dur = Number(r.stdout.trim())
}
const voiceRaw = join(stems, 'voice-raw.wav')
{
  const inputs = narration.flatMap(n => ['-i', join(audioDir, `voice${n.scene}.wav`)])
  const chains = narration.map((n, k) => `[${k}:a]aresample=${SR},adelay=delays=${Math.round(n.start * SR)}S:all=1[v${k}]`)
  const graph = `${chains.join(';\n')};\n${narration.map((_, k) => `[v${k}]`).join('')}amix=inputs=${narration.length}:normalize=0:duration=longest,apad=whole_dur=${DUR},atrim=0:${DUR}[out]`
  ff([...inputs, '@GRAPH', '-map', '[out]', '-ac', '1', '-ar', String(SR), voiceRaw], { script: graph })
}
const voice = join(stems, 'voice.wav')
ff(['-i', voiceRaw, '-af', `volume=${(TARGET_VOICE - measure(voiceRaw).I).toFixed(2)}dB`, voice])

// ---------- music bed ----------
// 72 BPM, A minor, Am F C G, two bars per chord (6.67 s), two passes, Am again at the end.
const BAR = 4 * 60 / 72
const CHORD = 2 * BAR
const CHORDS = {
  Am: { tones: [220.0, 261.63, 329.63, 440.0], sub: 110.0 },
  F: { tones: [174.61, 220.0, 261.63, 349.23], sub: 87.31 },
  C: { tones: [130.81, 164.81, 196.0, 261.63], sub: 65.41 },
  G: { tones: [196.0, 246.94, 293.66, 392.0], sub: 98.0 },
}
const ORDER = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am']
function padExpr(detune, phase) {
  const parts = ORDER.map((name, k) => {
    const a = k * CHORD
    const b = a + CHORD
    const { tones, sub } = CHORDS[name]
    const voices = tones.map(f => {
      const fr = (f * detune).toFixed(3)
      // a triangle-ish partial: the fundamental plus a soft third harmonic
      return `0.11*(sin(2*PI*${fr}*t)-0.1*sin(6*PI*${fr}*t))`
    }).join('+')
    const env = `pow(sin(PI/2*min(1,(t-${a.toFixed(3)})/1.4)),2)*if(gt(t,${b.toFixed(3)}),pow(cos(PI/2*min(1,(t-${b.toFixed(3)})/1.3)),2),1)`
    const last = k === ORDER.length - 1
    const until = last ? DUR + 1 : b + 1.3
    return `if(between(t,${a.toFixed(3)},${until.toFixed(3)}),(${voices}+0.16*sin(2*PI*${sub}*t))*${last ? `pow(sin(PI/2*min(1,(t-${a.toFixed(3)})/1.4)),2)` : env},0)`
  })
  return `(${parts.join('+')})*(1+0.14*sin(2*PI*0.3*t+${phase}))`
}
const music = join(stems, "music.wav")
if (musicFile) {
  const musicRaw = join(stems, "music-raw.wav")
  ff(["-i", musicFile, "-af", `atrim=0:${DUR},apad=whole_dur=${DUR}`, "-ac", "2", "-ar", String(SR), musicRaw])
  ff(["-i", musicRaw, "-af", `volume=${(TARGET_MUSIC - measure(musicRaw).I).toFixed(2)}dB,afade=t=in:d=1.5,afade=t=out:st=${DUR - 3}:d=3`, music])
} else {
const padRaw = join(stems, "pad-raw.wav")
ff(['@GRAPH', '-map', '[out]', '-ar', String(SR), padRaw], {
  script: `aevalsrc='${padExpr(1, 0)}|${padExpr(1.003, 0.9)}':s=${SR}:d=${DUR}:c=stereo,lowpass=f=1800,lowpass=f=1800[out]`,
})
const pad = join(stems, 'pad.wav')
ff(['-i', padRaw, '-af', `volume=${(TARGET_MUSIC - measure(padRaw).I).toFixed(2)}dB`, pad])
// 8th-note hat, 18 s to 56 s only: filtered noise bursts, offbeats softer
const EIGHTH = 60 / 72 / 2
const hat = join(stems, 'hat.wav')
ff(['@GRAPH', '-map', '[out]', '-ar', String(SR), hat], {
  script: `anoisesrc=d=${DUR}:c=white:a=1:r=${SR}:seed=7,highpass=f=6500,highpass=f=6500,` +
    `aeval='val(0)*if(between(t,18,56),exp(-mod(t-18,${EIGHTH.toFixed(5)})*95)*if(mod(floor((t-18)/${EIGHTH.toFixed(5)}),2),0.55,1),0)':c=stereo,` +
    `volume=0.02[out]`,
})
ff(["-i", pad, "-i", hat, "@GRAPH", "-map", "[out]", music], {
  script: `[0:a][1:a]amix=inputs=2:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${DUR - 3}:d=3[out]`,
})
}

// ---------- SFX ----------
const click = sampleAtPeak('click', `anoisesrc=d=0.004:c=white:r=${SR}:seed=3,bandpass=f=3200:w=2400,afade=t=out:d=0.003[out]`, -24)
const key = sampleAtPeak('key', `anoisesrc=d=0.014:c=pink:r=${SR}:seed=5,bandpass=f=1900:w=1600,afade=t=out:d=0.012[out]`, -25)
const note = (name, f, bright, dB) => sampleAtPeak(name,
  `aevalsrc='(sin(2*PI*${f}*t)*exp(-9*t)+${bright}*sin(4*PI*${f}*t)*exp(-16*t)+0.22*sin(8*PI*${f}*t)*exp(-30*t))*(1-exp(-600*t))':s=${SR}:d=0.8[out]`, dB)
const notes = [note('note1', 440.0, 0.1, -21), note('note2', 523.25, 0.1, -21), note('note3', 659.25, 0.1, -21)]
const go = note('note-go', 880.0, 0.45, -19)
const whoosh = sampleAtPeak('whoosh',
  `anoisesrc=d=0.3:c=pink:r=${SR}:seed=9,asplit[a][b];[a]lowpass=f=280,aeval='val(0)*(1-t/0.3)'[lo];` +
  `[b]bandpass=f=900:w=700,aeval='val(0)*t/0.3'[hi];[lo][hi]amix=inputs=2:normalize=0,aeval='val(0)*pow(sin(PI*t/0.3),2)'[out]`, -22)

const sfx = join(stems, 'sfx.wav')
{
  const placed = [
    { file: click, at: ev.wordClicks },
    { file: key, at: ev.keyClicks },
    ...ev.countdown.map((t, k) => ({ file: notes[k], at: [t] })),
    { file: go, at: [ev.playStart] },
    { file: whoosh, at: [ev.whoosh] },
  ]
  const lines = []
  const labels = []
  placed.forEach((p, k) => {
    const outs = p.at.map((_, j) => `[s${k}_${j}]`)
    lines.push(`[${k}:a]asplit=${p.at.length}${outs.join('')}`)
    p.at.forEach((t, j) => {
      lines.push(`[s${k}_${j}]adelay=delays=${Math.round(t * SR)}S:all=1[d${k}_${j}]`)
      labels.push(`[d${k}_${j}]`)
    })
  })
  lines.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_dur=${DUR},atrim=0:${DUR}[out]`)
  ff([...placed.flatMap(p => ['-i', p.file]), '@GRAPH', '-map', '[out]', '-ac', '1', '-ar', String(SR), sfx], {
    script: lines.join(';\n'),
  })
}

// ---------- mix ----------
// Music ducks 8 dB under each voice clip: 150 ms attack ahead of the onset, 600 ms release after the end.
const duck = narration
  .map(n => `min(clip((t-${(n.start - 0.15).toFixed(3)})/0.15,0,1),clip((${(n.start + n.dur + 0.6).toFixed(3)}-t)/0.6,0,1))`)
  .reduce((acc, d) => `max(${acc},${d})`)
const musicDucked = join(stems, 'music-ducked.wav')
ff(['-i', music, '@GRAPH', '-map', '[out]', musicDucked], {
  script: `[0:a]aeval='val(ch)*pow(10,-8*(${duck})/20)':c=same[out]`,
})
const mixRaw = join(stems, 'mix-raw.wav')
ff(['-i', voice, '-i', musicDucked, '-i', sfx, '@GRAPH', '-map', '[out]', '-ar', String(SR), mixRaw], {
  script: `[0:a]pan=stereo|c0=c0|c1=c0[v];[2:a]pan=stereo|c0=c0|c1=c0[s];[v][1:a][s]amix=inputs=3:normalize=0[out]`,
})

const m4a = join(here, 'soundtrack.m4a')
const mix = join(stems, 'mix.wav')
let gain = TARGET_MIX - measure(mixRaw).I
let ceiling = -2.0
let final
for (let pass = 0; pass < 8; pass += 1) {
  ff(['-i', mixRaw, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${(10 ** (ceiling / 20)).toFixed(4)}:level=false:attack=2:release=60`, '-ar', String(SR), mix])
  ff(['-i', mix, '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-ac', '2', '-movflags', '+faststart', m4a])
  final = measure(m4a)
  const okTp = final.TP <= TP_MAX - 0.05
  const okI = Math.abs(final.I - TARGET_MIX) <= 0.3
  if (okTp && okI) break
  if (!okTp) ceiling -= 0.5
  if (!okI) gain += TARGET_MIX - final.I
}

// ---------- mux onto the silent video ----------
const video = join(here, 'rsvp-reader-explainer.mp4')
const silent = join(workDir, 'explainer-silent.mp4')
if (!existsSync(silent)) copyFileSync(video, silent)
ff(['-i', silent, '-i', m4a, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', '-movflags', '+faststart', video])

process.stdout.write(`${JSON.stringify({
  voice: measure(voice), music: measure(music), sfxPeak: peakDb(sfx), mix: final, ceiling, gain,
  clicks: ev.wordClicks.length, keys: ev.keyClicks.length,
})}\n`)
