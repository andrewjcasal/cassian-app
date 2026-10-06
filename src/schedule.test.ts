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
  doneNowPlan,
  doneAtEnd,
  durationOptions,
  fromStored,
  logicalNow,
  toStored,
  newBlockStart,
  freeSlot,
  halfSides,
  isDoneEarly,
  menuOptions,
  moveStartPlan,
  moveTodoStartPlan,
  notStartedPlan,
  advanceTimer,
  extendStep,
  resumeTimer,
  dayChoice,
  groupByDay,
  nightBefore,
  habitHistory,
  routineFrom,
  habitStartHours,
  habitStartValue,
  startTimeOptions,
  swipeDays,
  switchRoutine,
  insertAtPlan,
  interruptPlan,
  habitsForDay,
  weekStart,
  habitSearchFrom,
  anytimeSearchFrom,
  moveToDayStart,
  lastTimes,
  averageMinutes,
  themeRows,
  placeHabits,
  quarterOf,
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
  assert.equal(freeSlot([block('a', 20, 26)], at(25, 54), 0.25), null)
  assert.equal(freeSlot([block('a', 20, 24)], at(23, 54), 0.25), 24)
})

test('newBlockStart puts a new todo or follow-up in the first gap from 8am or the next quarter hour', () => {
  const items = [block('a', 15, 16), block('b', 17, 18), block('c', 18, 21)]
  // Today at 9:05am: it starts at the next quarter hour, not waiting for the afternoon
  assert.equal(newBlockStart(items, 1, true, at(9, 5)), at(9, 15))
  // Today at 2:40pm: next quarter hour is 2:45, but 3 to 4 is taken, so 4pm is the first hour gap
  assert.equal(newBlockStart(items, 1, true, at(14, 40)), 16)
  // Today at 4:10pm: only 45 minutes are free before 5
  assert.equal(newBlockStart(items, 1, true, at(16, 10)), 21)
  assert.equal(newBlockStart(items, 0.5, true, at(16, 10)), at(16, 15))
  // Before 8am today, and on another day, it starts looking at 8am
  assert.equal(newBlockStart(items, 1, true, at(6, 30)), 8)
  assert.equal(newBlockStart(items, 1, false, at(16, 10)), 8)
  assert.equal(newBlockStart([block('busy', 8, at(23, 30))], 1, false, at(16, 10)), at(23, 30))
  assert.equal(newBlockStart([block('busy', 8, at(25, 30))], 1, false, at(16, 10)), null)
})

test('placeHabits fills gaps from now and skips habits already placed', () => {
  const items = [block('carve', 18, 19), block('washer', 19, 20), block('followup', 20, at(20, 30))]
  const habits = [
    { id: 'skool', title: 'Skool replies', minutes: 15 },
    { id: 'linkedin', title: 'LinkedIn replies', minutes: 15 },
  ]
  assert.deepEqual(fmt(placeHabits(items, habits, habitSearchFrom(DAY, DAY, at(18, 6))!).map((p) => ({ ...p, id: p.habitId }))), [
    'skool@20:30-20:45',
    'linkedin@20:45-21:00',
  ])
  const withSkool = [...items, block('s', at(20, 30), at(20, 45), { habitId: 'skool', source: 'habit' })]
  assert.deepEqual(
    placeHabits(withSkool, habits, habitSearchFrom(DAY, DAY, at(18, 6))!).map((p) => p.habitId),
    ['linkedin'],
  )
})

test('Habits on an upcoming day fill gaps from 3pm; on today from the next quarter hour', () => {
  const habits = [
    { id: 'skool', title: 'Skool replies', minutes: 15 },
    { id: 'linkedin', title: 'LinkedIn replies', minutes: 15 },
  ]
  assert.equal(habitSearchFrom(DAY, DAY, at(18, 6)), at(18, 15))
  assert.equal(habitSearchFrom('2026-10-03', DAY, at(18, 6)), 15)
  const saturday = placeHabits([block('a', 15, 16)], habits, habitSearchFrom('2026-10-03', DAY, at(18, 6))!)
  assert.deepEqual(fmt(saturday.map((p) => ({ ...p, id: p.habitId }))), ['skool@16:00-16:15', 'linkedin@16:15-16:30'])
  // A past day gets none
  assert.equal(habitSearchFrom('2026-09-30', DAY, at(18, 6)), null)
})

