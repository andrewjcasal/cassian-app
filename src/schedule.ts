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
}

export type Todo = { id: string; title: string; day: string; start: number; end: number; habit: boolean }

export type Status = 'done' | 'not_started' | 'follow_up' | 'start_now'

// A block's new times
export type Move = { id: string; kind: 'block' | 'task'; start: number; end: number }

// New todos and follow-ups look for a gap from here
export const FILL_FROM_HOUR = 15

// Lengths a todo can step through, in minutes
export const DURATION_STEPS = [5, 15, 30, 45, 60, 90, 120, 180, 240]

const EPS = 1e-6

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

// The current time to the minute, as fractional hours
export function minuteOf(now: number) {
  return Math.floor(now * 60) / 60
}

export function nextQuarter(now: number) {
  return Math.ceil(now * 4) / 4
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
// blocks, or null if nothing fits before midnight.
export function freeSlot(items: CalItem[], from: number, length: number) {
  let cursor = from
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    if (it.end <= cursor) continue
    if (it.start - cursor >= length - EPS) return cursor
    cursor = Math.max(cursor, it.end)
  }
  return cursor + length <= 24 + EPS ? cursor : null
}

// Where a new todo or follow-up of `length` hours starts: the first gap that fits
// it, looking from 3pm, or from the next quarter hour today if that's later. Null
// if nothing fits before midnight.
export function newBlockStart(items: CalItem[], length: number, isToday: boolean, now: number) {
  const from = isToday ? Math.max(FILL_FROM_HOUR, nextQuarter(now)) : FILL_FROM_HOUR
  return freeSlot(items, from, length)
}

// Today, every habit without a block yet goes into the first gap that fits it,
// starting from the next quarter hour. Each placement counts as taken for the next.
export function placeHabits(
  items: CalItem[],
  habits: { id: string; title: string; minutes: number }[],
  now: number,
) {
  const placed = new Set(items.map((it) => it.habitId).filter(Boolean))
  const occupied = [...items]
  const out: { habitId: string; title: string; start: number; end: number }[] = []
  for (const h of habits) {
    if (placed.has(h.id)) continue
    const length = h.minutes / 60
    const start = freeSlot(occupied, nextQuarter(now), length)
    if (start === null) continue
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
  if (Math.max(item.end, ...later.map((it) => it.end)) + delta > 24 + EPS) return { error: 'That runs past midnight' }
  return { moves: [item, ...later].map((it) => shift(it, delta)) }
}

// Done on a block under way ends it this minute and carries later blocks up by the
// freed time. Done on any other block leaves the schedule alone.
export function donePlan(items: CalItem[], item: CalItem, isToday: boolean, now: number) {
  const at = minuteOf(now)
  // Under way from its start minute, so Done right at the start still frees the slot
  const underWay = isToday && item.start <= at && at < item.end
  if (!underWay) return { endAt: null as number | null, moves: [] as Move[] }
  const delta = at - item.end
  return { endAt: at as number | null, moves: carried(items, item, item.end).map((it) => shift(it, delta)) }
}

// Not started moves the block, same length. A habit goes into the next gap that
// fits after it; anything else goes after the day's last other block. Today,
// never earlier than the next quarter hour.
export function notStartedPlan(
  items: CalItem[],
  item: CalItem,
  isToday: boolean,
  now: number,
): { start: number; end: number } | { error: string } {
  const length = item.end - item.start
  const others = items.filter((it) => it.id !== item.id)
  if (item.habitId) {
    const start = freeSlot(others, isToday ? Math.max(item.end, nextQuarter(now)) : item.end, length)
    return start === null ? { error: 'No gap left today for that habit' } : { start, end: start + length }
  }
  const lastEnd = Math.max(item.start, ...others.map((it) => it.end))
  const start = isToday ? Math.max(lastEnd, nextQuarter(now)) : lastEnd
  if (start + length > 24 + EPS) return { error: 'No room left today to move that block' }
  return { start, end: start + length }
}

// A new length moves this todo's end, and the same day's later todos shift by the
// same amount so the chain stays back to back.
export function resizePlan(todos: Todo[], todo: Todo, minutes: number): { moves: Move[] } | { error: string } {
  const delta = todo.start + minutes / 60 - todo.end
  if (Math.abs(delta) < EPS) return { moves: [] }
  const later = todos.filter((t) => t.day === todo.day && t.id !== todo.id && t.start >= todo.end - EPS)
  if (Math.max(todo.end, ...later.map((t) => t.end)) + delta > 24 + EPS) return { error: 'That runs past midnight' }
  return {
    moves: [
      { id: todo.id, kind: 'block', start: todo.start, end: todo.end + delta },
      ...later.map((t) => shift({ ...t, kind: 'block' }, delta)),
    ],
  }
}

// After a drag, the todos whose order changed, per day, laid back to back from
// where the first of them started. Todos outside the changed range keep their times.
export function relayout(before: Todo[], after: Todo[]) {
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

// The block menu. Start now shows once a block's start has passed today. Not
// started shows only once its end has passed (any earlier day counts). Add
// follow-up hides while the block is under way.
export function menuOptions(item: CalItem, day: string, today: string, now: number) {
  const isToday = day === today
  const inProgress = isToday && item.start <= now && now < item.end
  const ended = day < today || (isToday && item.end <= now)
  const options: [Status, string][] = []
  if (isToday && !item.done && item.start < minuteOf(now)) options.push(['start_now', 'Start now'])
  options.push(['done', 'Done'])
  if (ended) options.push(['not_started', 'Not started'])
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
