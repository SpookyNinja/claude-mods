import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Choice, Effort, Engineer, Question, Tier } from '../types'

const choice = atom({ plugin: 'AutoModell', key: 'choice' } as const, null)
const PANE = 'automodell'
const PE_PANE = 'prompt-engineer'
const peOn = atom({ plugin: 'AutoModell', key: 'peOn' } as const, false)
const pe = atom({ plugin: 'AutoModell', key: 'pe' } as const, null)
const isOn = atom({ plugin: 'AutoModell', key: 'isOn' } as const, true)

const MODELS: Record<Tier, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}
const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const RULES = `You route a coding assistant's prompts to a model and a reasoning effort.
Pick the cheapest pair that will still do the task well.

Models:
- haiku: trivial questions, small talk, one-line edits, renames, formatting, quick lookups.
- sonnet: everyday coding: features, bug fixes, tests, refactors in a few files, explanations.
- opus: hard or high-stakes work: architecture, tricky debugging, large multi-file changes,
  security, concurrency, algorithms, long research, anything ambiguous with many steps.

Effort: low (instant answer), medium (some thought), high (careful work),
xhigh (deep multi-step reasoning), max (hardest problems only).

Reply with ONLY one line of JSON, nothing else:
{"model":"haiku|sonnet|opus","effort":"low|medium|high|xhigh|max","reason":"<max 8 words>"}`

const PE_ASK = `You help a person sharpen a prompt before it is sent to a coding assistant.
Ask 2 to 5 short clarifying questions about what is missing or ambiguous: goal, context,
constraints, expected output, edge cases. Skip anything the prompt already answers.
Write in the same language as the prompt.
For each question give exactly 3 short, plausible answers the person could pick (max 10 words each).
Reply with ONLY a JSON array like [{"q":"question","options":["a","b","c"]}].`

const PE_REFINE = `You rewrite a person's rough prompt into a clear, complete prompt for a coding assistant,
using their answers to your clarifying questions. Keep their intent and language, add the
details they gave, drop filler, use short structure only if it helps.
Reply with ONLY the rewritten prompt text.`

export function parseQuestions(text: string): Question[] | null {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[0]) as unknown
    if (!Array.isArray(raw)) return null
    const list: Question[] = []
    for (const item of raw) {
      // A bare string still works: a question with no suggestions.
      const q = typeof item === 'string' ? item : (item as { q?: unknown })?.q
      if (typeof q !== 'string' || !q.trim()) continue
      const opts = (item as { options?: unknown })?.options
      const options = Array.isArray(opts)
        ? opts.filter((o): o is string => typeof o === 'string' && o.trim() !== '').slice(0, 3)
        : []
      list.push({ q, options })
    }

    return list.length ? list.slice(0, 5) : null
  } catch {
    return null
  }
}

async function startEngineering($: EngineInterface, original: string) {
  await update($, pe, () => ({ original, status: 'thinking', questions: [], answers: [], refined: '' }) as Engineer)
  await $.ui.open({ id: PE_PANE, title: 'Prompt Engineer', focus: true })
  const r = await $.model.complete({
    model: 'sonnet',
    system: PE_ASK,
    prompt: `Prompt:\n<<<\n${original.slice(0, 6000)}\n>>>`,
    effort: 'low',
    maxTokens: 900,
    timeoutMs: 20000,
  })
  const questions = r.isAnswered ? parseQuestions(r.text) : null
  await update($, pe, cur =>
    cur
      ? questions
        ? { ...cur, status: 'asking', questions, answers: questions.map(() => '') }
        : { ...cur, status: 'ready', refined: original }
      : cur,
  )
}

