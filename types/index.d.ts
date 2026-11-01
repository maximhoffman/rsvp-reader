/**
 * One token of the text being read: the word as shown and the pause that
 * follows it (none, a short one after a comma, a long one at a sentence end).
 */
export type Word = { text: string; stop: 'none' | 'comma' | 'period' }

declare module 'claude-code' {
  interface PluginState {
    'rsvp-reader': {
      /** The tokens of the answer being read. */
      words: Shaped<Word[]>
      /** The token on screen, an index into `words`. */
      index: number
      /** Words per minute. */
      wpm: number
      /** Whether the reader advances by itself. */
      isPlaying: boolean
      /** Seconds left before playback starts; 0 while it runs or waits. */
      countdown: number
    }
  }
}