test('habitHistory lists each day from the first through today, newest first', () => {
  const rows = [
    { logical_day: '2026-09-29', done: true, start: at(19, 41), end: at(19, 56) },
    { logical_day: '2026-10-01', done: false, start: 15, end: at(15, 15) },
    { logical_day: '2026-10-02', done: true, start: at(11, 45), end: at(12, 30) },
    { logical_day: '2026-10-03', done: false, start: 15, end: at(15, 15) }, // upcoming, left off
  ]
  assert.deepEqual(habitHistory(rows, '2026-10-02'), [
    { day: '2026-10-02', status: 'done', start: at(11, 45), minutes: 45 },
    { day: '2026-10-01', status: 'missed' },
    { day: '2026-09-30', status: 'missed' }, // never placed, counts as not done
    { day: '2026-09-29', status: 'done', start: at(19, 41), minutes: 15 },
  ])
})

test('habitHistory marks today as pending until it is done', () => {
  assert.deepEqual(habitHistory([{ logical_day: '2026-10-02', done: false, start: 15, end: at(15, 15) }], '2026-10-02'), [
    { day: '2026-10-02', status: 'pending' },
  ])
  assert.deepEqual(habitHistory([], '2026-10-02'), [])
})

test('habitsForDay: daily habits every day, weekly habits only on their weekday', () => {
  const habits = [
    { id: 'skool', frequency: 'daily' as const, weekday: null },
    { id: 'plan', frequency: 'weekly' as const, weekday: 6 }, // Saturday
    { id: 'unset', frequency: 'weekly' as const, weekday: null }, // no day picked yet
  ]
  // 2026-10-03 is a Saturday, 2026-10-02 a Friday
  assert.deepEqual(habitsForDay(habits, '2026-10-03').map((h) => h.id), ['skool', 'plan'])
  assert.deepEqual(habitsForDay(habits, '2026-10-02').map((h) => h.id), ['skool'])
})

test('weekStart is the Sunday that starts the week', () => {
  assert.equal(weekStart('2026-10-03'), '2026-09-27') // Saturday
  assert.equal(weekStart('2026-10-04'), '2026-10-04') // Sunday
  assert.equal(weekStart('2026-10-05'), '2026-10-04') // Monday
})

test('habitsForDay skips a weekly habit already placed elsewhere that week', () => {
  const habits = [
    { id: 'skool', frequency: 'daily' as const, weekday: null },
    { id: 'plan', frequency: 'weekly' as const, weekday: 6 }, // Saturdays
  ]
  // Moved to Friday 10/2 this week, so Saturday 10/3 doesn't place it again
  assert.deepEqual(habitsForDay(habits, '2026-10-03', [{ habit_id: 'plan', logical_day: '2026-10-02' }]).map((h) => h.id), ['skool'])
  // A block last week doesn't count
  assert.deepEqual(habitsForDay(habits, '2026-10-03', [{ habit_id: 'plan', logical_day: '2026-09-26' }]).map((h) => h.id), ['skool', 'plan'])
})

test('A weekly habit moved to another week keeps counting for the week it was placed for', () => {
  const habits = [{ id: 'plan', frequency: 'weekly' as const, weekday: 6 }]
  // Last week's (week of 9/20) done late on Sunday 9/27: this Saturday still gets one
  assert.deepEqual(
    habitsForDay(habits, '2026-10-03', [{ habit_id: 'plan', logical_day: '2026-09-27', habit_week: '2026-09-20' }]).map((h) => h.id),
    ['plan'],
  )
  // History: the late Sunday shows as last week done, this week still pending
  const rows = [
    { logical_day: '2026-09-27', done: true, start: 10, end: 11, habit_week: '2026-09-20' },
    { logical_day: '2026-10-03', done: false, start: 15, end: 16, habit_week: '2026-09-27' },
  ]
  assert.deepEqual(
    habitHistory(rows, '2026-10-03', 6).map((r) => `${r.day} ${r.status}`),
    ['2026-09-27 pending', '2026-09-20 done'],
  )
})

test('habitHistory for a weekly habit has one row per week, done if any day was', () => {
  const rows = [
    { logical_day: '2026-09-18', done: true, start: 10, end: 11 }, // Fri, week of 9/13 (moved)
    { logical_day: '2026-10-03', done: false, start: 15, end: 16 }, // this week
  ]
  assert.deepEqual(
    habitHistory(rows, '2026-10-03', 6).map((r) => `${r.day} ${r.status}`),
    ['2026-09-27 pending', '2026-09-20 missed', '2026-09-13 done'],
  )
})

test('interruptPlan starts the block now and pushes the todos and habits not finished after it', () => {
  const items = [
    block('done', 15, 16, { done: true }),
    block('washer', 18, 19), // under way at 6:12
    block('skool', 19, at(19, 15), { source: 'habit', habitId: 'h1' }),
    block('old', 20, 21, { source: 'manual' }), // not carried
  ]
  const plan = interruptPlan(items, at(18, 12), 0.25)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual([plan.start, plan.end], [at(18, 12), at(18, 27)])
  assert.deepEqual(fmt(plan.moves), ['washer@18:27-19:27', 'skool@19:27-19:42'])
})

