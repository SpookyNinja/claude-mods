import { expect, mock, test } from 'claude-code/testing'

import { parseChoice, parseQuestions } from './register'

test('parses a routing reply', () => {
  expect(parseChoice('{"model":"opus","effort":"xhigh","reason":"hard race"}')).toEqual({
    tier: 'opus',
    effort: 'xhigh',
    reason: 'hard race',
  })
  expect(parseChoice('{"model":"gpt","effort":"low"}')).toBe(null)
  expect(parseChoice('no json')).toBe(null)
})

test('a prompt picks the model and effort of the next step', async ($, on) => {
  const asked: string[] = []
  on('store.get', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('model.complete', async () => ({
    value: {
      isAnswered: true as const,
      text: '{"model":"opus","effort":"high","reason":"architecture"}',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  on('turn.step', async function* (_, e) {
    asked.push(`${e.model}/${e.effort}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })

  await $.prompt.submit({ text: 'Design the plugin architecture', wait: false, origin: { kind: 'user' } } as never)
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of stream) void _
  await stream.result

  expect(asked).toEqual(['claude-opus-5-5/high'])
})

test('the pane shows a switch that turns AutoModell off and on', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'AutoModell',
      surface,
      component: 'Pane',
      requestId: 'automodell',
      props: { title: 'AutoModell', isFocused: false, bodyColumns: 40, placement: 'dock' },
    } as never)
    expect(await ui.find({ type: 'Button', text: /ON/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Button', text: /OFF/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Button', text: /ON/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the bottom line is a button that turns AutoModell off and on', async ($, on) => {
  mock.store(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'AutoModell',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, rows: 10 },
    } as never)
    expect(await ui.find({ type: 'Button', text: /AutoModell: on/ })).toBeDefined()
    await ui.press({ key: 'toggle-line' })
    expect(await ui.find({ type: 'Button', text: 'AutoModell: off' })).toBeDefined()
    await ui.press({ key: 'toggle-line' })
    expect(await ui.find({ type: 'Button', text: /AutoModell: on/ })).toBeDefined()
    await ui.unmount()
  }
})

test('parses questions with three suggested answers', () => {
  const got = parseQuestions('[{"q":"Which language?","options":["TS","Python","Go","Rust"]},"Any deadline?"]')
  expect(got).toEqual([
    { q: 'Which language?', options: ['TS', 'Python', 'Go'] },
    { q: 'Any deadline?', options: [] },
  ])
  expect(parseQuestions('nope')).toBe(null)
})
