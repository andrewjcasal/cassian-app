// Scheduling rules for the day: where blocks go when they're added, started,
// finished, skipped, resized or reordered. Everything here is pure (times are
// fractional hours, 13.5 = 1:30pm, and "now" is passed in) so it can be tested
// without the database or the screen. App.tsx saves and draws what these return.

export type CalItem = {
  id: string
  title: string
  start: number
  end: number
  kind: 'block' | 'task'
  done: boolean
  habitId?: string | null
  source?: string
  // Marked done before its start time
  doneEarly?: boolean
  // A set-time habit (Shut down at 11pm): no rule moves it
  fixed?: boolean
  // A routine step recorded under its parent block (Shut down); kept off the grid
  processId?: string | null
}

export type Todo = {
  id: string
  title: string
  day: string
  start: number
  end: number
  habit: boolean
  fixed?: boolean
  habitId?: string | null
}

export type Status = 'done' | 'not_started' | 'follow_up' | 'start_now'

// A block's new times
export type Move = { id: string; kind: 'block' | 'task'; start: number; end: number }

// New todos and follow-ups look for a gap from here
export const FILL_FROM_HOUR = 15
// "Anytime" habits (Skool replies, LinkedIn replies) can go as early as 8am
export const ANYTIME_FROM_HOUR = 8

// Lengths a todo can step through, in minutes
export const DURATION_STEPS = [5, 15, 30, 45, 60, 90, 120, 180, 240]

const EPS = 1e-6

// A day runs 6am to 6am, and blocks can be scheduled until 2am (hour 26)
export const DAY_START = 6
export const DAY_END = 26

// "13:30:00" -> 13.5
export function hoursOf(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h + m / 60
}