test('interruptPlan with nothing on leaves everything alone, and refuses past 2am', () => {
  const plan = interruptPlan([block('later', 21, 22)], at(18, 12), 0.25)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), [])
  assert.ok('error' in interruptPlan([], at(25, 55), 0.25))
})

test('routineFrom runs from the picked step to the end', () => {
  const shutdown = [
    { name: 'Dishwasher', minutes: 5 },
    { name: 'Empty sink', minutes: 5 },
    { name: 'Wet food', minutes: 5 },
    { name: 'Puzzles', minutes: null },
  ]
  const names = (start: string) => routineFrom(shutdown, start).map((s) => s.name)
  assert.deepEqual(names('Dishwasher'), ['Dishwasher', 'Empty sink', 'Wet food', 'Puzzles'])
  assert.deepEqual(names('Empty sink'), ['Empty sink', 'Wet food', 'Puzzles'])
  assert.deepEqual(names('Wet food'), ['Wet food', 'Puzzles'])
})

test('advanceTimer moves to the next step when time is up, even several steps at once', () => {
  const steps = [
    { name: 'Empty sink', minutes: 5 },
    { name: 'Wet food', minutes: 5 },
    { name: 'Puzzles', minutes: null },
  ]
  const t0 = 1_000_000
  const min = 60_000
  // 3 minutes in: still on Empty sink, 2 minutes left
  assert.deepEqual(advanceTimer(steps, 0, t0, t0 + 3 * min), { index: 0, stepStartedAt: t0, remainingMs: 2 * min, elapsedMs: 3 * min })
  // 6 minutes in: Wet food, started at 5, 4 minutes left
  assert.deepEqual(advanceTimer(steps, 0, t0, t0 + 6 * min), { index: 1, stepStartedAt: t0 + 5 * min, remainingMs: 4 * min, elapsedMs: min })
  // 13 minutes in (phone was locked): through Wet food into Puzzles, which counts up
  assert.deepEqual(advanceTimer(steps, 0, t0, t0 + 13 * min), { index: 2, stepStartedAt: t0 + 10 * min, remainingMs: null, elapsedMs: 3 * min })
})

test('Anytime habits go back to back from 8am, before the habits that wait for 3pm', () => {
  const habits = [
    { id: 'skool', title: 'Skool replies', minutes: 15, anytime: true },
    { id: 'linkedin', title: 'LinkedIn replies', minutes: 15, anytime: true },
    { id: 'shower', title: 'Shower', minutes: 30 },
  ]
  const tomorrow = '2026-10-03'
  const placed = placeHabits([], habits, habitSearchFrom(tomorrow, DAY, at(18, 6))!, anytimeSearchFrom(tomorrow, DAY, at(18, 6))!)
  assert.deepEqual(fmt(placed.map((p) => ({ ...p, id: p.habitId }))), ['skool@08:00-08:15', 'linkedin@08:15-08:30', 'shower@15:00-15:30'])
})

test('Today, anytime habits start from the next quarter hour, never before 8am', () => {
  assert.equal(anytimeSearchFrom(DAY, DAY, at(8, 4)), at(8, 15))
  assert.equal(anytimeSearchFrom(DAY, DAY, at(6, 30)), 8)
  assert.equal(anytimeSearchFrom('2026-10-03', DAY, at(18, 6)), 8)
  assert.equal(anytimeSearchFrom('2026-09-30', DAY, at(18, 6)), null)
  // An 8am todo already there: they go after it, still back to back
  const items = [block('gym', 8, 9)]
  const habits = [
    { id: 'skool', title: 'Skool replies', minutes: 15, anytime: true },
    { id: 'linkedin', title: 'LinkedIn replies', minutes: 15, anytime: true },
  ]
  assert.deepEqual(fmt(placeHabits(items, habits, 15, 8).map((p) => ({ ...p, id: p.habitId }))), ['skool@09:00-09:15', 'linkedin@09:15-09:30'])
})

test('Auto-schedule: a todo moved to another day takes that day\'s first open time from 8am', () => {
  const tomorrow = '2026-10-03'
  assert.equal(moveToDayStart([], 0.5, tomorrow, DAY, at(21, 0)), 8)
  assert.equal(moveToDayStart([block('gym', 8, 9), block('call', 9, at(9, 30))], 0.5, tomorrow, DAY, at(21, 0)), at(9, 30))
  // A gap too short for it is skipped
  assert.equal(moveToDayStart([block('a', 8, at(8, 15)), block('b', at(8, 30), 10)], 0.5, tomorrow, DAY, at(21, 0)), 10)
})

