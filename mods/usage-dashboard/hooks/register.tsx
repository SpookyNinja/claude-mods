// SYNC NOTE (for Claude and humans): this mod lives in the git repo SpookyNinja/claude-mods (mods/<name>/).
// Edit ONLY the clone (default: ~/Projects/claude-mods), never a copy in ~/.claude/plugins/cache.
// After every change: bump "version" in .claude-plugin/plugin.json, then run ./publish.sh "<message>" (git pull --rebase, commit, push).
// Other machines pick it up with: git pull (if registered from the clone) or claude plugin marketplace update andre-mods && claude plugin update <name>@andre-mods.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row, Stats, Status } from '../types'

const PANE = 'usage-dashboard'
const stats = atom({ plugin: 'usage-dashboard', key: 'stats' } as const, null)
const view = atom({ plugin: 'usage-dashboard', key: 'view' } as const, 'day')
const filter = atom({ plugin: 'usage-dashboard', key: 'filter' } as const, 'all')
const range = atom({ plugin: 'usage-dashboard', key: 'range' } as const, '7d')
const rangeFrom = atom({ plugin: 'usage-dashboard', key: 'rangeFrom' } as const, '')
const rangeTo = atom({ plugin: 'usage-dashboard', key: 'rangeTo' } as const, '')
const status = atom({ plugin: 'usage-dashboard', key: 'status' } as const, { isLoading: false } as Status)

// Listenpreise der Anthropic-API in USD pro 1 Mio. Tokens (Stand 2026-10-06, laut claude-api-Skill).
// [input, output, Cache-Read-Faktor auf input]. Cache-Write = 2x input (1h-Cache, wie ihn die Logs
// zeigen; der 5-Minuten-Cache wäre 1,25x). Match per längstem Präfix der Modell-ID.
const PRICES: Record<string, [number, number, number]> = {
  'claude-fable-5': [10, 50, 0.025],
  'claude-mythos-5': [10, 50, 0.025],
  'claude-opus-5-5': [4, 20, 0.05],
  'claude-opus-5': [5, 25, 0.1],
  'claude-opus-4': [5, 25, 0.1],
  'claude-sonnet-5': [2, 10, 0.1],
  'claude-sonnet-4': [3, 15, 0.1],
  'claude-haiku-5': [0.1, 0.5, 0.1], // bis 100K Prompt; darüber $0.50/$2.50
  'claude-haiku-4': [1, 5, 0.1],
}
const WRITE_FACTOR = 2
const priceOf = (model: string): [number, number, number] | null => {
  const key = Object.keys(PRICES)
    .filter(k => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return key ? PRICES[key] : null
}
const readCost = (r: Row) => { const p = priceOf(r.model); return p ? (r.cr * p[0] * p[2]) / 1e6 : 0 }
const writeCost = (r: Row) => { const p = priceOf(r.model); return p ? (r.cw * p[0] * WRITE_FACTOR) / 1e6 : 0 }
const cost = (r: Row): number => {
  const p = priceOf(r.model)
  return p ? (r.input * p[0] + r.output * p[1]) / 1e6 + readCost(r) + writeCost(r) : 0
}
const total = (r: Row) => r.input + r.output + r.cw + r.cr

const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'G' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n)
const usd = (n: number) => '$' + n.toFixed(2)
const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0') + '%'

