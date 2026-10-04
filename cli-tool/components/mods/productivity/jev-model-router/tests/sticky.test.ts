import { expect, mock, test } from 'claude-code/testing'

const options = {
  provider: 'typesafe',
  typesafeApiKey: 'k',
  typesafeBaseUrl: 'http://jeff.test',
  typesafeModel: 'jeff',
  routeMainModel: true,
  routeMainEffort: true,
  routeSubagentModel: false,
  minUpgradeConfidence: 0.1,
  minDowngradeConfidence: 0.1,
  logDecisions: false,
  stickyMainModel: true,
} as const

// One Jeff answer: the tier it picks, near-certain, with a risk reading.
const answer = (tier: 'fast' | 'balanced' | 'deep', risky = 0.01) =>
  JSON.stringify({
    model: 'jeff',
    answers: {
      tier: {
        type: 'choice',
        probabilities: { fast: 0, balanced: 0, deep: 0, [tier]: 1 },
        choice: tier,
        confidence: 0.95,
      },
      effort: {
        type: 'score',
        probabilities: { '0': 0.05, '1': 0.9, '2': 0.05 },
        legend: { '0': 'low', '1': 'medium', '2': 'high' },
        score: 1,
        confidence: 0.9,
      },
      risky: { type: 'noul', noul: risky },
    },
    usage: { input_tokens: 1, output_tokens: 0, orders: 1 },
  })



const verdict = { tier: 'balanced', risky: 0.01 }
const bottom = (on: any, seen: { model: string }[]) => {
  on('http.fetch', async () => ({ value: { ok: true, status: 200, headers: {}, text: answer(verdict.tier as any, verdict.risky) } }))
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text, origin: e.origin }))
  on('classic.UserPromptSubmit', async () => ({}))
  on('turn.step', async function* (_$: any, e: any) {
    seen.push({ model: e.model })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

// Drives one main-loop turn and returns the model the request named.
const turn = async ($: any, on: any, seen: { model: string }[], tier: string, risky = 0.01) => {
  verdict.tier = tier
  verdict.risky = risky
  const id = `t${seen.length}`
  await $.prompt.submit({ text: 'do the thing please', wait: false, origin: { kind: 'composer' } })
  const stream = $.turn.step({ turnId: id, index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of stream) void _
  return seen[seen.length - 1]
}

test('first turn picks a model, later turns hold it', { options }, async ($, on) => {
  mock.clock(on)
  const seen: { model: string }[] = []
  bottom(on, seen)
  const first = await turn($, on, seen, 'deep')
  expect(first.model).toContain('opus')
  // Jeff now says "fast", but the model is held.
  const second = await turn($, on, seen, 'fast')
  expect(second.model).toContain('opus')
})

test('a risky verdict may raise the model outside a window', { options }, async ($, on) => {
  mock.clock(on)
  const seen: { model: string }[] = []
  bottom(on, seen)
  const first = await turn($, on, seen, 'fast')
  expect(first.model).toContain('haiku')
  const second = await turn($, on, seen, 'balanced', 0.95)
  expect(second.model).toContain('opus')
})

test('plan -> default reopens the model choice', { options }, async ($, on) => {
  mock.clock(on)
  const seen: { model: string }[] = []
  bottom(on, seen)
  await $.classic.UserPromptSubmit({ prompt: 'plan it', permission_mode: 'plan' })
  const planning = await turn($, on, seen, 'deep')
  expect(planning.model).toContain('opus')
  const held = await turn($, on, seen, 'fast')
  expect(held.model).toContain('opus')
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'default' })
  const executing = await turn($, on, seen, 'fast')
  expect(executing.model).toContain('haiku')
})