async function refine($: EngineInterface, cur: Engineer) {
  await update($, pe, c => (c ? { ...c, status: 'refining' } : c))
  const qa = cur.questions.map((x, i) => `Q: ${x.q}\nA: ${cur.answers[i] || '(no answer)'}`).join('\n\n')
  const r = await $.model.complete({
    model: 'sonnet',
    system: PE_REFINE,
    prompt: `Original prompt:\n<<<\n${cur.original}\n>>>\n\n${qa}`,
    effort: 'medium',
    maxTokens: 1500,
    timeoutMs: 30000,
  })
  const text = r.isAnswered && r.text.trim() ? r.text.trim() : cur.original
  await update($, pe, c => (c ? { ...c, status: 'ready', refined: text } : c))
}

async function route($: EngineInterface, text: string) {
  if ((await $.store.get('enabled')) === false || !text.trim()) return
  const r = await $.model.complete({
    model: 'haiku',
    system: RULES,
    prompt: `Prompt to route:
<<<
${text.slice(0, 6000)}
>>>`,
    effort: 'low',
    maxTokens: 120,
    timeoutMs: 8000,
  })
  const picked = r.isAnswered ? parseChoice(r.text) : null
  await update($, choice, () => picked)
}

async function finish($: EngineInterface, text: string | null) {
  await update($, pe, () => null)
  await $.ui.close({ id: PE_PANE })
  if (text) {
    await route($, text)
    await $.prompt.submit({ text, asUser: true })
  }
}

export function parseChoice(text: string): Choice | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[0]) as { model?: unknown; effort?: unknown; reason?: unknown }
    const tier = TIERS.find(t => t === raw.model)
    const effort = EFFORTS.find(x => x === raw.effort)
    if (!tier || !effort) return null
    return { tier, effort, reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 80) : '' }
  } catch {
    return null
  }
}

const label = (c: Choice | null) => (c ? `AutoModell: ${c.tier} · ${c.effort}` : 'AutoModell: on')

async function setOn($: EngineInterface, now: boolean) {
  await $.store.set('enabled', now)
  await update($, isOn, () => now)
  if (!now) await update($, choice, () => null)
}

