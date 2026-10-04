import { expect, mock, test } from 'claude-code/testing'

const options = {
  provider: 'typesafe',
  typesafeApiKey: 'k',
  typesafeBaseUrl: 'http://jeff.test',
  typesafeModel: 'jeff',
  routeSubagentModel: true,
  minUpgradeConfidence: 0.1,
  minDowngradeConfidence: 0.1,
  logDecisions: false,
} as const

const deep = JSON.stringify({
  model: 'jeff',
  answers: {
    tier: { type: 'choice', probabilities: { fast: 0, balanced: 0, deep: 1 }, choice: 'deep', confidence: 0.95 },
    effort: { type: 'score', probabilities: { '0': 0, '1': 1, '2': 0 }, legend: { '0': 'low', '1': 'medium', '2': 'high' }, score: 1, confidence: 0.9 },
    risky: { type: 'noul', noul: 0.01 },
  },
})

// The backend answers 529 `busy` times, then the decision; spawns record the model they got.
const backend = (on: any, busy: number) => {
  const calls = { n: 0 }
  on('http.fetch', async () => {
    calls.n++
    return calls.n <= busy
      ? { value: { ok: false, status: 529, headers: { 'retry-after': '1' }, text: '{"detail":"busy"}' } }
      : { value: { ok: true, status: 200, headers: {}, text: deep } }
  })
  const spawned: (string | undefined)[] = []
  on('agent.spawn', async (_$: any, e: any) => {
    spawned.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: 'a1' }
  })
  return { calls, spawned }
}

const spawn = ($: any) =>
  $.agent.spawn({ prompt: 'refactor the payment module', description: 'refactor', subagentType: 'general-purpose', parentModel: 'claude-sonnet-5-5', provider: { kind: 'builtin' } })

test('a 529 is retried and the subagent still gets routed', { options: { ...options, busyRetryMs: 50 } }, async ($, on) => {
  const clock = mock.clock(on)
  const { calls, spawned } = backend(on, 2)
  const done = spawn($)
  for (let i = 0; i < 10; i++) await clock.advance(50)
  await done
  expect(calls.n).toBe(3)
  expect(spawned[0]).toBe('opus')
})

test('busyRetryMs 0 does not retry', { options: { ...options, busyRetryMs: 0 } }, async ($, on) => {
  mock.clock(on)
  const { calls, spawned } = backend(on, 1)
  await spawn($)
  expect(calls.n).toBe(1)
  expect(spawned[0]).toBeUndefined()
})
