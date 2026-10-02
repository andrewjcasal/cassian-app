/// <reference types="node" />
// Run with `npm test` (Node's built-in test runner; Node strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type CalItem,
  type Todo,
  clock,
  dateAt,
  donePlan,
  durationOptions,
  newBlockStart,
  freeSlot,
  halfSides,
  isDoneEarly,
  menuOptions,
  moveStartPlan,
  moveTodoStartPlan,
  notStartedPlan,
  placeHabits,
  relayout,
  resizeItemPlan,
  resizePlan,
  startNowPlan,
  timeOf,
} from './schedule.ts'

const at = (h: number, m = 0) => h + m / 60
const DAY = '2026-10-01'

function block(id: string, start: number, end: number, extra: Partial<CalItem> = {}): CalItem {
  return { id, title: id, start, end, kind: 'block', done: false, source: 'app', ...extra }
}

function todo(id: string, start: number, end: number, day = DAY): Todo {
  return { id, title: id, day, start, end, habit: false }
}

// Shorthand for comparing moves: "id@HH:MM-HH:MM"
const fmt = (moves: { id: string; start: number; end: number }[]) =>
  moves.map((m) => `${m.id}@${timeOf(m.start).slice(0, 5)}-${timeOf(m.end).slice(0, 5)}`)

test('time formatting rounds on total minutes', () => {
  assert.equal(timeOf(18.99999), '19:00:00')
  assert.equal(timeOf(at(19, 27)), '19:27:00')
  assert.equal(clock(15), '3pm')
  assert.equal(clock(at(19, 15)), '7:15pm')
  assert.equal(clock(0), '12am')
})

test('freeSlot finds the first gap that fits', () => {
  const day = [block('a', 15, 16), block('b', 18, 19), block('c', 19, 20)]
  assert.equal(freeSlot(day, 17, 0.25), 17)
  assert.equal(freeSlot(day, at(18, 30), 0.25), 20)
  assert.equal(freeSlot([...day, block('h', 17, at(17, 15))], 17, 0.25), at(17, 15))
  assert.equal(freeSlot([block('a', 10, 11), block('b', at(11, 6), 12)], at(10, 54), 0.25), 12)
  assert.equal(freeSlot([block('a', 20, 24)], at(23, 54), 0.25), null)
})

test('newBlockStart puts a new todo or follow-up in the first gap from 3pm or the next quarter hour', () => {
  const items = [block('a', 15, 16), block('b', 17, 18), block('c', 18, 21)]
  // Today at 2:40pm: the 3pm floor wins, and 3 to 4 is taken, so 4pm is the first hour gap
  assert.equal(newBlockStart(items, 1, true, at(14, 40)), 16)
  // Today at 4:10pm: next quarter hour is 4:15, but only 45 minutes are free before 5
  assert.equal(newBlockStart(items, 1, true, at(16, 10)), 21)
  assert.equal(newBlockStart(items, 0.5, true, at(16, 10)), at(16, 15))
  // Another day starts looking at 3pm
  assert.equal(newBlockStart(items, 1, false, at(16, 10)), 16)
  assert.equal(newBlockStart([block('late', 15, at(23, 30))], 1, true, at(14, 0)), null)
})

test('placeHabits fills gaps from now and skips habits already placed', () => {
  const items = [block('carve', 18, 19), block('washer', 19, 20), block('followup', 20, at(20, 30))]
  const habits = [
    { id: 'skool', title: 'Skool replies', minutes: 15 },
    { id: 'linkedin', title: 'LinkedIn replies', minutes: 15 },
  ]
  assert.deepEqual(fmt(placeHabits(items, habits, at(18, 6)).map((p) => ({ ...p, id: p.habitId }))), [
    'skool@20:30-20:45',
    'linkedin@20:45-21:00',
  ])
  const withSkool = [...items, block('s', at(20, 30), at(20, 45), { habitId: 'skool', source: 'habit' })]
  assert.deepEqual(
    placeHabits(withSkool, habits, at(18, 6)).map((p) => p.habitId),
    ['linkedin'],
  )
})

test('Start now moves the block to this minute and carries later todos and habits down', () => {
  const carve = block('carve', 18, 19)
  const items = [
    block('oven', 15, 16, { done: true }),
    carve,
    block('washer', 19, 20),
    block('skool', at(20, 30), at(20, 45), { source: 'habit', habitId: 'h1' }),
    block('oldmanual', 21, 22, { source: 'manual' }),
  ]
  const plan = startNowPlan(items, carve, at(18, 12))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['carve@18:12-19:12', 'washer@19:12-20:12', 'skool@20:42-20:57'])
})