export const register: Register = on => {
  // The switch lives in $.store; the atom mirrors it for drawing. Off at each session start.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'automodell',
      description: 'AutoModell panel (or: on | off)',
    })
    // Every new chat starts with AutoModell off; the button turns it on.
    await $.store.set('enabled', false)
    await update($, isOn, () => false)
    await update($, choice, () => null)
    // Prompt Engineer is off at the start of every chat too.
    await update($, peOn, () => false)
    await update($, pe, () => null)

    return next(e)
  })

  on('command.run', { command: 'automodell' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await setOn($, arg === 'on')

      return { text: `AutoModell is ${arg}.` }
    }
    await $.ui.open({ id: PANE, title: 'AutoModell' })

    return { text: 'AutoModell panel opened. (/automodell on|off also works.)' }
  })

  // Prompt Engineer: hold the typed prompt back and refine it in a pane first.
  // Its own final submit has origin 'plugin', so it passes straight through.
  on('prompt.submit', async ($, e, next) => {
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (typed && e.text.trim() && !e.text.trim().startsWith('/') && (await read($, peOn))) {
      void startEngineering($, e.text)

      return { drop: 'Prompt Engineer is refining your prompt in its tab.' }
    }

    // AutoModell routing. A prompt the Prompt Engineer sends is routed in finish().
    if (e.origin.kind !== 'plugin') await route($, e.text)

    return next(e)
  })

  // Every request of the main thread uses the pick; subagents keep their own.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const value = await read($, choice)
    if (!value) return yield* next(e)

    return yield* next({ ...e, model: MODELS[value.tier], effort: value.effort })
  })

  // The clickable line at the bottom of the chat: shows the pick, a press switches AutoModell.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const active = await read($, isOn)
    const pick = await read($, choice)
    const engineer = await read($, peOn)

    return (
      <Box>
        <Button
          key="toggle-line"
          plain
          label={active ? label(pick) : 'AutoModell: off'}
          onPress={() => setOn($, !active)}
        />
        <Text dimColor>{'  │  '}</Text>
        <Button
          key="pe-line"
          plain
          label={engineer ? 'Prompt Engineer: on' : 'Prompt Engineer: off'}
          onPress={() => update($, peOn, v => !v)}
        />
      </Box>
    )
  })

  // The panel: opened by /automodell (or a press on its status), docked at the side.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const active = await read($, isOn)

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>AutoModell: </Text>
          <Button
            key="toggle"
            label={active ? '[ON ●    ]' : '[   ● OFF]'}
            variant={active ? 'primary' : undefined}
            onPress={() => setOn($, !active)}
          />
        </Box>
        <Text dimColor>
          {active ? 'Picks model + effort for every prompt.' : 'Using your normal model + effort.'}
        </Text>
      </Box>
    )
  })

  // The Prompt Engineer tab: questions, answers, then the refined prompt to send.
  on('ui.render', { component: 'Pane', requestId: PE_PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const cur = await read($, pe)
    if (!cur) return <Text dimColor>Nothing to refine.</Text>

    return (
      <Box flexDirection="column">
        <Text bold>Your prompt</Text>
        <Text dimColor>{cur.original}</Text>
        {cur.status === 'thinking' && <Text>Thinking of questions…</Text>}
        {cur.status === 'refining' && <Text>Refining your prompt…</Text>}
        {cur.status === 'asking' && (
          <Box flexDirection="column">
            {cur.questions.map((x, i) => (
              <Box key={`q${i}`} flexDirection="column">
                <Text bold>{`${i + 1}. ${x.q}`}</Text>
                {x.options.map((o, k) => {
                  const picked = cur.answers[i] === o

                  return (
                    <Button
                      key={`o${i}-${k}`}
                      plain
                      variant={picked ? 'primary' : undefined}
                      label={`${picked ? '(●)' : '( )'} ${o}`}
                      onPress={() =>
                        update($, pe, c =>
                          c ? { ...c, answers: c.answers.map((a, j) => (j === i ? (picked ? '' : o) : a)) } : c,
                        )
                      }
                    />
                  )
                })}
                <Input
                  key={`a${i}`}
                  label="Own answer: "
                  placeholder="or write your own (optional)"
                  value={cur.answers[i]}
                  submitLabel="ok"
                  onInput={v =>
                    update($, pe, c => (c ? { ...c, answers: c.answers.map((a, j) => (j === i ? v : a)) } : c))
                  }
                  onSubmit={() => {}}
                />
              </Box>
            ))}
            <Box>
              <Button key="refine" variant="primary" label="[ Refine prompt ]" onPress={() => refine($, cur)} />
              <Button key="skip" label="[ Send original ]" onPress={() => finish($, cur.original)} />
              <Button key="cancel" label="[ Cancel ]" onPress={() => finish($, null)} />
            </Box>
          </Box>
        )}
        {cur.status === 'ready' && (
          <Box flexDirection="column">
            <Text bold>Refined prompt</Text>
            {cur.editing ? (
              <Input
                key="refined"
                value={cur.refined}
                submitLabel="done"
                onInput={v => update($, pe, c => (c ? { ...c, refined: v } : c))}
                onSubmit={() => update($, pe, c => (c ? { ...c, editing: false } : c))}
              />
            ) : (
              <Text wrap="wrap">{cur.refined}</Text>
            )}
            <Box>
              <Button
                key="edit"
                label={cur.editing ? '[ Done editing ]' : '[ Edit ]'}
                onPress={() => update($, pe, c => (c ? { ...c, editing: !c.editing } : c))}
              />
              <Button key="send" variant="primary" label="[ Send ]" onPress={() => finish($, cur.refined)} />
              <Button key="orig" label="[ Send original ]" onPress={() => finish($, cur.original)} />
              <Button key="cancel2" label="[ Cancel ]" onPress={() => finish($, null)} />
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