test('Auto-schedule: a todo moved to today starts at the next open time from now', () => {
  assert.equal(moveToDayStart([], 0.5, DAY, DAY, at(21, 0)), 21)
  assert.equal(moveToDayStart([block('x', 21, 22)], 0.5, DAY, DAY, at(20, 50)), 22)
  // Before 8am it waits for 8
  assert.equal(moveToDayStart([], 0.5, DAY, DAY, at(6, 30)), 8)
  // A past day has no open time to find
  assert.equal(moveToDayStart([], 0.5, '2026-09-30', DAY, at(21, 0)), null)
})

test('A set-time habit like Shut down can still be moved by hand with its start slider', () => {
  const shutdown = block('shutdown', at(22, 30), at(23, 15), { source: 'habit', habitId: 'h', fixed: true })
  const plan = moveStartPlan([block('todo', 20, 21), shutdown], shutdown, 23)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['shutdown@23:00-23:45'])
  const todoPlan = moveTodoStartPlan([{ ...todo('shutdown', at(22, 30), at(23, 15)), fixed: true }], { ...todo('shutdown', at(22, 30), at(23, 15)), fixed: true }, 22)
  if (!('moves' in todoPlan)) throw new Error(todoPlan.error)
  assert.deepEqual(fmt(todoPlan.moves), ['shutdown@22:00-22:45'])
})

test('Last times: the most recent completed runs of a habit, newest first, with end and length', () => {
  const runs = [
    { day: '2026-10-01', start: 22, end: at(22, 40), done: true },
    { day: '2026-10-03', start: at(22, 30), end: at(23, 5), done: true },
    { day: '2026-10-02', start: 23, end: at(23, 45), done: false },
    { day: '2026-10-04', start: at(21, 50), end: at(22, 20), done: true },
  ]
  assert.deepEqual(lastTimes(runs, 2), [
    { day: '2026-10-04', end: at(22, 20), minutes: 30 },
    { day: '2026-10-03', end: at(23, 5), minutes: 35 },
  ])
  assert.deepEqual(lastTimes([], 5), [])
})

test('avg: the last 5 completed runs averaged, to the nearest 15 minutes', () => {
  const run = (day: string, minutes: number, done = true) => ({ day, start: 22, end: 22 + minutes / 60, done })
  // 44, 45, 45, 60, 40 average 46.8, which rounds to 45
  const runs = [run('2026-10-05', 44), run('2026-10-04', 45), run('2026-10-03', 45), run('2026-10-02', 60), run('2026-10-01', 40), run('2026-09-30', 120)]
  assert.equal(averageMinutes(runs, 5), 45)
  // Unfinished runs don't count, and a short habit never rounds down to 0
  assert.equal(averageMinutes([run('2026-10-05', 5), run('2026-10-04', 90, false)], 5), 15)
  assert.equal(averageMinutes([run('2026-10-05', 20), run('2026-10-04', 30)], 5), 30)
  assert.equal(averageMinutes([], 5), null)
})

test('Themes: each shows its open todos and the next one, and themes with no next step come first', () => {
  const themes = [
    { id: 'gift', title: 'Gift for Ollie', sort_order: 1 },
    { id: 'cable', title: 'Cable organizing for the office', sort_order: 2 },
    { id: 'net', title: 'Networking', sort_order: 3 },
  ]
  const steps = [
    { themeId: 'net', day: '2026-10-08', start: 10, done: false },
    { themeId: 'net', day: '2026-10-06', start: 16, done: false },
    { themeId: 'gift', day: '2026-10-09', start: 9, done: false },
    { themeId: 'cable', day: '2026-10-05', start: 9, done: true },
  ]
  assert.deepEqual(themeRows(themes, steps), [
    { id: 'cable', title: 'Cable organizing for the office', open: 0, next: null },
    { id: 'net', title: 'Networking', open: 2, next: { day: '2026-10-06', start: 16 } },
    { id: 'gift', title: 'Gift for Ollie', open: 1, next: { day: '2026-10-09', start: 9 } },
  ])
})

test('placeHabits puts a set-time habit at its time first, and the rest fill gaps around it', () => {
  const habits = [
    { id: 'skool', title: 'Skool replies', minutes: 15 },
    { id: 'shutdown', title: 'Shut down', minutes: 15, start: 23 },
  ]
  // From 10:50pm only 10 minutes are free before Shut down at 11, so Skool goes after it
  const placed = placeHabits([block('a', 21, at(22, 50))], habits, at(22, 50))
  assert.deepEqual(fmt(placed.map((p) => ({ ...p, id: p.habitId }))), ['shutdown@23:00-23:15', 'skool@23:15-23:30'])
  // Placed at 11pm even when it's already later than that
  const late = placeHabits([], [habits[1]], at(23, 30))
  assert.deepEqual(fmt(late.map((p) => ({ ...p, id: p.habitId }))), ['shutdown@23:00-23:15'])
})