test('Start now before the block starts changes nothing', () => {
  const plan = startNowPlan([block('a', 19, 20)], block('a', 19, 20), at(18, 30))
  assert.deepEqual(plan, { moves: [] })
})

test('Start now refuses to run past midnight', () => {
  const late = block('late', 22, at(23, 50))
  assert.ok('error' in startNowPlan([late], late, at(22, 30)))
})

test('Done on a block under way ends it now and moves later blocks up', () => {
  const followup = block('followup', at(19, 15), at(19, 45))
  const items = [followup, block('washer', at(19, 45), at(20, 45)), block('skool', at(20, 45), 21, { source: 'habit' })]
  const plan = donePlan(items, followup, DAY, DAY, at(19, 27))
  assert.equal(plan.endAt, at(19, 27))
  assert.deepEqual(fmt(plan.moves), ['washer@19:27-20:27', 'skool@20:27-20:42'])
})

test('Done at 3pm on a todo running until 4pm pulls the 4pm todos and habits back to 3pm', () => {
  const later = [block('washer', 16, 17), block('skool', 17, at(17, 15), { source: 'habit', habitId: 'h1' })]
  for (const start of [14, 15]) {
    const current = block('current', start, 16)
    const plan = donePlan([current, ...later], current, DAY, DAY, 15)
    assert.equal(plan.endAt, 15, `started at ${start}`)
    assert.deepEqual(fmt(plan.moves), ['washer@15:00-16:00', 'skool@16:00-16:15'], `started at ${start}`)
  }
})

test('Done on a block that is over leaves the schedule alone', () => {
  const over = block('oven', 15, 16)
  const after = block('washer', 16, 17)
  assert.deepEqual(donePlan([over, after], over, DAY, DAY, at(19, 27)), { endAt: null, moves: [] })
  const earlierDay = block('x', 19, 20)
  assert.deepEqual(donePlan([earlierDay, block('y', 20, 21)], earlierDay, '2026-09-30', DAY, at(19, 27)), {
    endAt: null,
    moves: [],
  })
})

test('Done before a block starts frees its slot, so later todos and habits move up alongside it', () => {
  const washer = block('washer', at(19, 45), at(20, 45))
  const items = [washer, block('skool', at(20, 45), 21, { source: 'habit', habitId: 'h1' }), block('old', 21, 22, { source: 'manual' })]
  const plan = donePlan(items, washer, DAY, DAY, at(19, 27))
  assert.equal(plan.endAt, null)
  assert.deepEqual(fmt(plan.moves), ['skool@19:45-20:00'])
  // A later day counts as not started yet too
  const tomorrow = donePlan(items, washer, '2026-10-02', DAY, at(19, 27))
  assert.deepEqual(fmt(tomorrow.moves), ['skool@19:45-20:00'])
})

test('A block done early does not count as taken when finding a gap', () => {
  const items = [block('gray', 16, 17, { done: true, doneEarly: true }), block('b', 17, 18)]
  assert.equal(freeSlot(items, 16, 1), 16)
  assert.equal(freeSlot(items, 16, 1.5), 18)
  assert.equal(freeSlot([block('gray', 16, 17, { done: true, doneEarly: true })], 16, 1), 16)
})

test('isDoneEarly is true only when done before the block starts', () => {
  const tapped = new Date(2026, 9, 1, 19, 27).toISOString()
  assert.equal(isDoneEarly(true, tapped, DAY, at(19, 45)), true)
  assert.equal(isDoneEarly(true, tapped, DAY, 15), false)
  assert.equal(isDoneEarly(true, null, DAY, at(19, 45)), false)
  assert.equal(isDoneEarly(false, tapped, DAY, at(19, 45)), false)
  assert.equal(dateAt(DAY, at(19, 45)).getHours(), 19)
})

test('Not started starts the block now and pushes the rest of the chain out after it', () => {
  const carve = block('carve', 15, 16)
  const items = [
    block('oven', 14, 15, { done: true }),
    carve,
    block('washer', 18, 19),
    block('skool', 19, at(19, 15), { source: 'habit', habitId: 'h1' }),
    block('oldmanual', 20, 21, { source: 'manual' }),
  ]
  // 5:40pm, nothing under way: carve starts now, washer and skool follow it
  const plan = notStartedPlan(items, carve, DAY, DAY, at(17, 40))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['carve@17:40-18:40', 'washer@18:40-19:40', 'skool@19:40-19:55'])
})

