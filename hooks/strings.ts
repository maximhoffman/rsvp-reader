import type { PluginOptions } from 'claude-code'

export type Lang = 'en' | 'ru'

/** Every text the pane, the command and the menu show, per language. */
export type Strings = {
  commandDescription: string
  argumentHint: string
  paneTitle: string
  noAnswer: string
  noText: string
  notPlaced: (reason: string) => string
  opened: (count: number, wpm: number, leadSeconds: number) => string
  emptyPane: string
  wpmUnit: string
  startsIn: (seconds: number) => string
  playing: string
  pausedHint: string
  focusHint: string
  focusedHint: string
  play: string
  pause: string
  restart: string
  close: string
  wordBack: string
  wordForward: string
  sentenceStart: string
  nextSentence: string
  slower: string
  faster: string
}

const en: Strings = {
  commandDescription: 'Speed-read the last answer one word at a time (RSVP)',
  argumentHint: '[words per minute]',
  paneTitle: 'Reader',
  noAnswer: 'There is no answer to read yet.',
  noText: 'The last answer holds no text to read.',
  notPlaced: reason => `The reader pane is not shown: ${reason}.`,
  opened: (count, wpm, leadSeconds) =>
    `Reader: ${count} ${count === 1 ? 'word' : 'words'}, ${wpm} wpm. Starts in ${leadSeconds} s; Esc closes the pane.`,
  emptyPane: 'Nothing to read. Type /rsvp after an answer.',
  wpmUnit: 'wpm',
  startsIn: seconds => `starts in ${seconds}…`,
  playing: 'playing',
  pausedHint: 'paused · p resumes',
  focusHint: 'For the keys to work, give the pane the focus: ctrl+x, then Tab, or click the pane.',
  focusedHint: 'The keys below work; Esc closes the pane.',
  play: 'play',
  pause: 'pause',
  restart: 'restart',
  close: 'close',
  wordBack: 'word back',
  wordForward: 'word forward',
  sentenceStart: 'sentence start',
  nextSentence: 'next sentence',
  slower: 'slower',
  faster: 'faster',
}

function russianWords(n: number): string {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return 'слов'
  if (ones === 1) return 'слово'
  if (ones >= 2 && ones <= 4) return 'слова'
  return 'слов'
}

const ru: Strings = {
  commandDescription: 'Прочитать последний ответ по одному слову (быстрое чтение, RSVP)',
  argumentHint: '[слов в минуту]',
  paneTitle: 'Читалка',
  noAnswer: 'Пока нет ответа, который можно прочитать.',
  noText: 'В последнем ответе нет текста для чтения.',
  notPlaced: reason => `Панель читалки не показана: ${reason}.`,
  opened: (count, wpm, leadSeconds) =>
    `Читалка: ${count} ${russianWords(count)}, ${wpm} слов/мин. Старт через ${leadSeconds} с, Esc закрывает панель.`,
  emptyPane: 'Нет текста. Наберите /rsvp после ответа.',
  wpmUnit: 'слов/мин',
  startsIn: seconds => `старт через ${seconds}…`,
  playing: 'идёт',
  pausedHint: 'пауза · p продолжит',
  focusHint: 'Чтобы клавиши работали, передайте фокус панели: ctrl+x, затем Tab, или клик по панели.',
  focusedHint: 'Клавиши ниже работают; Esc закрывает панель.',
  play: 'пуск',
  pause: 'пауза',
  restart: 'сначала',
  close: 'закрыть',
  wordBack: 'слово назад',
  wordForward: 'слово вперёд',
  sentenceStart: 'начало предложения',
  nextSentence: 'следующее предложение',
  slower: 'медленнее',
  faster: 'быстрее',
}

export const STRINGS: Record<Lang, Strings> = { en, ru }

/** The language the manifest's `language` option names; English otherwise. */
export function langOf(options: PluginOptions): Lang {
  const value = options['language']
  return value === 'ru' ? 'ru' : 'en'
}
