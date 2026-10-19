export type Tier = 'haiku' | 'sonnet' | 'opus'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Choice = { tier: Tier; effort: Effort; reason: string }

export type Question = { q: string; options: string[] }

export type Engineer = {
  original: string
  status: 'thinking' | 'asking' | 'refining' | 'ready'
  questions: Question[]
  answers: string[]
  refined: string
  editing?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    AutoModell: { choice: Choice | null; isOn: boolean; peOn: boolean; pe: Engineer | null }
  }
}
