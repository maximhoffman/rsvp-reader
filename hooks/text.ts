import type { Word } from '../types'

export const MIN_WPM = 100
export const MAX_WPM = 1000
export const WPM_STEP = 50
export const DEFAULT_WPM = 350

const CODE_PLACEHOLDER = '⟨код⟩'

/**
 * Turns an assistant reply's Markdown into plain prose: code fences become one
 * placeholder token, inline markup is stripped, links keep their text, table
 * cells become words. Each line that ends without punctuation is closed with a
 * sentence stop so headings and list items pause like sentences.
 */
export function flattenMarkdown(markdown: string): string {
  const withoutFences = markdown.replace(/```[\s\S]*?(```|$)/g, ` ${CODE_PLACEHOLDER}. `)
  const lines = withoutFences.split(/\r?\n/)
  const out: string[] = []
  for (const raw of lines) {
    let line = raw.trim()
    if (line === '') continue
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue
    line = line.replace(/^#{1,6}\s+/, '')
    line = line.replace(/^>\s?/, '')
    line = line.replace(/^([-*+]|\d+[.)])\s+/, '')
    line = line.replace(/^\[([ xX])\]\s+/, '')
    line = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    line = line.replace(/<[^>]+>/g, '')
    line = line.replace(/`([^`]*)`/g, '$1')
    line = line.replace(/(\*\*|__)(.+?)\1/g, '$2')
    line = line.replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\w)/g, '$1$2')
    line = line.replace(/(^|[^\w_])_([^_\n]+?)_(?!\w)/g, '$1$2')
    line = line.replace(/~~(.+?)~~/g, '$1')
    line = line.replace(/\|/g, ' ')
    line = line.trim()
    if (line === '') continue
    if (!/[.!?…:;,]$/.test(line)) line += '.'
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Splits prose into tokens, each with the pause its trailing punctuation asks
 * for. Punctuation stays on the word, as Spritz shows it.
 */
export function tokenize(text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(token => token !== '')
    .map(token => ({ text: token, stop: stopOf(token) }))
}

function stopOf(token: string): Word['stop'] {
  const bare = token.replace(/["'»)\]}*]+$/, '')
  if (/[.!?…]$/.test(bare)) return 'period'
  if (/[,;:]$/.test(bare)) return 'comma'
  return 'none'
}

/**
 * The letter the eye should land on (the optimal recognition point), as an
 * index into the word: a little left of the middle, by the Spritz rule.
 */
export function orpIndex(word: string): number {
  const letters = [...word]
  const n = letters.length
  if (n <= 1) return 0
  if (n <= 5) return 1
  if (n <= 9) return 2
  if (n <= 13) return 3
  return 4
}

/**
 * How long a token stays on screen, in milliseconds: the base from the speed,
 * longer for long words, and a pause after a comma or at a sentence end.
 */
export function delayFor(word: Word, wpm: number): number {
  const base = 60_000 / clampWpm(wpm)
  let factor = 1
  const length = [...word.text].length
  if (length > 8) factor += 0.3
  if (length > 13) factor += 0.3
  if (word.stop === 'comma') factor += 0.5
  if (word.stop === 'period') factor += 1.2
  return Math.round(base * factor)
}

export function clampWpm(wpm: number): number {
  if (!Number.isFinite(wpm)) return DEFAULT_WPM
  return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)))
}

/**
 * The first token of the sentence that holds `index`; pressed at a sentence's
 * first word, the previous sentence's start instead.
 */
export function sentenceStart(words: readonly Word[], index: number): number {
  let i = Math.min(index, words.length - 1)
  if (i <= 0) return 0
  // Already at a sentence start: go to the previous sentence.
  if (words[i - 1]?.stop === 'period') i -= 1
  while (i > 0 && words[i - 1]?.stop !== 'period') i -= 1
  return i
}

/**
 * The first token of the sentence after the one that holds `index`, or the
 * last token when none follows.
 */
export function nextSentenceStart(words: readonly Word[], index: number): number {
  let i = index
  while (i < words.length - 1 && words[i]?.stop !== 'period') i += 1
  return Math.min(i + 1, words.length - 1)
}