test('A fixed habit block is never moved by the rules that push or pull later blocks', () => {
  const shutdown = block('shutdown', 23, at(23, 15), { source: 'habit', habitId: 'h3', fixed: true })
  const washer = block('washer', 22, 23)
  const items = [washer, shutdown]
  const ids = (plan: { moves: { id: string }[] } | { error: string }) => {
    if (!('moves' in plan)) throw new Error(plan.error)
    return plan.moves.map((m) => m.id)
  }
  assert.deepEqual(ids(startNowPlan(items, washer, at(22, 10))), ['washer'])
  assert.deepEqual(donePlan(items, washer, DAY, DAY, at(22, 30)).moves.map((m) => m.id), [])
  assert.deepEqual(ids(notStartedPlan([block('x', 15, 16), ...items], block('x', 15, 16), DAY, DAY, at(21, 50))), ['x', 'washer'])
  assert.deepEqual(ids(resizeItemPlan(items, washer, 90)), ['washer'])
  assert.deepEqual(ids(moveStartPlan(items, washer, at(22, 30))), ['washer'])
  const interrupt = interruptPlan(items, at(22, 50), 0.5)
  if (!('moves' in interrupt)) throw new Error(interrupt.error)
  assert.deepEqual(interrupt.moves.map((m) => m.id), ['washer'])
})

test('A fixed block offers no Start now or Not started', () => {
  const keys = (item: CalItem, now: number) => menuOptions(item, DAY, DAY, now).map(([k]) => k).join(',')
  const shutdown = block('shutdown', 23, at(23, 15), { source: 'habit', fixed: true })
  assert.equal(keys(shutdown, at(23, 5)), 'done')
  assert.equal(keys(shutdown, at(23, 30)), 'done,follow_up')
})

test('Fixed todos stay put on the Todos tab: resize and reorder leave them alone', () => {
  const a = todo('a', 22, 23)
  const shutdown = { ...todo('shutdown', 23, at(23, 15)), fixed: true }
  const resized = resizePlan([a, shutdown], a, 90)
  if (!('moves' in resized)) throw new Error(resized.error)
  assert.deepEqual(resized.moves.map((m) => m.id), ['a'])
  const b = todo('b', at(23, 15), at(23, 45))
  assert.deepEqual(relayout([a, shutdown, b], [b, shutdown, a]).map((u) => u.id).sort(), ['a', 'b'])
})

test('resumeTimer shifts the step start by the paused stretch, so the time left is unchanged', () => {
  const steps = [
    { name: 'Dishwasher', minutes: 5 },
    { name: 'Empty sink', minutes: 5 },
  ]
  const t0 = 1_000_000
  const min = 60_000
  // Paused 2 minutes in, for 10 minutes
  const pausedAt = t0 + 2 * min
  const resumedAt = pausedAt + 10 * min
  const start = resumeTimer(t0, pausedAt, resumedAt)
  assert.equal(start, t0 + 10 * min)
  const after = advanceTimer(steps, 0, start, resumedAt)
  assert.deepEqual([after.index, after.remainingMs], [0, 3 * min])
})

test('switchRoutine jumps to a routine step and runs on from it', () => {
  const routine = [
    { name: 'Dishwasher', minutes: 5 },
    { name: 'Empty sink', minutes: 5 },
    { name: 'Wet food', minutes: 5 },
    { name: 'Puzzles', minutes: null },
  ]
  const running = routineFrom(routine, 'Dishwasher')
  assert.deepEqual(switchRoutine(routine, running, 0, { step: 'Wet food' }).map((s) => s.name), ['Wet food', 'Puzzles'])
  // Back to an earlier one works too
  assert.deepEqual(switchRoutine(routine, running.slice(2), 0, { step: 'Empty sink' }).map((s) => s.name), [
    'Empty sink',
    'Wet food',
    'Puzzles',
  ])
})

test('switchRoutine puts a one-off in now, counting down from 5 minutes, then back to the step it interrupted', () => {
  const routine = [
    { name: 'Dishwasher', minutes: 5 },
    { name: 'Empty sink', minutes: 5 },
    { name: 'Puzzles', minutes: null },
  ]
  const running = routineFrom(routine, 'Dishwasher')
  const next = switchRoutine(routine, running, 1, { oneOff: 'Reply to Mehran' })
  assert.deepEqual(next, [
    { name: 'Reply to Mehran', minutes: 5, oneOff: true },
    { name: 'Empty sink', minutes: 5 },
    { name: 'Puzzles', minutes: null },
  ])
})

