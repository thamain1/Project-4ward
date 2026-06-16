// Mnemosyne — Unit B+.1: derive a grouping key for a memory entry, frontend-only (no schema).
// Projects group by project; feedback/reference group by topic. Generic: strip known prefixes, apply a
// tiny alias map, take the first token. (Exact, data-backed tags come in B+.2 via a `tags` migration.)

// Prefixes that don't carry the grouping signal — stripped before taking the first token.
const PREFIXES = [/^project-/, /^session-handoff-/, /^feedback-/, /^reference-/]

// Small alias map for tokens that mean the same project/topic. Kept intentionally tiny;
// B+.2's real tags replace this heuristic.
const ALIAS: Record<string, string> = {
  oth: 'onthehash',
  io: 'intellioptics',
  p2p: 'p2pnow',
  '4ward': 'mnemosyne',
  '4wardmotion': 'mnemosyne',
  just: 'just-as-iam',
  isb: 'intelliservice',
  mes: 'intelliservice',
  sb: 'intelliservice',
}

const TITLE_OVERRIDES: Record<string, string> = {
  onthehash: 'OnTheHash',
  intellitax: 'IntelliTax',
  intelliservice: 'IntelliService',
  intellioptics: 'IntelliOptics',
  intellipour: 'IntelliPour',
  intellicity: 'IntelliCity',
  intellimetrics: 'IntelliMetrics',
  intelliproperty: 'IntelliProperty',
  intellisign: 'IntelliSign',
  impacttracker: 'ImpactTracker',
  mentorapp: 'MentorApp',
  p2pnow: 'P2PNow',
  mavenpark: 'MavenPark',
  arsenaliq: 'ArsenalIQ',
  allsigns: 'AllSigns',
  giav: 'GIAV',
  ksos: 'Kingdom Shepherd',
  isb: 'IntelliService (ISB)',
  mes: 'IntelliService (MES)',
  cf: 'Cloudflare',
  supabase: 'Supabase',
  gemini: 'Gemini',
  buildregistry: 'Build Registry',
  mnemosyne: 'Mnemosyne / 4ward',
  'just-as-iam': 'Just-As-I-Am',
}

/** Stable group key for an entry name (lowercase token). */
export function groupKey(name: string): string {
  let s = name.toLowerCase()
  for (const re of PREFIXES) s = s.replace(re, '')
  const first = s.split('-')[0] || 'other'
  return ALIAS[first] ?? first
}

/** Human label for a group key. */
export function groupLabel(key: string): string {
  if (TITLE_OVERRIDES[key]) return TITLE_OVERRIDES[key]
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** Read a single-valued tag by prefix, e.g. tagValue(tags,'repo:') -> 'thamain1/OnTheHash'. */
export function tagValue(tags: string[] | null | undefined, prefix: string): string | undefined {
  return (tags ?? []).find((t) => t.startsWith(prefix))?.slice(prefix.length)
}
export const hasTag = (tags: string[] | null | undefined, tag: string) => (tags ?? []).includes(tag)

/** Grouping key for an entry: prefer the exact `project:`/`topic:` tag (B+.2), else the name heuristic. */
export function entryGroupKey(e: { name: string; tags?: string[] | null }): string {
  return tagValue(e.tags, 'project:') ?? tagValue(e.tags, 'topic:') ?? groupKey(e.name)
}

export type Grouped<T> = { key: string; label: string; items: T[] }

/** Group entries by key (tag-preferred), sorted by descending count then label. */
export function groupEntries<T extends { name: string; tags?: string[] | null }>(entries: T[]): Grouped<T>[] {
  const map = new Map<string, T[]>()
  for (const e of entries) {
    const k = entryGroupKey(e)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(e)
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, label: groupLabel(key), items }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label))
}
