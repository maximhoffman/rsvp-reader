// Renders docs/explainer/index.html to MP4 (1920x1080, H.264, yuv420p) and a GIF teaser
// with HyperFrames (https://github.com/heygen-com/hyperframes): the page is seeked to
// t = frame / fps and captured one frame at a time, so no frame is dropped or duplicated.
//
//   node docs/explainer/record.mjs [workDir] [fps]
//
// fps is 30 (default) or 60. Needs Node 22+ and ffmpeg on PATH. The HyperFrames CLI
// is taken from this repo's node_modules, or from the folder named by HYPERFRAMES_DIR
// (a directory holding node_modules/.bin/hyperframes), else run through npx at the
// pinned version, so nothing has to be installed into the repo:
//
//   npm install --prefix /tmp/hf hyperframes@0.8.169 && HYPERFRAMES_DIR=/tmp/hf node docs/explainer/record.mjs
//
// The render is silent (the page has no <audio> element); when soundtrack.m4a (built
// by soundtrack.mjs) sits next to the page, the silent MP4 is kept as
// <workDir>/explainer-silent.mp4 and the soundtrack is muxed on without re-encoding.
// The equivalent shell lines:
//   hyperframes render docs/explainer -f 30 -q delivery -o explainer-silent.mp4
//   ffmpeg -y -i explainer-silent.mp4 -i soundtrack.m4a -map 0:v:0 -map 1:a:0 -c copy -shortest -movflags +faststart rsvp-reader-explainer.mp4
//   ffmpeg -y -ss 28 -t 8 -i rsvp-reader-explainer.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" teaser.gif

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HYPERFRAMES_VERSION = '0.8.169'
const here = dirname(fileURLToPath(import.meta.url))
const workDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'rsvp-explainer-'))
const fps = process.argv[3] ?? '30'
if (fps !== '30' && fps !== '60') throw new Error(`fps must be 30 or 60, got ${fps}`)
mkdirSync(workDir, { recursive: true })

function run(cmd, args, { inherit = false } = {}) {
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', inherit ? 'inherit' : 'ignore', inherit ? 'inherit' : 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1' },
  })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ').slice(0, 200)} failed:\n${result.stderr ?? ''}`)
}

function hyperframes() {
  const local = [join(here, '..', '..', 'node_modules'), process.env.HYPERFRAMES_DIR && join(process.env.HYPERFRAMES_DIR, 'node_modules')]
    .filter(Boolean)
    .map(dir => join(dir, '.bin', 'hyperframes'))
    .find(bin => existsSync(bin))
  return local ? [local, []] : ['npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`]]
}

const silent = join(workDir, 'explainer-silent.mp4')
const mp4 = join(here, 'rsvp-reader-explainer.mp4')
const gif = join(here, 'teaser.gif')
const soundtrack = join(here, 'soundtrack.m4a')

const [bin, pre] = hyperframes()
const started = Date.now()
run(bin, [...pre, 'render', here, '-f', fps, '-q', 'delivery', '-o', silent], { inherit: true })
const renderSeconds = (Date.now() - started) / 1000

if (existsSync(soundtrack)) {
  run('ffmpeg', ['-y', '-i', silent, '-i', soundtrack, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest',
    '-movflags', '+faststart', mp4])
} else {
  run('ffmpeg', ['-y', '-i', silent, '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', mp4])
}
run('ffmpeg', ['-y', '-ss', '28', '-t', '8', '-i', mp4, '-vf',
  'fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', gif])

process.stdout.write(`${JSON.stringify({ fps, renderSeconds, silent, mp4, mp4Bytes: statSync(mp4).size, gif, gifBytes: statSync(gif).size, workFiles: readdirSync(workDir) })}\n`)