test('extendStep adds a minute to the step that is counting down', () => {
  const steps = [{ name: 'Dishwasher', minutes: 5 }, { name: 'Puzzles', minutes: null }]
  const t0 = 1_000_000
  const min = 60_000
  // 4 minutes in, 1 left; +1 min makes it 2 left
  const start = extendStep(t0, 1)
  assert.deepEqual([advanceTimer(steps, 0, start, t0 + 4 * min).index, advanceTimer(steps, 0, start, t0 + 4 * min).remainingMs], [0, 2 * min])
  // Without it, 5 minutes in would already be Puzzles; with it, still Dishwasher
  assert.equal(advanceTimer(steps, 0, start, t0 + 5 * min).index, 0)
})

test('advanceTimer stays on the last step at 0:00 once it has counted down', () => {
  const steps = [
    { name: 'Wet food', minutes: 5 },
    { name: 'Puzzles', minutes: 5, afterChores: true },
  ]
  const t0 = 1_000_000
  const min = 60_000
  const end = advanceTimer(steps, 0, t0, t0 + 12 * min)
  assert.deepEqual([end.index, end.remainingMs], [1, 0])
})

test('insertAtPlan puts a todo at the tapped time and pushes the todos and habits from there on', () => {
  const items = [
    block('earlier', 14, 15),
    block('washer', 16, 17),
    block('skool', 17, at(17, 15), { source: 'habit', habitId: 'h1' }),
    block('shutdown', 23, at(23, 15), { source: 'habit', fixed: true }),
    block('later', 20, 21),
  ]
  const plan = insertAtPlan(items, 16, 1)
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual([plan.start, plan.end], [16, 17])
  // washer and skool follow on; later at 8pm already clears, earlier and Shut down stay
  assert.deepEqual(fmt(plan.moves), ['washer@17:00-18:00', 'skool@18:00-18:15'])
  assert.ok('error' in insertAtPlan([], at(25, 30), 1))
})

test('quarterOf rounds a tapped time to the nearest quarter hour', () => {
  assert.equal(quarterOf(at(16, 7)), 16)
  assert.equal(quarterOf(at(16, 8)), at(16, 15))
  assert.equal(quarterOf(at(16, 52)), at(16, 45))
  assert.equal(quarterOf(at(16, 53)), 17)
})

test('swipeDays: a clearly sideways swipe moves a day, anything else does nothing', () => {
  assert.equal(swipeDays(-90, 10), 1) // swipe left: next day
  assert.equal(swipeDays(90, -12), -1) // swipe right: previous day
  assert.equal(swipeDays(-40, 0), 0) // too short
  assert.equal(swipeDays(-90, 70), 0) // too diagonal, probably a scroll
})

test('An event is never moved: rules only carry todos and habits', () => {
  const washer = block('washer', 16, 17)
  const event = block('dentist', 17, 18, { source: 'event', fixed: true })
  const items = [washer, event, block('skool', 18, at(18, 15), { source: 'habit' })]
  const ids = (plan: { moves: { id: string }[] } | { error: string }) => {
    if (!('moves' in plan)) throw new Error(plan.error)
    return plan.moves.map((m) => m.id)
  }
  assert.ok(!ids(startNowPlan(items, washer, at(16, 30))).includes('dentist'))
  assert.ok(!ids(resizeItemPlan(items, washer, 120)).includes('dentist'))
  assert.ok(!ids(insertAtPlan(items, 16, 1)).includes('dentist'))
  // An event has no done state and no follow-up, so its menu is empty
  assert.deepEqual(menuOptions(event, DAY, DAY, at(17, 30)), [])
  assert.deepEqual(menuOptions(event, DAY, DAY, at(19, 0)), [])
})

test('An event pushes off every todo and habit it overlaps, even one that started earlier', () => {
  const items = [
    block('before', 15, at(16, 30)), // runs into a 4pm event
    block('during', at(16, 30), at(17, 30)),
    block('after', at(17, 30), 18),
    block('clear', 15, 16), // ends right as the event starts, stays
  ]
  const plan = insertAtPlan(items, 16, 1, { evictOverlap: true })
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['before@17:00-18:30', 'during@18:30-19:30', 'after@19:30-20:00'])
  // A todo added the same way leaves the earlier one where it is
  const asTodo = insertAtPlan(items, 16, 1)
  if (!('moves' in asTodo)) throw new Error(asTodo.error)
  assert.ok(!asTodo.moves.some((m) => m.id === 'before'))
})

test('Moving an event from its card moves it and pushes the todos it now overlaps', () => {
  const event = block('dentist', 16, 17, { source: 'event', fixed: true })
  const items = [event, block('washer', 17, 18), block('later', 20, 21)]
  const plan = moveStartPlan(items, event, at(16, 30))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['dentist@16:30-17:30', 'washer@17:30-18:30'])
})