// 15.5 -> "15:30:00". Rounds on total minutes so 18.99999 can't become 18:60.
export function timeOf(hours: number) {
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

// 13.5 -> "1:30pm", 15 -> "3pm"
export function clock(hours: number) {
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  const suffix = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
}

export function toDayString(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function shiftDay(day: string, by: number) {
  const [y, m, d] = day.split('-').map(Number)
  return toDayString(new Date(y, m - 1, d + by))
}

// The local Date for an hour of a "YYYY-MM-DD" day
export function dateAt(day: string, hours: number) {
  const [y, m, d] = day.split('-').map(Number)
  const total = Math.round(hours * 60)
  return new Date(y, m - 1, d, Math.floor(total / 60), total % 60)
}

// Which day it is and how far into it, for a day that runs 6am to 6am: at 1:30am
// on the 2nd it's still the 1st, 25.5 hours in.
export function logicalNow(date: Date) {
  const hours = date.getHours() + date.getMinutes() / 60
  if (hours >= DAY_START) return { day: toDayString(date), hours }
  return { day: shiftDay(toDayString(date), -1), hours: hours + 24 }
}

// Blocks keep real calendar dates in the database, which can't hold an hour past
// 24. A block starting after midnight is stored on the next date; one crossing
// midnight is stored on its start date with an end earlier than its start.
export function toStored(day: string, start: number, end: number) {
  const next = start >= 24 - EPS
  return {
    day: next ? shiftDay(day, 1) : day,
    start_time: timeOf(next ? start - 24 : start),
    end_time: timeOf(end >= 24 - EPS ? end - 24 : end),
  }
}

// The reverse: a block stored before 6am belongs to the night before, and an end
// earlier than its start means it ran past midnight.
export function fromStored(storedDay: string, startTime: string, endTime: string | null) {
  let start = hoursOf(startTime)
  let end = endTime ? hoursOf(endTime) : start + 0.5
  let day = storedDay
  if (start < DAY_START - EPS) {
    day = shiftDay(storedDay, -1)
    start += 24
    end += 24
  } else if (end < start + EPS) {
    end += 24
  }
  return { day, start, end }
}

// The current time to the minute, as fractional hours
export function minuteOf(now: number) {
  return Math.floor(now * 60) / 60
}

export function nextQuarter(now: number) {
  return Math.ceil(now * 4) / 4
}

// "Done at <end time>": marks a block done exactly as scheduled, stamped at its
// end so it reads as done on time. Nothing else moves.
export function doneAtEnd(day: string, start: number, end: number) {
  return { done: true, done_at: dateAt(day, Math.max(end, start)).toISOString() }
}

export function isDoneEarly(done: boolean, doneAt: string | null | undefined, day: string, start: number) {
  return !!(done && doneAt && new Date(doneAt) < dateAt(day, start))
}

// Later blocks a change to `item` carries along: the day's todos, follow-ups and
// habits that aren't done, starting at or after `from`. Older calendar blocks and
// tasks stay put.
function carried(items: CalItem[], item: CalItem, from: number) {
  return items.filter(
    (it) =>
      it.id !== item.id &&
      it.kind === 'block' &&
      !it.done &&
      !it.fixed &&
      (it.source === 'app' || it.source === 'habit') &&
      it.start >= from - EPS,
  )
}

const shift = (it: { id: string; kind: 'block' | 'task'; start: number; end: number }, by: number): Move => ({
  id: it.id,
  kind: it.kind,
  start: it.start + by,
  end: it.end + by,
})

// The first gap at or after `from` that fits `length` hours between the day's
// blocks, or null if nothing fits before 2am. A block done early has given
// its slot back, so it doesn't count as taken.
export function freeSlot(items: CalItem[], from: number, length: number) {
  let cursor = from
  for (const it of [...items].filter((x) => !x.doneEarly).sort((a, b) => a.start - b.start)) {
    if (it.end <= cursor) continue
    if (it.start - cursor >= length - EPS) return cursor
    cursor = Math.max(cursor, it.end)
  }
  return cursor + length <= DAY_END + EPS ? cursor : null
}

// Where a new todo or follow-up of `length` hours starts: the first gap that fits
// it, looking from 3pm, or from the next quarter hour today if that's later. Null
// if nothing fits before 2am.
export function newBlockStart(items: CalItem[], length: number, isToday: boolean, now: number) {
  const from = isToday ? Math.max(FILL_FROM_HOUR, nextQuarter(now)) : FILL_FROM_HOUR
  return freeSlot(items, from, length)
}

// Where habits start looking for a gap: today from the next quarter hour, an
// upcoming day from 3pm (like new todos). A past day gets no habits (null).
export function habitSearchFrom(day: string, today: string, now: number) {
  if (day < today) return null
  return day === today ? nextQuarter(now) : FILL_FROM_HOUR
}

// The same for an anytime habit: from 8am, or today from the next quarter hour
// once it's past 8am. A past day gets none (null).
export function anytimeSearchFrom(day: string, today: string, now: number) {
  if (day < today) return null
  return day === today ? Math.max(ANYTIME_FROM_HOUR, nextQuarter(now)) : ANYTIME_FROM_HOUR
}

// 0 = Sunday ... 6 = Saturday for a "YYYY-MM-DD" day
export function weekdayOf(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

// The Sunday that starts a day's week
export function weekStart(day: string) {
  return shiftDay(day, -weekdayOf(day))
}

// The habits that land on a day: daily ones every day; weekly ones only on their
// weekday (not at all until one is picked), and not if that week already has one
// on another day (moved there with the Date row).
export function habitsForDay<H extends { id: string; frequency: 'daily' | 'weekly'; weekday: number | null }>(
  habits: H[],
  day: string,
  // habit_week: the week a block was placed for, kept when it's moved to another day
  weekBlocks: { habit_id: string; logical_day: string; habit_week?: string | null }[] = [],
) {
  const week = weekStart(day)
  return habits.filter((h) => {
    if (h.frequency === 'daily') return true
    if (h.weekday === null || h.weekday !== weekdayOf(day)) return false
    return !weekBlocks.some((b) => b.habit_id === h.id && (b.habit_week ?? weekStart(b.logical_day)) === week)
  })
}

// A habit's history, one row per day from its first block through today, newest
// first. A done day carries when it started and how long it took. A day the app
// never placed it counts as not done; today is pending until it's done; upcoming
// days are left off.
export type HabitDay =
  | { day: string; status: 'done'; start: number; minutes: number }
  | { day: string; status: 'missed' | 'pending' }

export function habitHistory(
  rows: { logical_day: string; done: boolean; start: number; end: number; habit_week?: string | null }[],
  today: string,
  // A weekly habit's weekday (0 = Sunday): only those days are listed
  weekday: number | null = null,
): HabitDay[] {
  const byDay = new Map<string, { start: number; end: number } | null>()
  for (const r of rows) {
    if (r.logical_day > today) continue
    const prev = byDay.get(r.logical_day)
    if (r.done) byDay.set(r.logical_day, { start: r.start, end: r.end })
    else if (prev === undefined) byDay.set(r.logical_day, null)
  }
  const days = [...byDay.keys()].sort()
  if (!days.length) return []
  const out: HabitDay[] = []
  // A weekly habit: one row per week (labeled by its Sunday), done if any day was
  // grouped by the week each block was placed for (habit_week), kept when moved
  if (weekday !== null) {
    const weekOf = (r: (typeof rows)[number]) => r.habit_week ?? weekStart(r.logical_day)
    const past = rows.filter((r) => r.logical_day <= today)
    const first = past.map(weekOf).sort()[0]
    for (let w = weekStart(today); w >= first; w = shiftDay(w, -7)) {
      const t = past.find((r) => r.done && weekOf(r) === w)
      if (t) out.push({ day: w, status: 'done', start: t.start, minutes: Math.round((t.end - t.start) * 60) })
      else out.push({ day: w, status: w === weekStart(today) ? 'pending' : 'missed' })
    }
    return out
  }
  for (let d = today; d >= days[0]; d = shiftDay(d, -1)) {
    const done = byDay.get(d)
    if (done) out.push({ day: d, status: 'done', start: done.start, minutes: Math.round((done.end - done.start) * 60) })
    else out.push({ day: d, status: d === today ? 'pending' : 'missed' })
  }
  return out
}

// Every habit without a block on the day yet goes into the first gap that fits
// it, looking from `from`, or from `anytimeFrom` for an anytime habit. Each
// placement counts as taken for the next.
export function placeHabits(
  items: CalItem[],
  // `start` is a set time of day (hours) for habits like Shut down at 11pm
  habits: { id: string; title: string; minutes: number; start?: number | null; anytime?: boolean }[],
  from: number,
  anytimeFrom: number = from,
) {
  const placed = new Set(items.map((it) => it.habitId).filter(Boolean))
  const occupied = [...items]
  const out: { habitId: string; title: string; start: number; end: number }[] = []
  // Set-time habits go first, at their time even if it has passed, so the rest
  // fill the gaps around them; then anytime ones, so they take the morning
  const floating = habits.filter((h) => h.start == null)
  const ordered = [...habits.filter((h) => h.start != null), ...floating.filter((h) => h.anytime), ...floating.filter((h) => !h.anytime)]
  for (const h of ordered) {
    if (placed.has(h.id)) continue
    const length = h.minutes / 60
    const start = h.start != null ? h.start : freeSlot(occupied, h.anytime ? anytimeFrom : from, length)
    if (start === null || start + length > DAY_END + EPS) continue
    out.push({ habitId: h.id, title: h.title, start, end: start + length })
    occupied.push({ id: h.id, title: h.title, start, end: start + length, kind: 'block', done: false, habitId: h.id })
  }
  return out
}

// Start now moves the block to start this minute, and carries later blocks down by
// the same amount. Nothing to do if the block hasn't reached its start yet.
export function startNowPlan(items: CalItem[], item: CalItem, now: number): { moves: Move[] } | { error: string } {
  const delta = minuteOf(now) - item.start
  if (delta <= 0) return { moves: [] }
  const later = carried(items, item, item.start)
  if (Math.max(item.end, ...later.map((it) => it.end)) + delta > DAY_END + EPS) return { error: 'That runs past 2am' }
  return { moves: [item, ...later].map((it) => shift(it, delta)) }
}

// Done frees whatever is left of a block's slot, and the todos and habits after
// it move up by that much so the chain stays back to back:
// - under way (from its start minute): it ends this minute
// - not started yet (later today, or a later day): it keeps its times, renders as
//   done early beside the todos that move up into its slot
// - already over: nothing moves
export function donePlan(items: CalItem[], item: CalItem, day: string, today: string, now: number) {
  const at = minuteOf(now)
  const isToday = day === today
  const underWay = isToday && item.start <= at && at < item.end
  const notStarted = day > today || (isToday && at < item.start)
  if (underWay) {
    const delta = at - item.end
    return { endAt: at as number | null, moves: carried(items, item, item.end).map((it) => shift(it, delta)) }
  }
  if (notStarted) {
    const delta = item.start - item.end
    return { endAt: null as number | null, moves: carried(items, item, item.end).map((it) => shift(it, delta)) }
  }
  return { endAt: null as number | null, moves: [] as Move[] }
}

// Done now from the card: the todo or habit ends now. One under way keeps its
// start; one not started yet, already past, or on another day moves so it ends
// now at its own length (never before 6am), landing on today. A not started one
// today frees its slot, so the later todos and habits move up into it.
export function doneNowPlan(items: CalItem[], item: CalItem, day: string, today: string, now: number) {
  const at = minuteOf(now)
  const length = item.end - item.start
  const endingNow = { start: Math.max(DAY_START, at - length), end: at }
  if (day !== today) return { ...endingNow, moves: [] as Move[] }
  if (item.start <= at && at < item.end) {
    return { start: item.start, end: at, moves: carried(items, item, item.end).map((it) => shift(it, at - item.end)) }
  }
  if (at < item.start) {
    return { ...endingNow, moves: carried(items, item, item.end).map((it) => shift(it, -length)) }
  }
  return { ...endingNow, moves: [] as Move[] }
}

// Not started, today: the block starts now, and every todo and habit that isn't
// done and hasn't finished (including one under way) re-packs back to back after
// it in its current order, each keeping its length. On an earlier day there's no
// "now", so the block moves to after that day's last other block.
export function notStartedPlan(
  items: CalItem[],
  item: CalItem,
  day: string,
  today: string,
  now: number,
): { moves: Move[] } | { error: string } {
  const length = item.end - item.start
  if (day !== today) {
    const start = Math.max(item.start, ...items.filter((it) => it.id !== item.id).map((it) => it.end))
    if (start + length > DAY_END + EPS) return { error: 'No room left that day to move that block' }
    return { moves: [{ id: item.id, kind: item.kind, start, end: start + length }] }
  }
  const at = minuteOf(now)
  const rest = items
    .filter(
      (it) =>
        it.id !== item.id &&
        it.kind === 'block' &&
        !it.done &&
        !it.fixed &&
        (it.source === 'app' || it.source === 'habit') &&
        it.end > at + EPS,
    )
    .sort((a, b) => a.start - b.start)
  const moves: Move[] = []
  let cursor = at
  for (const it of [item, ...rest]) {
    const len = it.end - it.start
    moves.push({ id: it.id, kind: it.kind, start: cursor, end: cursor + len })
    cursor += len
  }
  if (cursor > DAY_END + EPS) return { error: 'That runs past 2am' }
  return { moves }
}

// What happens after a block's end moves from `oldEnd` to `newEnd`. Longer: later
// blocks are pushed only as far as needed to stop overlapping, so a block after a
// gap stays put. Shorter: only the back to back run right after it moves up.
function followOn(later: Move[], oldEnd: number, newEnd: number): Move[] {
  if (newEnd > oldEnd) return pushFrom(later, newEnd)
  const sorted = [...later].sort((a, b) => a.start - b.start)
  const moves: Move[] = []
  const delta = newEnd - oldEnd
  let cursor = oldEnd
  for (const it of sorted) {
    if (Math.abs(it.start - cursor) > EPS) break
    moves.push(shift(it, delta))
    cursor = it.end
  }
  return moves
}

// Pushes blocks that start before `end` to follow on from it, back to back,
// stopping at the first block that already clears it.
function pushFrom(later: Move[], end: number): Move[] {
  const moves: Move[] = []
  let cursor = end
  for (const it of [...later].sort((a, b) => a.start - b.start)) {
    if (it.start >= cursor - EPS) break
    const length = it.end - it.start
    moves.push({ ...it, start: cursor, end: cursor + length })
    cursor += length
  }
  return moves
}

// Something that interrupts the day (a Help option): it starts this minute, and
// the todos and habits not finished yet, including one under way, are pushed to
// follow it as far as they overlap. Older calendar blocks stay put.
export function interruptPlan(
  items: CalItem[],
  now: number,
  length: number,
): { start: number; end: number; moves: Move[] } | { error: string } {
  const start = minuteOf(now)
  const end = start + length
  const rest = items
    .filter(
      (it) => it.kind === 'block' && !it.done && !it.fixed && (it.source === 'app' || it.source === 'habit') && it.end > start + EPS,
    )
    .map((it): Move => ({ id: it.id, kind: it.kind, start: it.start, end: it.end }))
  const moves = pushFrom(rest, end)
  if (Math.max(end, ...moves.map((m) => m.end)) > DAY_END + EPS) return { error: 'That runs past 2am' }
  return { start, end, moves }
}

// A tapped time on the agenda, rounded to the nearest quarter hour
export function quarterOf(hours: number) {
  return Math.round(hours * 4) / 4
}

// A new todo put at a tapped time: the todos and habits starting from there on
// are pushed along after it as far as they overlap. Ones before it, fixed habits
// and older calendar blocks stay put. An event (evictOverlap) also pushes off a
// todo or habit that started earlier and runs into it.
export function insertAtPlan(
  items: CalItem[],
  start: number,
  length: number,
  { evictOverlap = false }: { evictOverlap?: boolean } = {},
): { start: number; end: number; moves: Move[] } | { error: string } {
  const end = start + length
  const later = items
    .filter(
      (it) =>
        it.kind === 'block' &&
        !it.done &&
        !it.fixed &&
        (it.source === 'app' || it.source === 'habit') &&
        (evictOverlap ? it.end > start + EPS : it.start >= start - EPS),
    )
    .map((it): Move => ({ id: it.id, kind: it.kind, start: it.start, end: it.end }))
  const moves = pushFrom(later, end)
  if (Math.max(end, ...moves.map((m) => m.end)) > DAY_END + EPS) return { error: 'That runs past 2am' }
  return { start, end, moves }
}

// A block moved to start at `newStart`, same length. Blocks it now overlaps from
// there on are pushed along after it; blocks before it, and blocks after a gap,
// stay put.
function moveWith(target: Move, others: Move[], newStart: number): { moves: Move[] } | { error: string } {
  if (Math.abs(newStart - target.start) < EPS) return { moves: [] }
  const length = target.end - target.start
  const moved = { ...target, start: newStart, end: newStart + length }
  const moves = [moved, ...pushFrom(others.filter((o) => o.start >= newStart - EPS), moved.end)]
  if (Math.max(...moves.map((m) => m.end)) > DAY_END + EPS) return { error: 'That runs past 2am' }
  return { moves }
}

export function moveStartPlan(items: CalItem[], item: CalItem, newStart: number) {
  const others = carried(items, item, 0).map((it): Move => ({ id: it.id, kind: it.kind, start: it.start, end: it.end }))
  return moveWith({ id: item.id, kind: item.kind, start: item.start, end: item.end }, others, newStart)
}

export function moveTodoStartPlan(todos: Todo[], todo: Todo, newStart: number) {
  const others = todos
    .filter((t) => t.day === todo.day && t.id !== todo.id && !t.fixed)
    .map((t): Move => ({ id: t.id, kind: 'block', start: t.start, end: t.end }))
  return moveWith({ id: todo.id, kind: 'block', start: todo.start, end: todo.end }, others, newStart)
}

function resizeWith(target: Move, later: Move[], minutes: number): { moves: Move[] } | { error: string } {
  const newEnd = target.start + minutes / 60
  if (Math.abs(newEnd - target.end) < EPS) return { moves: [] }
  const moves = [{ ...target, end: newEnd }, ...followOn(later, target.end, newEnd)]
  if (Math.max(...moves.map((m) => m.end)) > DAY_END + EPS) return { error: 'That runs past 2am' }
  return { moves }
}

// A new length for a block on the calendar. The todos and habits after it follow
// the push and pull rules above.
export function resizeItemPlan(items: CalItem[], item: CalItem, minutes: number): { moves: Move[] } | { error: string } {
  const later = carried(items, item, item.end).map((it) => ({ id: it.id, kind: it.kind, start: it.start, end: it.end }))
  return resizeWith({ id: item.id, kind: item.kind, start: item.start, end: item.end }, later, minutes)
}

// The same from the Todos tab, against that day's todos.
export function resizePlan(todos: Todo[], todo: Todo, minutes: number): { moves: Move[] } | { error: string } {
  const later = todos
    .filter((t) => t.day === todo.day && t.id !== todo.id && !t.fixed && t.start >= todo.end - EPS)
    .map((t): Move => ({ id: t.id, kind: 'block', start: t.start, end: t.end }))
  return resizeWith({ id: todo.id, kind: 'block', start: todo.start, end: todo.end }, later, minutes)
}

// After a drag, the todos whose order changed, per day, laid back to back from
// where the first of them started. Todos outside the changed range keep their times.
export function relayout(allBefore: Todo[], allAfter: Todo[]) {
  // Fixed todos keep their times, so only the others are laid out
  const before = allBefore.filter((t) => !t.fixed)
  const after = allAfter.filter((t) => !t.fixed)
  const updates: { id: string; start: number; end: number }[] = []
  for (const day of new Set(before.map((t) => t.day))) {
    const old = before.filter((t) => t.day === day)
    const next = after.filter((t) => t.day === day)
    let i = 0
    while (i < old.length && old[i].id === next[i].id) i++
    if (i === old.length) continue
    let j = old.length - 1
    while (j > i && old[j].id === next[j].id) j--
    let cursor = old[i].start
    for (const t of next.slice(i, j + 1)) {
      const length = t.end - t.start
      if (Math.abs(t.start - cursor) > EPS) updates.push({ id: t.id, start: cursor, end: cursor + length })
      cursor += length
    }
  }
  return updates
}

// The block menu. A fixed block never offers Start now or Not started. Done
// hides once a block is done. Start now shows only while a
// block is under way; once it has ended, Not started covers it. Not started
// shows only once its end has passed (any earlier day counts). Add follow-up
// hides while the block is under way.
export function menuOptions(item: CalItem, day: string, today: string, now: number) {
  // An event is an appointment: no done state, no follow-up, never moved
  if (item.source === 'event') return []
  const isToday = day === today
  const inProgress = isToday && item.start <= now && now < item.end
  const ended = day < today || (isToday && item.end <= now)
  const options: [Status, string][] = []
  if (!item.fixed && inProgress && !item.done && item.start < minuteOf(now)) options.push(['start_now', 'Start now'])
  if (!item.done) options.push(['done', 'Done'])
  if (ended && !item.fixed) options.push(['not_started', 'Not started'])
  if (!inProgress) options.push(['follow_up', 'Add follow-up'])
  return options
}

// The current length with the next shorter step to its left and the next longer
// step to its right (30 -> 15, 30, 45; 15 -> 5, 15, 30).
export function durationOptions(minutes: number) {
  const shorter = [...DURATION_STEPS].reverse().find((m) => m < minutes)
  const longer = DURATION_STEPS.find((m) => m > minutes)
  return [shorter, minutes, longer].filter((m): m is number => m !== undefined)
}

// Which blocks render at half width, and on which side. Blocks under 30 minutes
// and blocks done early take half. A block that a half block's minimum height
// spills into takes the other half. `top` maps an hour to pixels; `items` must be
// sorted by start.
export function halfSides(items: CalItem[], top: (hours: number) => number, minPx: number) {
  const side = new Map<string, 'left' | 'right'>()
  let prev = null as { bottom: number; side: 'left' | 'right' } | null
  for (const it of items) {
    const t = top(it.start) + 1
    const overlapsPrev = prev !== null && prev.bottom > t
    if (it.end - it.start >= 0.5 && !it.doneEarly && !overlapsPrev) continue
    const s: 'left' | 'right' = overlapsPrev && prev?.side === 'left' ? 'right' : 'left'
    side.set(it.id, s)
    prev = { bottom: Math.max(t + minPx, top(it.end) - 1), side: s }
  }
  return side
}

// A routine is a run of timed steps (the Shut down habit's Dishwasher, Empty sink,
// Wet food, then Puzzles). A step with no minutes counts up until it's ended.
// afterChores marks the step that comes after the chores (Puzzles): reaching it
// means the habit is done
export type RoutineStep = { name: string; minutes: number | null; oneOff?: boolean; afterChores?: boolean }

// Starting from a picked step runs that step and every one after it
export function routineFrom(steps: RoutineStep[], start: string) {
  const i = steps.findIndex((s) => s.name === start)
  return i === -1 ? [] : steps.slice(i)
}

// Where the timer is now: moves past every step whose time has run out (several
// at once if the phone was locked), then reports the time left in the current
// step, or null for a step that counts up. Times are milliseconds.
export function advanceTimer(steps: RoutineStep[], index: number, stepStartedAt: number, now: number) {
  let i = index
  let startedAt = stepStartedAt
  while (i < steps.length - 1) {
    const minutes = steps[i].minutes
    if (minutes === null) break
    const endsAt = startedAt + minutes * 60_000
    if (now < endsAt) break
    startedAt = endsAt
    i++
  }
  const minutes = steps[i].minutes
  const elapsedMs = now - startedAt
  return {
    index: i,
    stepStartedAt: startedAt,
    remainingMs: minutes === null ? null : Math.max(0, minutes * 60_000 - elapsedMs),
    elapsedMs,
  }
}

// Resuming a paused timer: the step's start moves later by however long it was
// paused, so the paused stretch doesn't count against the step
export function resumeTimer(stepStartedAt: number, pausedAt: number, now: number) {
  return stepStartedAt + (now - pausedAt)
}

// How long a typed one-off counts down from
export const ONE_OFF_MINUTES = 5

// Switch! during a routine. Picking one of the routine's steps jumps to it and
// runs on from there. A one-off (something typed in, like a missed todo) starts
// now, counting down from 5 minutes, then goes back to the step it interrupted,
// from the top.
// A one-off exists for this run only.
export function switchRoutine(
  routine: RoutineStep[],
  running: RoutineStep[],
  index: number,
  choice: { step: string } | { oneOff: string },
): RoutineStep[] {
  if ('step' in choice) return routineFrom(routine, choice.step)
  return [{ name: choice.oneOff, minutes: ONE_OFF_MINUTES, oneOff: true }, ...running.slice(index).filter((s) => !s.oneOff)]
}

// +1 min on the step counting down: its start moves a minute later, so a minute
// more is left
export function extendStep(stepStartedAt: number, minutes: number) {
  return stepStartedAt + minutes * 60_000
}

// A day swipe on the agenda: at least 60px sideways and mostly sideways (twice as
// far across as down), so a scroll never changes the day. Left is the next day.
export const SWIPE_MIN_PX = 60
export function swipeDays(dx: number, dy: number) {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return 0
  return dx < 0 ? 1 : -1
}

// Set start times a habit can pick: every half hour from 6am (the day's start)
// to 1:30am, the last that still fits before the 2am end
export function startTimeOptions() {
  const out: number[] = []
  for (let h = DAY_START; h <= DAY_END - 0.5 + EPS; h += 0.5) out.push(h)
  return out
}

// A habit's set time as stored ("01:30:00" for 1:30am) and as hours into its
// 6am to 6am day (25.5): a time before 6am is after midnight of that night
export function habitStartValue(hours: number) {
  return timeOf(hours >= 24 - EPS ? hours - 24 : hours)
}
export function habitStartHours(time: string) {
  const h = hoursOf(time)
  return h < DAY_START - EPS ? h + 24 : h
}

// Rows grouped by their 6am to 6am day, newest day first, latest first within a day
export function groupByDay<R extends { day: string; start: number }>(rows: R[]) {
  const days = new Map<string, R[]>()
  for (const r of rows) days.set(r.day, [...(days.get(r.day) ?? []), r])
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => ({ day, rows: [...list].sort((x, y) => y.start - x.start) }))
}

// When a habit was done the night before a day, as hours into that night (an
// after-midnight finish reads past 24), 'not done' if its block wasn't, or null
// if it had no block that night
export function nightBefore(
  blocks: { logical_day: string; done: boolean; done_at: string | null }[],
  day: string,
): number | 'not done' | null {
  const night = shiftDay(day, -1)
  const block = blocks.find((b) => b.logical_day === night)
  if (!block) return null
  if (!block.done || !block.done_at) return 'not done'
  const at = logicalNow(new Date(block.done_at))
  return at.day === night ? at.hours : at.hours + 24
}

// The Date row's quick picks on a todo card, counted from today
export function dayChoice(choice: 'today' | '1d' | '3d', today: string) {
  return choice === 'today' ? today : shiftDay(today, choice === '1d' ? 1 : 3)
}
