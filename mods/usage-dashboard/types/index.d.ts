export type Row = { sid: string; day: string; project: string; model: string; input: number; output: number; cw: number; cr: number; n: number }
export type Sess = { id: string; start: string; project: string }
export type Stats = { rows: Row[]; sessions: Sess[]; hours: number[]; generated: string }
export type Status = { isLoading: boolean; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-dashboard': {
      stats: Stats | null
      view: 'day' | 'week' | 'project'
      status: Status
      // 'all' | 'p:<Projekt>' | 's:<Sitzungs-ID>'
      filter: string
      // 'today' | '7d' | '30d' | '90d' | 'all' | 'custom'
      range: string
      // bei 'custom': JJJJ-MM-TT
      rangeFrom: string
      rangeTo: string
    }
  }
}