test('startTimeOptions runs every half hour from 6am to 1:30am', () => {
  const options = startTimeOptions()
  assert.equal(options[0], 6)
  assert.equal(options[options.length - 1], at(25, 30))
  assert.equal(options.length, 40)
  assert.ok(options.includes(23))
})

test('A habit set time after midnight is stored as a real time and read back as that night', () => {
  assert.equal(habitStartValue(23), '23:00:00')
  assert.equal(habitStartValue(at(25, 30)), '01:30:00')
  assert.equal(habitStartHours('23:00:00'), 23)
  assert.equal(habitStartHours('01:30:00'), at(25, 30))
  assert.equal(habitStartHours('06:00:00'), 6)
})

test('groupByDay groups events by day, newest day first and latest first within a day', () => {
  const rows = [
    { title: 'Theo: Open window', day: '2026-10-02', start: at(23, 30), end: at(23, 35) },
    { title: 'Cat Fight: Play', day: '2026-10-03', start: at(7, 37), end: at(7, 52) },
    { title: 'Theo: Open window', day: '2026-10-03', start: at(7, 26), end: at(7, 41) },
    { title: 'Cat Fight: Play', day: '2026-10-02', start: at(24, 10), end: at(24, 15) },
  ]
  const grouped = groupByDay(rows)
  assert.deepEqual(grouped.map((g) => g.day), ['2026-10-03', '2026-10-02'])
  assert.deepEqual(grouped[0].rows.map((r) => r.title), ['Cat Fight: Play', 'Theo: Open window'])
  assert.deepEqual(grouped[1].rows.map((r) => r.start), [at(24, 10), at(23, 30)])
})

test('nightBefore finds when the habit was done the night before each day', () => {
  const blocks = [
    // Friday's Shut down, done at 11:58pm
    { logical_day: '2026-10-02', done: true, done_at: new Date(2026, 9, 2, 23, 58).toISOString() },
    // Thursday's, done after midnight (12:40am Friday) - still Thursday night
    { logical_day: '2026-10-01', done: true, done_at: new Date(2026, 9, 2, 0, 40).toISOString() },
    // Wednesday's, never done
    { logical_day: '2026-09-30', done: false, done_at: null },
  ]
  assert.equal(nightBefore(blocks, '2026-10-03'), at(23, 58))
  assert.equal(nightBefore(blocks, '2026-10-02'), at(24, 40))
  assert.equal(nightBefore(blocks, '2026-10-01'), 'not done')
  assert.equal(nightBefore(blocks, '2026-09-30'), null) // no block that night
})

