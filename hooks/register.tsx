import { atom, read, update } from "claude-code"
import type { EngineInterface, Register, SessionMessage, Timer } from "claude-code"

import type { Word } from "../types"
import { STRINGS, langOf } from "./strings"
import type { Strings } from "./strings"
import {
  DEFAULT_WPM,
  WPM_STEP,
  clampWpm,
  delayFor,
  flattenMarkdown,
  nextSentenceStart,
  orpIndex,
  sentenceStart,
  tokenize,
} from './text'

const PANE = "rsvp"
const STORE_WPM = 'wpm'
/** Seconds the first word stands still before playback starts. */
const LEAD_SECONDS = 3
/** How long after the command the pane asks for the keyboard again. */
const REFOCUS_MS = 500

// The texts of the language the person chose; set when the module registers.
let t: Strings = STRINGS.en

const paneArgs = () => ({ id: PANE, title: t.paneTitle, focus: true, closeOnEscape: true, rows: 11 }) as const

// Bump the shape tag when Word's fields change: an earlier version's value
// outlives a reload and is then read as the initial one.
const words = atom({ plugin: 'rsvp-reader', key: 'words' } as const, [] as Word[], {
  shape: 'words-1',
})
const index = atom({ plugin: 'rsvp-reader', key: 'index' } as const, 0)
const wpm = atom({ plugin: 'rsvp-reader', key: 'wpm' } as const, DEFAULT_WPM)
const isPlaying = atom({ plugin: 'rsvp-reader', key: 'isPlaying' } as const, false)
const countdown = atom({ plugin: 'rsvp-reader', key: 'countdown' } as const, 0)

// The one pending step of playback or of the countdown. A module variable,
// so a reload drops it together with the timer the engine cancels.
let pending: Timer | undefined

function stopTimer(): void {
  pending?.cancel()
  pending = undefined
}

/**
 * Schedules the step after the word on screen, if playback is on. Called
 * after every change of position or speed, so the current word is re-timed.
 */
async function arm($: EngineInterface): Promise<void> {
  stopTimer()
  const [list, i, speed, playing] = await Promise.all([
    read($, words),
    read($, index),
    read($, wpm),
    read($, isPlaying),
  ])
  if (!playing) return
  const word = list[i]
  if (word === undefined) {
    await update($, isPlaying, () => false)
    return
  }
  pending = $.clock.after(delayFor(word, speed), () => {
    void step($)
  })
}

async function step($: EngineInterface): Promise<void> {
  pending = undefined
  const [list, i, playing] = await Promise.all([
    read($, words),
    read($, index),
    read($, isPlaying),
  ])
  if (!playing) return
  if (i + 1 >= list.length) {
    await update($, isPlaying, () => false)
    return
  }
  await update($, index, () => i + 1)
  await arm($)
}

/**
 * Holds the word on screen for a visible countdown, then starts playback: the
 * person has time to find the pane and the pivot column before words move.
 */
async function startAfterCountdown($: EngineInterface): Promise<void> {
  stopTimer()
  await update($, isPlaying, () => true)
  await update($, countdown, () => LEAD_SECONDS)
  pending = $.clock.after(1000, () => void tickDown($))
}

/** One second of the countdown: counts down, and at zero starts playback. */
async function tickDown($: EngineInterface): Promise<void> {
  pending = undefined
  const [left, playing] = await Promise.all([read($, countdown), read($, isPlaying)])
  if (!playing) {
    await update($, countdown, () => 0)
    return
  }
  if (left <= 1) {
    await update($, countdown, () => 0)
    await arm($)
    return
  }
  await update($, countdown, () => left - 1)
  pending = $.clock.after(1000, () => void tickDown($))
}

async function setWpm($: EngineInterface, value: number): Promise<number> {
  const next = clampWpm(value)
  await update($, wpm, () => next)
  await $.store.set(STORE_WPM, next)
  return next
}

async function play($: EngineInterface): Promise<void> {
  const [list, i] = await Promise.all([read($, words), read($, index)])
  if (list.length === 0) return
  if (i + 1 >= list.length) {
    await update($, index, () => 0)
    await startAfterCountdown($)
    return
  }
  await update($, isPlaying, () => true)
  await arm($)
}

async function pause($: EngineInterface): Promise<void> {
  stopTimer()
  await update($, isPlaying, () => false)
  await update($, countdown, () => 0)
}

/**
 * Moves to another word and stops there: the person looks at where they
 * landed and continues with play. A seek never keeps playback running.
 */
async function seek(
  $: EngineInterface,
  to: (list: readonly Word[], i: number) => number,
): Promise<void> {
  stopTimer()
  const list = await read($, words)
  await update($, index, i => Math.max(0, Math.min(list.length - 1, to(list, i))))
  await update($, isPlaying, () => false)
  await update($, countdown, () => 0)
}

async function restart($: EngineInterface): Promise<void> {
  stopTimer()
  await update($, index, () => 0)
  await startAfterCountdown($)
}

function lastAnswer(messages: readonly SessionMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'assistant' && message.text.trim() !== '') return message.text
  }
  return undefined
}

/**
 * The word split around its recognition point and fitted to `columns`: the
 * part before the pivot is padded so the pivot always lands on one column,
 * the part after is cut with an ellipsis when it would run past the body.
 */
