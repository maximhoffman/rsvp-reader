import { expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import {
  delayFor,
  flattenMarkdown,
  nextSentenceStart,
  orpIndex,
  sentenceStart,
  tokenize,
} from '../hooks/text'

const PANE = {
  plugin: 'rsvp-reader',
  component: 'Pane',
  requestId: 'rsvp',
  props: {
    title: 'Читалка',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

type Pane = Pick<Mounted<'terminal', 'Pane'>, 'find'>

/** The word on screen: the keyed word row's text, its pivot padding trimmed. */
async function wordShown(ui: Pane): Promise<string> {
  return ((await ui.find({ key: 'word' }))?.text ?? '').trim()
}

/** The status line: position, speed and state. */
async function statusShown(ui: Pane): Promise<string> {
  return (await ui.find({ type: 'Text', text: /слов\/мин|wpm/ }))?.text ?? ''
}

const ANSWER = [
  '# Итог',
  '',
  'Первое **предложение** готово. Второе, с запятой, тоже.',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '- пункт [ссылка](https://example.com)',
].join('\n')

test('markdown is flattened to prose and tokenized with pauses', async () => {
  const prose = flattenMarkdown(ANSWER)
  expect(prose).not.toContain('#')
  expect(prose).not.toContain('**')
  expect(prose).not.toContain('const x')
  expect(prose).not.toContain('https://')
  expect(prose).toContain('⟨код⟩')
  expect(prose.split('\n')[0]).toBe('Итог.')

  const words = tokenize(prose)
  expect(words[0]).toEqual({ text: 'Итог.', stop: 'period' })
  expect(words.find(w => w.text === 'Второе,')?.stop).toBe('comma')
  expect(words.at(-1)).toEqual({ text: 'ссылка.', stop: 'period' })
})

test('recognition point, delays and sentence seeks', async () => {
  expect(orpIndex('я')).toBe(0)
  expect(orpIndex('слово')).toBe(1)
  expect(orpIndex('читалка')).toBe(2)
  expect(orpIndex('предложение')).toBe(3)
  expect(orpIndex('достопримечательность')).toBe(4)

  const plain = { text: 'слово', stop: 'none' } as const
  const end = { text: 'слово.', stop: 'period' } as const
  expect(delayFor(plain, 300)).toBe(200)
  expect(delayFor(end, 300)).toBe(440)

  const words = tokenize('Раз два три. Четыре пять. Шесть')
  expect(sentenceStart(words, 2)).toBe(0)
  expect(sentenceStart(words, 3)).toBe(0)
  expect(sentenceStart(words, 4)).toBe(3)
  expect(nextSentenceStart(words, 0)).toBe(3)
  expect(nextSentenceStart(words, 3)).toBe(5)
  expect(nextSentenceStart(words, 5)).toBe(5)
})

test('/rsvp reads the last answer, counts down, plays, and every seek waits for play (ru)', { options: { language: 'ru' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'rsvp' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'вопрос', toolUses: [] },
      { role: 'assistant', text: 'Раз два три. Четыре пять.', toolUses: [] },
    ],
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({
    command: 'rsvp',
    args: '300',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toContain('5 слов')
  expect(ran.text).toContain('Старт через 3 с')
  expect(ran.text).toContain('300 слов/мин')
  expect(opened[0]).toBe('rsvp')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await wordShown(ui)).toBe('Раз')
  expect(await statusShown(ui)).toContain('1/5')

  // The countdown holds the first word for three seconds.
  expect(await ui.find({ type: 'Text', text: /старт через 3/ })).toBeDefined()
  await clock.advance(2000)
  expect(await wordShown(ui)).toBe('Раз')
  expect(await ui.find({ type: 'Text', text: /старт через 1/ })).toBeDefined()
  await clock.advance(1000)
  expect(await wordShown(ui)).toBe('Раз')
  expect(await statusShown(ui)).toContain('идёт')

  // 200 ms per plain word at 300 wpm: the first word gives way after it.
  await clock.advance(200)
  expect(await wordShown(ui)).toBe('два')
  expect(await statusShown(ui)).toContain('2/5')

  // A seek while playing lands on the word and stops there.
  await ui.press({ key: 'word-forward' })
  expect(await wordShown(ui)).toBe('три.')
  expect(await statusShown(ui)).toContain('пауза')
  await clock.advance(5000)
  expect(await wordShown(ui)).toBe('три.')

  // Play continues from there: a sentence end holds 440 ms at 300 wpm.
  await ui.press({ key: 'toggle' })
  expect(await statusShown(ui)).toContain('идёт')
  await clock.advance(440)
  expect(await wordShown(ui)).toBe('Четыре')

  // Sentence seeks stop too, in both directions.
  await ui.press({ key: 'sentence-back' })
  expect(await wordShown(ui)).toBe('Раз')
  expect(await statusShown(ui)).toContain('пауза')
  await ui.press({ key: 'sentence-forward' })
  expect(await wordShown(ui)).toBe('Четыре')
  await ui.press({ key: 'word-back' })
  expect(await wordShown(ui)).toBe('три.')
  await clock.advance(5000)
  expect(await wordShown(ui)).toBe('три.')

  await ui.press({ key: 'faster' })
  expect(await statusShown(ui)).toContain('350 слов/мин')
  expect(await statusShown(ui)).toContain('пауза')

  await ui.unmount()

  // Without the keyboard the pane says how to hand it over.
  const blurred = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, isFocused: false },
    surface: 'terminal',
  })
  expect(await blurred.find({ type: 'Text', text: /ctrl\+x/ })).toBeDefined()
  await blurred.unmount()
})

test('English is the default: the command answers and the empty pane speak it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'rsvp' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [{ role: 'assistant', text: 'One two three.', toolUses: [] }],
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({
    command: 'rsvp',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toContain('Reader: 3 words')
  expect(ran.text).toContain('Starts in 3 s')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await statusShown(ui)).toContain('wpm')
  expect(await ui.find({ type: 'Text', text: /starts in 3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctrl\+x/ })).toBeDefined()
  expect(await ui.find({ key: 'word-back' })).toMatchObject({ props: { label: 'word back' } })
  await ui.unmount()
})

test('with nothing read yet the pane says so, on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /rsvp/ })).toBeDefined()
    await ui.unmount()
  }
})