test('dayChoice turns Today, 1d and 3d into days counted from today', () => {
  assert.equal(dayChoice('today', DAY), DAY)
  assert.equal(dayChoice('1d', DAY), '2026-10-02')
  assert.equal(dayChoice('3d', DAY), '2026-10-04')
  assert.equal(dayChoice('1d', '2026-10-31'), '2026-11-01')
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

test('Start now can run past midnight but refuses to run past 2am', () => {
  const late = block('late', 22, at(23, 50))
  const plan = startNowPlan([late], late, at(22, 30))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['late@22:30-24:20'])
  const later = block('later', 24, at(25, 50))
  assert.ok('error' in startNowPlan([later], later, at(24, 30)))
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

test('Done now on a todo under way keeps its start and ends it now, moving later todos up', () => {
  const current = block('current', 15, 16)
  const plan = doneNowPlan([current, block('washer', 16, 17)], current, DAY, DAY, at(15, 20))
  assert.equal(plan.start, 15)
  assert.equal(plan.end, at(15, 20))
  assert.deepEqual(fmt(plan.moves), ['washer@15:20-16:20'])
})

test('Done now on a todo not started yet moves it to end now and pulls later todos into its slot', () => {
  const washer = block('washer', 20, 21)
  const items = [washer, block('skool', 21, at(21, 15), { source: 'habit', habitId: 'h1' })]
  const plan = doneNowPlan(items, washer, DAY, DAY, at(19, 27))
  assert.equal(plan.start, at(18, 27))
  assert.equal(plan.end, at(19, 27))
  assert.deepEqual(fmt(plan.moves), ['skool@20:00-20:15'])
})

test('Done now on a todo whose time has passed moves it to end now and leaves the rest alone', () => {
  const oven = block('oven', 15, at(15, 30))
  const plan = doneNowPlan([oven, block('washer', at(15, 30), 17)], oven, DAY, DAY, at(19, 27))
  assert.equal(plan.start, at(18, 57))
  assert.equal(plan.end, at(19, 27))
  assert.deepEqual(plan.moves, [])
})

test('Done now on a todo from another day lands it today ending now, never before 6am', () => {
  const yesterday = block('x', 19, 20)
  const plan = doneNowPlan([yesterday], yesterday, '2026-09-30', DAY, at(19, 27))
  assert.equal(plan.start, at(18, 27))
  assert.equal(plan.end, at(19, 27))
  assert.deepEqual(plan.moves, [])
  const early = doneNowPlan([yesterday], yesterday, '2026-09-30', DAY, at(6, 20))
  assert.equal(early.start, 6)
  assert.equal(early.end, at(6, 20))
})

test('A block done early does not count as taken when finding a gap', () => {
  const items = [block('gray', 16, 17, { done: true, doneEarly: true }), block('b', 17, 18)]
  assert.equal(freeSlot(items, 16, 1), 16)
  assert.equal(freeSlot(items, 16, 1.5), 18)
  assert.equal(freeSlot([block('gray', 16, 17, { done: true, doneEarly: true })], 16, 1), 16)
})

test('Done at the scheduled end stamps the end time and never counts as done early', () => {
  assert.deepEqual(doneAtEnd(DAY, at(22, 12), at(23, 12)), { done: true, done_at: dateAt(DAY, at(23, 12)).toISOString() })
  const stamp = doneAtEnd(DAY, at(22, 12), at(23, 12)).done_at
  assert.equal(isDoneEarly(true, stamp, DAY, at(22, 12)), false)
  // After midnight the stamp lands on the next date
  assert.equal(new Date(doneAtEnd(DAY, at(24, 30), at(25, 15)).done_at).getDate(), 2)
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

test('Not started can push the chain past midnight but refuses to run past 2am', () => {
  const carve = block('carve', 15, 16)
  const ok = notStartedPlan([carve, block('late', 23, at(23, 50))], carve, DAY, DAY, at(23, 0))
  if (!('moves' in ok)) throw new Error(ok.error)
  assert.deepEqual(fmt(ok.moves), ['carve@23:00-24:00', 'late@24:00-24:50'])
  assert.ok('error' in notStartedPlan([carve], carve, DAY, DAY, at(25, 30)))
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
  const pastMidnight = resizeItemPlan(items, washer, 120)
  if (!('moves' in pastMidnight)) throw new Error(pastMidnight.error)
  assert.deepEqual(fmt(pastMidnight.moves), ['washer@22:12-24:12', 'skool@24:12-24:27'])
  assert.ok('error' in resizeItemPlan(items, washer, 240))
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

test('Moving a block can go past midnight but refuses to run past 2am', () => {
  const a = block('a', 20, 21)
  const plan = moveStartPlan([a], a, at(23, 30))
  if (!('moves' in plan)) throw new Error(plan.error)
  assert.deepEqual(fmt(plan.moves), ['a@23:30-24:30'])
  assert.ok('error' in moveStartPlan([a], a, at(25, 30)))
})

test('The day runs 6am to 6am: before 6am it is still the night before', () => {
  assert.deepEqual(logicalNow(new Date(2026, 9, 2, 1, 30)), { day: '2026-10-01', hours: at(25, 30) })
  assert.deepEqual(logicalNow(new Date(2026, 9, 2, 6, 0)), { day: '2026-10-02', hours: 6 })
  assert.deepEqual(logicalNow(new Date(2026, 9, 1, 22, 15)), { day: '2026-10-01', hours: at(22, 15) })
})

test('Blocks after midnight are stored on the next date and read back onto the night before', () => {
  // 11pm to 1am crosses midnight: stored on its start date, end earlier than start
  assert.deepEqual(toStored(DAY, 23, 25), { day: DAY, start_time: '23:00:00', end_time: '01:00:00' })
  assert.deepEqual(fromStored(DAY, '23:00:00', '01:00:00'), { day: DAY, start: 23, end: 25 })
  // 12:30am to 1:15am starts after midnight: stored on the next date
  assert.deepEqual(toStored(DAY, at(24, 30), at(25, 15)), { day: '2026-10-02', start_time: '00:30:00', end_time: '01:15:00' })
  assert.deepEqual(fromStored('2026-10-02', '00:30:00', '01:15:00'), { day: DAY, start: at(24, 30), end: at(25, 15) })
  // Ending exactly at midnight
  assert.deepEqual(toStored(DAY, 23, 24), { day: DAY, start_time: '23:00:00', end_time: '00:00:00' })
  assert.deepEqual(fromStored(DAY, '23:00:00', '00:00:00'), { day: DAY, start: 23, end: 24 })
  // A normal daytime block is unchanged
  assert.deepEqual(fromStored(DAY, '15:00:00', '16:00:00'), { day: DAY, start: 15, end: 16 })
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