function layout(word: string, columns: number) {
  const letters = [...word]
  const at = orpIndex(word)
  const pivotColumn = Math.max(4, Math.floor(columns * 0.38))
  const before = letters.slice(0, at).join('')
  const pivot = letters[at] ?? ''
  let after = letters.slice(at + 1).join('')
  const room = columns - pivotColumn - 1
  if ([...after].length > room) after = [...after].slice(0, Math.max(0, room - 1)).join('') + '…'
  const pad = ' '.repeat(Math.max(0, pivotColumn - at))
  return { pad, before, pivot, after, pivotColumn }
}

export const register: Register = (on, options) => {
  t = STRINGS[langOf(options)]

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rsvp',
      description: t.commandDescription,
      argumentHint: t.argumentHint,
    })
    const saved = await $.store.get(STORE_WPM)
    if (typeof saved === 'number') await update($, wpm, () => clampWpm(saved))

    return next(e)
  })

  on('command.run', { command: 'rsvp' }, async ($, e) => {
    const requested = Number.parseInt(e.args.trim(), 10)
    if (Number.isFinite(requested)) await setWpm($, requested)

    const found = await $.session.messages()
    const text = Array.isArray(found) ? lastAnswer(found) : undefined
    if (text === undefined) return { text: t.noAnswer }

    const list = tokenize(flattenMarkdown(text))
    if (list.length === 0) return { text: t.noText }

    stopTimer()
    await update($, words, () => list)
    await update($, index, () => 0)
    await update($, isPlaying, () => false)
    await update($, countdown, () => 0)

    const opened = await $.ui.open(paneArgs())
    if (!opened.isPlaced) return { text: t.notPlaced(opened.reason) }
    await startAfterCountdown($)
    // The focus is a request the surface may refuse while the command still
    // runs; ask once more when the prompt is idle again.
    $.clock.after(REFOCUS_MS, () => void $.ui.open(paneArgs()))
    const speed = await read($, wpm)

    return { text: t.opened(list.length, speed, LEAD_SECONDS) }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopTimer()
    if (e.origin.kind !== 'unload') {
      await update($, isPlaying, () => false)
      await update($, countdown, () => 0)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [list, i, speed, playing, left] = await Promise.all([
      read($, words),
      read($, index),
      read($, wpm),
      read($, isPlaying),
      read($, countdown),
    ])

    if (list.length === 0) {
      return (
        <Box paddingX={1}>
          <Text dimColor>{t.emptyPane}</Text>
        </Box>
      )
    }

    const columns = Math.max(24, e.props.bodyColumns - 2)
    const at = Math.min(i, list.length - 1)
    const word = list[at] ?? list[0]!
    const { pad, before, pivot, after, pivotColumn } = layout(word.text, columns)
    const marker = ' '.repeat(pivotColumn)
    const percent = Math.round(((at + 1) / list.length) * 100)
    const state = playing ? t.playing : t.pausedHint
    const counting = left > 0
    const status = `${at + 1}/${list.length} · ${percent}% · ${speed} ${t.wpmUnit} · ${state}`

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor={!counting} color={counting ? "warning" : undefined}>
          {marker}▾
        </Text>
        <Box key="word" flexDirection="row">
          <Text>
            {pad}
            {before}
          </Text>
          <Text color="red" weight="bold">
            {pivot}
          </Text>
          <Text>{after}</Text>
        </Box>
        <Text dimColor={!counting} color={counting ? "warning" : undefined}>
          {marker}▴
        </Text>
        {counting && (
          <Text color="warning" weight="bold">
            {t.startsIn(left)}
          </Text>
        )}
        <Text dimColor tabular>
          {status}
        </Text>
        {!e.props.isFocused && <Text color="warning">{t.focusHint}</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          <Button
            key="toggle"
            plain
            hotkey="p"
            autoFocus
            onPress={() => void (playing ? pause($) : play($))}
          >
            {playing ? t.pause : t.play}
          </Button>
          <Button key="restart" plain hotkey="r" onPress={() => void restart($)}>
            {t.restart}
          </Button>
          <Button
            key="close"
            plain
            hotkey="q"
            role="dismiss"
            onPress={() => void $.ui.close({ id: PANE })}
          >
            {t.close}
          </Button>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          <Button key="word-back" plain hotkey="h" onPress={() => void seek($, (_, n) => n - 1)}>
            {t.wordBack}
          </Button>
          <Button key="word-forward" plain hotkey="l" onPress={() => void seek($, (_, n) => n + 1)}>
            {t.wordForward}
          </Button>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          <Button key="sentence-back" plain hotkey="j" onPress={() => void seek($, sentenceStart)}>
            {t.sentenceStart}
          </Button>
          <Button
            key="sentence-forward"
            plain
            hotkey="k"
            onPress={() => void seek($, nextSentenceStart)}
          >
            {t.nextSentence}
          </Button>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          <Button
            key="slower"
            plain
            hotkey="a"
            onPress={() => void setWpm($, speed - WPM_STEP).then(() => arm($))}
          >
            {t.slower}
          </Button>
          <Button
            key="faster"
            plain
            hotkey="d"
            onPress={() => void setWpm($, speed + WPM_STEP).then(() => arm($))}
          >
            {t.faster}
          </Button>
        </Box>
        <Text dimColor>{t.keysTip}</Text>
      </Box>
    )
  })
}