test('Not started also pushes a block that is under way', () => {
  const carve = block('carve', 15, 16)
  const items = [carve, block('washer', 18, 19), block('skool', 19, at(19, 15), { source: 'habit', habitId: 'h1' })]
  const plan = notStartedPlan(items, carve, DAY, DAY, at(18, 12))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['carve@18:12-19:12', 'washer@19:12-20:12', 'skool@20:12-20:27'])
})

test('Not started works the same for a habit', () => {
  const skool = block('skool', 15, at(15, 15), { source: 'habit', habitId: 'h1' })
  const plan = notStartedPlan([skool, block('washer', 18, 19)], skool, DAY, DAY, at(17, 50))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['skool@17:50-18:05', 'washer@18:05-19:05'])
})

test('Not started on an earlier day moves the block after that day last block', () => {
  const carve = block('carve', 16, 17)
  const plan = notStartedPlan([carve, block('washer', 17, 18)], carve, '2026-09-30', DAY, at(17, 50))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['carve@18:00-19:00'])
})

test('Not started refuses to run past midnight', () => {
  const carve = block('carve', 15, 16)
  assert.ok('error' in notStartedPlan([carve, block('late', 23, at(23, 50))], carve, DAY, DAY, at(23, 0)))
})

test('resizePlan changes the length and shifts the same day later todos', () => {
  const carve = todo('carve', 16, 17)
  const todos = [carve, todo('washer', 17, 18), todo('tomorrow', 17, 18, '2026-10-02')]
  const plan = resizePlan(todos, carve, 90)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['carve@16:00-17:30', 'washer@17:30-18:30'])
  assert.deepEqual(resizePlan(todos, carve, 60), { moves: [] })
})

test('resizeItemPlan changes a block length and shifts the todos and habits after it', () => {
  const washer = block('washer', at(22, 12), at(23, 12))
  const items = [
    block('done', 20, 21, { done: true }),
    washer,
    block('skool', at(23, 12), at(23, 27), { source: 'habit', habitId: 'h1' }),
    block('old', at(23, 30), at(23, 45), { source: 'manual' }),
  ]
  const longer = resizeItemPlan(items, washer, 30)
  if (!('moves' in longer)) throw new Error(longer.error)
  assert.deepEqual(fmt(longer.moves), ['washer@22:12-22:42', 'skool@22:42-22:57'])
  assert.deepEqual(resizeItemPlan(items, washer, 60), { moves: [] })
  assert.ok('error' in resizeItemPlan(items, washer, 120))
})

test('Lengthening pushes later blocks only as far as needed, so a block after a gap stays put', () => {
  const linkedin = block('linkedin', at(19, 56), at(20, 41), { done: true, source: 'habit', habitId: 'h2' })
  const items = [linkedin, block('washer', at(22, 42), at(23, 42))]
  const plan = resizeItemPlan(items, linkedin, 80)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['linkedin@19:56-21:16'])
})

test('Lengthening into a back to back run pushes the run along, stopping at the first gap', () => {
  const a = block('a', 18, 19)
  const items = [a, block('b', 19, 20), block('c', 20, 21), block('d', 22, 23)]
  const plan = resizeItemPlan(items, a, 90)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['a@18:00-19:30', 'b@19:30-20:30', 'c@20:30-21:30'])
})

test('Shortening pulls up only the back to back run after it', () => {
  const a = block('a', 18, 19)
  const items = [a, block('b', 19, 20), block('c', 21, 22)]
  const plan = resizeItemPlan(items, a, 30)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['a@18:00-18:30', 'b@18:30-19:30'])
})

test('Todos tab resize follows the same push and pull rules', () => {
  const a = todo('a', 18, 19)
  const todos = [a, todo('b', 19, 20), todo('c', 22, 23)]
  const longer = resizePlan(todos, a, 90)
  if (!('moves' in longer)) throw new Error(longer.error)
  assert.deepEqual(fmt(longer.moves), ['a@18:00-19:30', 'b@19:30-20:30'])
  const shorter = resizePlan(todos, a, 30)
  if (!('moves' in shorter)) throw new Error(shorter.error)
  assert.deepEqual(fmt(shorter.moves), ['a@18:00-18:30', 'b@18:30-19:30'])
})