const RANGES = [
  { value: 'today', label: 'Heute', days: 1 },
  { value: '7d', label: 'Letzte 7 Tage', days: 7 },
  { value: '30d', label: 'Letzte 30 Tage', days: 30 },
  { value: '90d', label: 'Letzte 90 Tage', days: 90 },
  { value: 'all', label: 'Alles', days: 0 },
  { value: 'custom', label: 'Eigener Zeitraum', days: 0 },
]
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shiftDay = (day: string, delta: number) => {
  const d = new Date(day + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return ymd(d)
}

// Montag der Woche eines yyyy-mm-dd als yyyy-mm-dd (reine Datumsarithmetik in UTC).
const weekOf = (day: string) => {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const group = (rows: Row[], keyOf: (r: Row) => string) => {
  const m = new Map<string, { key: string; tokens: number; cost: number }>()
  for (const r of rows) {
    const k = keyOf(r)
    const g = m.get(k) ?? { key: k, tokens: 0, cost: 0 }
    g.tokens += total(r)
    g.cost += cost(r)
    m.set(k, g)
  }
  return [...m.values()]
}

// ---------------------------------------------------------------- Grafiken (SVG-Strings)
const W = 340
const C = ['#4c8bf5', '#2bb3a3', '#e8a33d', '#9b6bdf', '#e0605e', '#6cc24a', '#d96ba0', '#8b93a1']
const TXT = '#8b93a1'
const TRACK = 'rgba(139,147,161,0.18)'
const FONT = 'font-family="system-ui,Segoe UI,sans-serif"'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const svg = (h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" ${FONT} font-size="11">${body}</svg>`

const kpiSvg = (items: { label: string; value: string }[]) => {
  const w = (W - 8 * (items.length - 1)) / items.length
  const tiles = items
    .map((it, i) => {
      const x = i * (w + 8)
      return `<rect x="${x}" y="0" width="${w}" height="52" rx="10" fill="${TRACK}"/>
<text x="${x + 10}" y="19" fill="${TXT}" font-size="10">${esc(it.label)}</text>
<text x="${x + 10}" y="40" fill="${C[i % C.length]}" font-size="19" font-weight="700">${esc(it.value)}</text>`
    })
    .join('')
  return svg(52, tiles)
}

const hbarSvg = (items: { label: string; value: number; note: string }[]) => {
  const max = Math.max(...items.map(i => i.value), 1)
  const x0 = 112
  const bw = W - x0 - 78
  const body = items
    .map((it, i) => {
      const y = i * 24
      const w = Math.max(it.value > 0 ? 3 : 0, (it.value / max) * bw)
      return `<text x="0" y="${y + 14}" fill="${TXT}">${esc(cut(it.label, 17))}</text>
<rect x="${x0}" y="${y + 4}" width="${bw}" height="12" rx="6" fill="${TRACK}"/>
<rect x="${x0}" y="${y + 4}" width="${w}" height="12" rx="6" fill="${C[0]}"/>
<text x="${W}" y="${y + 14}" fill="${TXT}" text-anchor="end">${esc(it.note)}</text>`
    })
    .join('')
  return svg(Math.max(items.length, 1) * 24 + 2, body)
}

const donutSvg = (items: { label: string; value: number; note: string }[]) => {
  const sum = items.reduce((a, i) => a + i.value, 0) || 1
  const r = 44
  const circ = 2 * Math.PI * r
  let acc = 0
  const arcs = items
    .map((it, i) => {
      const len = (it.value / sum) * circ
      const seg = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${C[i % C.length]}" stroke-width="18" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)"/>`
      acc += len
      return seg
    })
    .join('')
  const legend = items
    .slice(0, 6)
    .map((it, i) => {
      const y = 22 + i * 20
      return `<circle cx="140" cy="${y - 4}" r="4.5" fill="${C[i % C.length]}"/>
<text x="150" y="${y}" fill="${TXT}">${esc(cut(it.label.replace('claude-', ''), 15))}</text>
<text x="${W}" y="${y}" fill="${TXT}" text-anchor="end">${esc(it.note)}</text>`
    })
    .join('')
  return svg(120, `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${TRACK}" stroke-width="18"/>${arcs}${legend}`)
}

const stackSvg = (parts: { label: string; value: number }[]) => {
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1
  let x = 0
  const segs = parts
    .map((p, i) => {
      const w = (p.value / sum) * W
      const s = `<rect x="${x}" y="0" width="${Math.max(w, 0)}" height="16" fill="${C[i % C.length]}"/>`
      x += w
      return s
    })
    .join('')
  const legend = parts
    .map((p, i) => {
      const lx = (i % 2) * (W / 2)
      const ly = 36 + Math.floor(i / 2) * 18
      return `<circle cx="${lx + 5}" cy="${ly - 4}" r="4.5" fill="${C[i % C.length]}"/>
<text x="${lx + 15}" y="${ly}" fill="${TXT}">${esc(p.label)} ${pct(p.value, sum)}</text>`
    })
    .join('')
  return svg(36 + Math.ceil(parts.length / 2) * 18, `<clipPath id="c"><rect width="${W}" height="16" rx="8"/></clipPath><g clip-path="url(#c)"><rect width="${W}" height="16" fill="${TRACK}"/>${segs}</g>${legend}`)
}

const columnsSvg = (items: { label: string; value: number }[], color: string, showEvery = 1) => {
  const max = Math.max(...items.map(i => i.value), 1)
  const h = 70
  const slot = W / Math.max(items.length, 1)
  const bw = Math.min(26, slot * 0.7)
  const body = items
    .map((it, i) => {
      const x = i * slot + (slot - bw) / 2
      const bh = it.value > 0 ? Math.max(3, (it.value / max) * h) : 0
      return `<rect x="${x}" y="${h - bh + 14}" width="${bw}" height="${bh}" rx="3" fill="${color}"/>
${it.value > 0 && items.length <= 14 ? `<text x="${x + bw / 2}" y="${h - bh + 11}" fill="${TXT}" text-anchor="middle" font-size="9">${it.value}</text>` : ''}
${i % showEvery === 0 ? `<text x="${x + bw / 2}" y="${h + 28}" fill="${TXT}" text-anchor="middle" font-size="9">${esc(it.label)}</text>` : ''}`
    })
    .join('')
  return svg(h + 34, body)
}

async function refresh($: any) {
  await update($, status, () => ({ isLoading: true }))
  try {
    const script = `${$.plugin.root}/scripts/aggregate.ps1`
    const run = await $.process.run(
      ['powershell', '-NoProfile', '-Command', `& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '${script}')))`],
      { timeoutMs: 120000 },
    )
    if (run.exitCode !== 0) throw new Error(run.stderr.slice(0, 200) || 'exit ' + run.exitCode)
    const data = JSON.parse(run.stdout) as Stats
    await update($, stats, () => data)
    await update($, status, () => ({ isLoading: false }))
  } catch (err) {
    await update($, status, () => ({ isLoading: false, error: String(err) }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-stats', description: 'Usage-Dashboard (Seitenleiste) öffnen' })
    // Dauerhaft rechts angedockt: beim Start öffnen und Daten laden.
    void $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'usage-stats' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($)
    return { text: 'Usage-Dashboard geöffnet.' }
  })

  // Nach jedem Turn die Zahlen auffrischen. Beim Sessionstart ist oft noch keine Oberfläche
  // angeschlossen (ui.open: no-surface), darum die Pane hier erneut öffnen; ein offener Id wird nur umbenannt.
  on('turn.complete', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select, Input, Svg } = $.ui.resolve(e) as any
    const s = await read($, stats)
    const st = await read($, status)
    const v = await read($, view)
    const f = await read($, filter)
    const rng = await read($, range)
    const rFrom = await read($, rangeFrom)
    const rTo = await read($, rangeTo)

    if (!s) {
      return <Text dimColor>{st.error ? 'Fehler: ' + st.error : 'Lade Logs …'}</Text>
    }

    const projects = [...new Set(s.sessions.map(x => x.project))].sort()
    const chats = [...s.sessions].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 40)
    const options = [
      { value: 'all', label: 'Alle Projekte' },
      ...projects.map(p => ({ value: 'p:' + p, label: 'Projekt: ' + p })),
      ...chats.map(c => ({ value: 's:' + c.id, label: `Chat: ${c.start.replace('T', ' ')} · ${c.project}` })),
    ]
    const selected = options.some(o => o.value === f) ? f : 'all'
    const keep = (sid: string, project: string) =>
      selected === 'all' || (selected.startsWith('p:') ? project === selected.slice(2) : sid === selected.slice(2))
    // Zeitfenster: Voreinstellungen zählen vom heutigen Tag (lokal) zurück, 'custom' nimmt von/bis.
    // Ein einzelner Chat ist sein eigener Rahmen und ignoriert das Fenster.
    const today = ymd(new Date(await $.clock.now()))
    const span = RANGES.find(x => x.value === rng)?.days
    const isDate = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x)
    const lo = rng === 'custom' ? (isDate(rFrom) ? rFrom : '') : span ? shiftDay(today, 1 - span) : ''
    const hi = rng === 'custom' ? (isDate(rTo) ? rTo : '') : ''
    const inRange = (day: string) => selected.startsWith('s:') || ((!lo || day >= lo) && (!hi || day <= hi))
    const rows = s.rows.filter(r => keep(r.sid, r.project) && inRange(r.day))
    const sessions = s.sessions.filter(x => keep(x.id, x.project) && inRange(x.start.slice(0, 10)))
    const hours: number[] = new Array(24).fill(0)
    for (const x of sessions) hours[Number(x.start.slice(11, 13))]++

    const sum = (fn: (r: Row) => number) => rows.reduce((a, r) => a + fn(r), 0)
    const all = sum(total)
    const totalCost = sum(cost)
    const unpriced = [...new Set(rows.filter(r => !priceOf(r.model)).map(r => r.model))]

    // Tokens pro Tag / Woche / Projekt
    const keyOf = v === 'day' ? (r: Row) => r.day : v === 'week' ? (r: Row) => weekOf(r.day) : (r: Row) => r.project
    let g = group(rows, keyOf)
    g = v === 'project' ? g.sort((a, b) => b.tokens - a.tokens).slice(0, 10) : g.sort((a, b) => a.key.localeCompare(b.key)).slice(-12)
    const models = group(rows, r => r.model).sort((a, b) => b.tokens - a.tokens)

    const perDay = new Map<string, number>()
    for (const x of sessions) perDay.set(x.start.slice(0, 10), (perDay.get(x.start.slice(0, 10)) ?? 0) + 1)
    const days = [...perDay.entries()].sort().slice(-12)

    const cacheParts = [
      { label: 'Cache-Read', value: sum(r => r.cr) },
      { label: 'Cache-Write', value: sum(r => r.cw) },
      { label: 'Input', value: sum(r => r.input) },
      { label: 'Output', value: sum(r => r.output) },
    ]

    const title = (text: string) => <Text bold>{text}</Text>
    const chart = (source: string, alt: string) => <Svg source={source} alt={alt} width={W} />

    // Ohne Svg (Terminal) bleibt eine knappe Textfassung.
    if (!Svg) {
      return (
        <Box flexDirection="column">
          <Text bold>Usage · {fmt(all)} Tokens · {usd(totalCost)} · {sessions.length} Sitzungen</Text>
          {models.map(x => (
            <Text>{x.key.padEnd(20)} {pct(x.tokens, all)} {usd(x.cost)}</Text>
          ))}
          <Text>Cache-Read {pct(cacheParts[0].value, all)} · Cache-Write {pct(cacheParts[1].value, all)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Select key="filter" label="Ansicht: " options={options} value={selected} onSelect={val => update($, filter, () => val)} />
          <Select
            key="range"
            label="Zeitraum: "
            options={RANGES.map(x => ({ value: x.value, label: x.label }))}
            value={rng}
            onSelect={val => update($, range, () => val)}
          />
        </Box>
        {rng === 'custom' && (
          <Box>
            <Input key="from" label="Von: " placeholder="JJJJ-MM-TT" value={rFrom} onInput={val => update($, rangeFrom, () => val)} onSubmit={val => update($, rangeFrom, () => val)} />
            <Input key="to" label="Bis: " placeholder="JJJJ-MM-TT" value={rTo} onInput={val => update($, rangeTo, () => val)} onSubmit={val => update($, rangeTo, () => val)} />
          </Box>
        )}
        <Box marginTop={1} marginBottom={1}>
          <Button key="d" label={v === 'day' ? '● Pro Tag' : '○ Pro Tag'} onPress={() => update($, view, () => 'day')} />
          <Button key="w" label={v === 'week' ? '● Pro Woche (Mo–So)' : '○ Pro Woche (Mo–So)'} onPress={() => update($, view, () => 'week')} />
          <Button key="p" label={v === 'project' ? '● Pro Projekt' : '○ Pro Projekt'} onPress={() => update($, view, () => 'project')} />
          <Button key="r" label={st.isLoading ? '… lädt' : '↻ Neu laden'} onPress={() => refresh($)} />
        </Box>

        {chart(
          kpiSvg([
            { label: 'Tokens', value: fmt(all) },
            { label: 'Kosten (Liste)', value: usd(totalCost) },
            { label: 'Sitzungen', value: String(sessions.length) },
          ]),
          `Gesamt ${fmt(all)} Tokens, ${usd(totalCost)}, ${sessions.length} Sitzungen`,
        )}

        {title(`Tokens pro ${v === 'day' ? 'Tag' : v === 'week' ? 'Woche' : 'Projekt'}`)}
        <Text dimColor>
          {v === 'day'
            ? 'Ein Balken je Kalendertag.'
            : v === 'week'
              ? 'Ein Balken je Kalenderwoche: alle Tage von Montag bis Sonntag zusammengefasst.'
              : 'Ein Balken je Projekt, über den gewählten Zeitraum summiert.'}
        </Text>
        {chart(
          hbarSvg(
            g.map(x => ({
              label: v === 'week' ? `Woche ab ${x.key.slice(8)}.${x.key.slice(5, 7)}.` : x.key,
              value: x.tokens,
              note: `${fmt(x.tokens)} · ${usd(x.cost)}`,
            })),
          ),
          'Tokens und Kosten je Zeitraum oder Projekt',
        )}

        {title('Modelle')}
        {chart(
          donutSvg(models.map(x => ({ label: x.key, value: x.tokens, note: `${pct(x.tokens, all)} · ${usd(x.cost)}` }))),
          'Verteilung der Tokens auf Modelle',
        )}

        {title('Cache-Anteil')}
        {chart(stackSvg(cacheParts), 'Anteil von Cache-Read, Cache-Write, Input und Output an allen Tokens')}
        <Text dimColor>
          Kosten Cache-Read {usd(sum(readCost))} · Cache-Write {usd(sum(writeCost))}
        </Text>

        {title('Sitzungen pro Tag')}
        {chart(columnsSvg(days.map(([d, n]) => ({ label: d.slice(5), value: n })), C[1]), 'Sitzungen pro Tag')}

        {title('Typische Uhrzeiten (Sitzungsstart)')}
        {chart(columnsSvg(hours.map((n, hour) => ({ label: String(hour), value: n })), C[2], 3), 'Sitzungsstarts nach Uhrzeit')}

        {unpriced.length > 0 && <Text dimColor>Ohne Preis (nicht in Kosten): {unpriced.join(', ')}</Text>}
        <Text dimColor>Stand {s.generated} · Listenpreise der API</Text>
      </Box>
    )
  })
}