test('Moving a block later keeps its length and pushes only the blocks it now overlaps', () => {
  const washer = block('washer', at(22, 42), at(23, 42))
  const items = [block('linkedin', 20, 21, { done: true }), washer]
  const plan = moveStartPlan(items, washer, at(22, 12))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['washer@22:12-23:12'])

  const a = block('a', 18, 19)
  const chain = [a, block('b', 19, 20), block('c', 20, 21), block('d', 23, 24)]
  const later = moveStartPlan(chain, a, at(18, 30))
  if (!('moves' in later)) throw new Error(later.error)
  assert.deepEqual(fmt(later.moves), ['a@18:30-19:30', 'b@19:30-20:30', 'c@20:30-21:30'])
})

test('Moving a block earlier moves only that block', () => {
  const b = block('b', 20, 21)
  const plan = moveStartPlan([block('a', 18, 19), b, block('c', 21, 22)], b, at(18, 30))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['b@18:30-19:30'])
})

test('Moving a block refuses to run past midnight', () => {
  const a = block('a', 20, 21)
  assert.ok('error' in moveStartPlan([a], a, at(23, 30)))
})

test('Moving a todo from the Todos tab follows the same rules', () => {
  const a = todo('a', 18, 19)
  const plan = moveTodoStartPlan([a, todo('b', 19, 20), todo('c', 22, 23)], a, at(18, 30))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['a@18:30-19:30', 'b@19:30-20:30'])
})

test('relayout re-packs the swapped range back to back', () => {
  const washer = todo('washer', at(19, 15), at(20, 15))
  const followup = todo('followup', at(20, 15), at(20, 45))
  const x = todo('x', 21, 22)
  assert.deepEqual(fmt(relayout([washer, followup, x], [followup, washer, x])), [
    'followup@19:15-19:45',
    'washer@19:45-20:45',
  ])
  assert.deepEqual(relayout([washer, followup], [washer, followup]), [])
  assert.deepEqual(fmt(relayout([washer, followup, x], [x, washer, followup])), [
    'x@19:15-20:15',
    'washer@20:15-21:15',
    'followup@21:15-21:45',
  ])
})

test('menuOptions follows the block timing', () => {
  const keys = (item: CalItem, day: string, now: number) => menuOptions(item, day, DAY, now).map(([k]) => k).join(',')
  const now = at(18, 12)
  assert.equal(keys(block('ended', 15, 16), DAY, now), 'done,not_started,follow_up')
  assert.equal(keys(block('underway', 18, 19), DAY, now), 'start_now,done')
  assert.equal(keys(block('later', 19, 20), DAY, now), 'done,follow_up')
  assert.equal(keys(block('earlier day', 19, 20), '2026-09-30', now), 'done,not_started,follow_up')
  assert.equal(keys(block('later day', 9, 10), '2026-10-02', now), 'done,follow_up')
  assert.equal(keys(block('done', 15, 16, { done: true }), DAY, now), 'not_started,follow_up')
  assert.equal(keys(block('done later', 19, 20, { done: true }), DAY, now), 'follow_up')
})

test('durationOptions shows the next shorter and longer steps', () => {
  assert.deepEqual(durationOptions(30), [15, 30, 45])
  assert.deepEqual(durationOptions(45), [30, 45, 60])
  assert.deepEqual(durationOptions(15), [5, 15, 30])
  assert.deepEqual(durationOptions(5), [5, 15])
  assert.deepEqual(durationOptions(60), [45, 60, 90])
  assert.deepEqual(durationOptions(50), [45, 50, 60])
})

test('halfSides: short and done early blocks take half, and an overlapped block takes the other half', () => {
  const first = 16
  const top = (h: number) => (Math.max(h, first) - first) * 48
  const today = [
    block('carve', at(18, 15), at(19, 15)),
    block('followup', at(19, 15), at(19, 27)),
    block('washer', at(19, 29), at(20, 29)),
    block('skool', at(20, 29), at(20, 44)),
    block('linkedin', at(20, 44), at(20, 59)),
  ]
  assert.deepEqual(Object.fromEntries(halfSides(today, top, 20)), {
    followup: 'left',
    washer: 'right',
    skool: 'left',
    linkedin: 'right',
  })
  assert.equal(halfSides([block('a', 10, 11), block('b', 12, 13)], top, 20).size, 0)
  assert.deepEqual(Object.fromEntries(halfSides([block('early', 21, 22, { doneEarly: true })], top, 20)), {
    early: 'left',
  })
})
