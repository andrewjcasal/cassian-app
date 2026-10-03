import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  type PanResponderInstance,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import type { Session } from '@supabase/supabase-js'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  Clock,
  GripVertical,
  ListTodo,
  LogOut,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Settings,
  X,
} from 'lucide-react-native'
import Slider from '@react-native-community/slider'
import { supabase } from './src/supabase'
import {
  type CalItem,
  type Move,
  type Status,
  type Todo,
  clock,
  doneAtEnd,
  donePlan,
  durationOptions,
  newBlockStart,
  halfSides,
  DAY_END,
  DAY_START,
  fromStored,
  hoursOf,
  logicalNow,
  toStored,
  isDoneEarly,
  menuOptions,
  moveStartPlan,
  moveTodoStartPlan,
  notStartedPlan,
  advanceTimer,
  extendStep,
  habitHistory,
  resumeTimer,
  routineFrom,
  swipeDays,
  switchRoutine,
  type RoutineStep,
  insertAtPlan,
  interruptPlan,
  habitsForDay,
  habitSearchFrom,
  placeHabits,
  quarterOf,
  relayout,
  resizeItemPlan,
  resizePlan,
  shiftDay,
  startNowPlan,
  timeOf,
} from './src/schedule'

const HOUR_PX = 80
const FIRST_HOUR = 6
const EVENT_LEFT = 52
// Cards stop this far from the right; tapping that strip adds a todo at that time
const EVENT_RIGHT = 30
// A short block is at least this tall so its title stays readable
const SHORT_MIN_PX = 20
// Today's grid shows this many hours before and after now
const LOOKBACK_HOURS = 3
const LOOKAHEAD_HOURS = 5
// The agenda runs to 2am (hour 26); scheduling itself still stops at midnight
const LAST_HOUR = 26

const c = {
  bg: '#fafaf7',
  card: '#ffffff',
  ink: '#1c1c1a',
  muted: '#5a5a55',
  line: '#e4e2dc',
  accent: '#2f5d50',
  block: '#e6efe9',
  blockDone: '#4ade80',
  doneEarly: '#4a4a48',
  onDark: '#ffffff',
  onDarkMuted: '#e4e2dc',
  task: '#efe9df',
  now: '#c0392b',
}

function dayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

// Whether a block's linked habit (the embedded cass_habits row) has a set time.
// Without generated types the client calls it a list; for one habit per block the
// API sends one object, so this accepts either.
function hasSetTime(habit: unknown) {
  const row = (Array.isArray(habit) ? habit[0] : habit) as { start_time?: string | null } | null | undefined
  return !!row?.start_time
}

// How far into today we are; before 6am that's 24 plus the hour (see logicalNow)
function nowHours() {
  return logicalNow(new Date()).hours
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen}>
        {!ready ? <ActivityIndicator style={{ marginTop: 40 }} /> : session ? <DayPage /> : <SignIn />}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

function SignIn() {
  const [email, setEmail] = useState('andrewjcasal@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.signIn}>
      <Text style={styles.title}>Cassian</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor={c.muted}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor={c.muted}
        onSubmitEditing={submit}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  )
}

type Tab = 'todos' | 'agenda' | 'planning' | 'help'
// A todo is a block added from this app, or a placed habit, that isn't done yet, on any day
type Menu = { item: CalItem; x: number; y: number }
// What the tap-to-open card shows. It keeps only the id, and a new length is
// saved against the current todo or block, never a copy from when it opened.
type Detail = {
  id: string
  from: 'todo' | 'item'
  title: string
  day: string
  start: number
  end: number
  done: boolean
  // A set-time habit: the card shows its time in place of the start slider
  fixed: boolean
}

function DayPage() {
  const today = logicalNow(new Date()).day
  const [day, setDay] = useState(today)
  const [tab, setTab] = useState<Tab>('agenda')
  // Every day's blocks and todos once loaded, so switching to a day shows it at
  // once while a refresh runs behind it. A day not loaded yet shows empty, never
  // another day's blocks.
  const [byDay, setByDay] = useState<Record<string, { items: CalItem[]; todos: Todo[] }>>({})
  const items = byDay[day]?.items ?? []
  const todos = byDay[day]?.todos ?? []
  // Per day, only the latest load may write, so a slow older response can't land
  // on top of a newer one
  const loadRuns = useRef(new Map<string, number>())
  // Days already fetched at least once, so neighbors are prefetched only once
  const fetchedDays = useRef(new Set<string>())
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  // Swiping sideways on the agenda moves a day (swipeDays: left is the next day).
  // It only claims a gesture that's clearly sideways, so scrolling still works.
  const daySwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > 2 * Math.abs(g.dy),
      onPanResponderRelease: (_e, g) => {
        const by = swipeDays(g.dx, g.dy)
        if (by) setDay((d) => shiftDay(d, by))
      },
    }),
  ).current
  // The time tapped in the agenda's right strip, for a new todo there
  const [addAt, setAddAt] = useState<number | null>(null)
  // The routine timer that's running, if any (full page)
  const [routine, setRoutine] = useState<{ detail: Detail; steps: RoutineStep[]; index: number; stepStartedAt: number } | null>(null)
  // A routine block's recorded steps, shown on its card under the done buttons
  const [detailParts, setDetailParts] = useState<{ id: string; title: string; start: number; end: number }[]>([])
  const [dragging, setDragging] = useState(false)
  // Where the settings icon was tapped, so its menu opens beside it
  const [settingsMenu, setSettingsMenu] = useState<{ x: number; y: number } | null>(null)
  // Only pull to refresh shows the spinner; every other load happens quietly
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { width } = useWindowDimensions()

  // A day's blocks and timed tasks. The day runs 6am to 6am: that date from 6am
  // on, plus the next date before 6am.
  const fetchDayItems = useCallback(async (day: string) => {
    const next = shiftDay(day, 1)
    const morning = timeOf(DAY_START)
    // cass_habits(start_time) says whether the block's habit has a set time (fixed)
    const blockCols = 'id,title,day,start_time,end_time,done,habit_id,source,done_at,process_id,cass_habits(start_time)'
    const taskCols = 'id,title,day,start_time,end_time,done'
    const [blockRes, lateBlockRes, taskRes, lateTaskRes] = await Promise.all([
      supabase.from('cass_time_blocks').select(blockCols).eq('day', day).gte('start_time', morning),
      supabase.from('cass_time_blocks').select(blockCols).eq('day', next).lt('start_time', morning),
      supabase.from('cass_tasks').select(taskCols).eq('day', day).gte('start_time', morning),
      supabase.from('cass_tasks').select(taskCols).eq('day', next).lt('start_time', morning),
    ])
    const err = blockRes.error ?? lateBlockRes.error ?? taskRes.error ?? lateTaskRes.error
    if (err) setError(err.message)
    const blocks: CalItem[] = [...(blockRes.data ?? []), ...(lateBlockRes.data ?? [])].map((b) => {
      const { start, end } = fromStored(b.day, b.start_time, b.end_time)
      const doneEarly = isDoneEarly(b.done, b.done_at, day, start)
      const fixed = hasSetTime(b.cass_habits)
      return {
        id: b.id,
        title: b.title,
        start,
        end,
        kind: 'block',
        done: b.done,
        habitId: b.habit_id,
        source: b.source,
        doneEarly,
        fixed,
        processId: b.process_id,
      }
    })
    const tasks: CalItem[] = [...(taskRes.data ?? []), ...(lateTaskRes.data ?? [])].map((t) => {
      const { start, end } = fromStored(t.day, t.start_time!, t.end_time)
      return { id: t.id, title: t.title, start, end, kind: 'task', done: t.done }
    })
    return [...blocks, ...tasks].sort((a, b) => a.start - b.start)
  }, [])

  // Today, every habit without a block yet goes into the first gap that fits it.
  // The (habit_id, logical_day) unique index keeps a racing load from placing one
  // twice; logical_day is the 6am to 6am day, so a habit after midnight still counts
  // for the night before.
  const placeHabitBlocks = useCallback(
    async (current: CalItem[], day: string) => {
      const { data: habits, error } = await supabase
        .from('cass_habits')
        .select('id,title,minutes,frequency,weekday,start_time')
        .order('sort_order')
      if (error) return setError(error.message), false
      const from = habitSearchFrom(day, today, nowHours())
      if (from === null) return false
      const forDay = habitsForDay(habits ?? [], day).map((h) => ({ ...h, start: h.start_time ? hoursOf(h.start_time) : null }))
      const placements = placeHabits(current, forDay, from)
      for (const p of placements) {
        const { error: insertError } = await supabase.from('cass_time_blocks').upsert(
          {
            ...toStored(day, p.start, p.end),
            title: p.title,
            kind: 'personal',
            source: 'habit',
            habit_id: p.habitId,
          },
          { onConflict: 'habit_id,logical_day', ignoreDuplicates: true },
        )
        if (insertError) return setError(insertError.message), true
      }
      return placements.length > 0
    },
    [today],
  )

  // Loads one day: its blocks (placing its habits first if it's today or later)
  // and its unfinished todos, into byDay
  const loadDay = useCallback(
    async (d: string) => {
      const run = (loadRuns.current.get(d) ?? 0) + 1
      loadRuns.current.set(d, run)
      fetchedDays.current.add(d)
      let current = await fetchDayItems(d)
      if (d >= today && (await placeHabitBlocks(current, d))) current = await fetchDayItems(d)
      // After habits are placed, so a day's first visit lists them
      const todoRes = await supabase
        .from('cass_time_blocks')
        .select('id,title,day,start_time,end_time,habit_id,cass_habits(start_time)')
        .in('source', ['app', 'habit'])
        .eq('done', false)
        .eq('logical_day', d)
        .order('day')
        .order('start_time')
      if (todoRes.error) setError(todoRes.error.message)
      if (loadRuns.current.get(d) !== run) return
      const dayTodos = (todoRes.data ?? []).map((t) => {
        const { day: logicalDay, start, end } = fromStored(t.day, t.start_time, t.end_time)
        return { id: t.id, title: t.title, day: logicalDay, start, end, habit: !!t.habit_id, fixed: hasSetTime(t.cass_habits) }
      })
      setByDay((prev) => ({ ...prev, [d]: { items: current, todos: dayTodos } }))
    },
    [today, fetchDayItems, placeHabitBlocks],
  )

  // Reloads the day being shown (after a save)
  const load = useCallback(() => loadDay(day), [day, loadDay])

  const pullToRefresh = async () => {
    setRefreshing(true)
    setError(null)
    await loadDay(day)
    setRefreshing(false)
  }

  // Today and yesterday are fetched as soon as the app opens
  useEffect(() => {
    loadDay(today)
    loadDay(shiftDay(today, -1))
  }, [today, loadDay])

  // The day being shown refreshes, and the days either side are fetched once so
  // the arrows and swipes land on a day that's already there
  useEffect(() => {
    loadDay(day)
    for (const neighbor of [shiftDay(day, -1), shiftDay(day, 1)]) {
      if (!fetchedDays.current.has(neighbor)) loadDay(neighbor)
    }
  }, [day, loadDay])

  // Saves new times for every moved block, then reloads. Times are hours into
  // `dayOf(id)` (the viewed day unless said otherwise), so one past midnight is
  // stored on the next date.
  const saveMoves = async (moves: Move[], dayOf: (id: string) => string = () => day) => {
    const results = await Promise.all(
      moves.map((m) =>
        supabase
          .from(m.kind === 'block' ? 'cass_time_blocks' : 'cass_tasks')
          .update(toStored(dayOf(m.id), m.start, m.end))
          .eq('id', m.id),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    await load()
  }

  // New todos and follow-ups fill the first gap that fits
  const insertBlock = async (title: string, length: number, label: string) => {
    const start = newBlockStart(items, length, day === today, nowHours())
    if (start === null) return setError(`No room left today for ${label}`)
    const { error } = await supabase
      .from('cass_time_blocks')
      .insert({ ...toStored(day, start, start + length), title, kind: 'personal', source: 'app' })
    if (error) return setError(error.message)
    load()
  }

  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    insertBlock(title, 1, 'that todo')
  }

  // The rules for each menu option live in src/schedule.ts
  const setStatus = async (item: CalItem, status: Status) => {
    const table = item.kind === 'block' ? 'cass_time_blocks' : 'cass_tasks'
    const now = nowHours()

    if (status === 'start_now') {
      const plan = startNowPlan(items, item, now)
      if ('error' in plan) return setError(plan.error)
      if (plan.moves.length) saveMoves(plan.moves)
      return
    }
    if (status === 'follow_up') return insertBlock(`Follow up: ${item.title}`, 0.5, 'a follow-up')
    if (status === 'done') {
      const plan = donePlan(items, item, day, today, now)
      const update: Record<string, unknown> = { done: true }
      if (item.kind === 'block') update.done_at = new Date().toISOString()
      if (plan.endAt !== null) update.end_time = toStored(day, item.start, plan.endAt).end_time
      const { error } = await supabase.from(table).update(update).eq('id', item.id)
      if (error) return setError(error.message)
      return saveMoves(plan.moves)
    }
    const plan = notStartedPlan(items, item, day, today, now)
    if ('error' in plan) return setError(plan.error)
    if (item.done) {
      const reset = item.kind === 'block' ? { done: false, done_at: null } : { done: false }
      const { error } = await supabase.from(table).update(reset).eq('id', item.id)
      if (error) return setError(error.message)
    }
    saveMoves(plan.moves)
  }

  // The card's slider saves a new length, then the card shows the new end
  const resizeDetail = async (d: Detail, minutes: number) => {
    if (d.from === 'todo') {
      const todo = todos.find((t) => t.id === d.id)
      if (!todo) return setError('That todo changed; close the card and open it again')
      await setMinutes(todo, minutes)
    } else {
      const item = items.find((it) => it.id === d.id)
      if (!item) return setError('That block changed; close the card and open it again')
      const plan = resizeItemPlan(items, item, minutes)
      if ('error' in plan) return setError(plan.error)
      if (plan.moves.length) await saveMoves(plan.moves)
    }
    setDetail({ ...d, end: d.start + minutes / 60 })
  }

  // The card's start slider moves the block, same length
  const moveDetail = async (d: Detail, start: number) => {
    let plan
    if (d.from === 'todo') {
      const todo = todos.find((t) => t.id === d.id)
      if (!todo) return setError('That todo changed; close the card and open it again')
      plan = moveTodoStartPlan(todos, todo, start)
      if ('error' in plan) return setError(plan.error)
      if (plan.moves.length) await saveMoves(plan.moves, () => todo.day)
      return setDetail({ ...d, start, end: start + (d.end - d.start) })
    } else {
      const item = items.find((it) => it.id === d.id)
      if (!item) return setError('That block changed; close the card and open it again')
      plan = moveStartPlan(items, item, start)
    }
    if ('error' in plan) return setError(plan.error)
    if (plan.moves.length) await saveMoves(plan.moves)
    setDetail({ ...d, start, end: start + (d.end - d.start) })
  }

  const setMinutes = async (todo: Todo, minutes: number) => {
    const plan = resizePlan(todos, todo, minutes)
    if ('error' in plan) return setError(plan.error)
    if (plan.moves.length) await saveMoves(plan.moves, () => todo.day)
  }

  // Done now from the card. On the day being shown it follows the same rules as
  // Done in the block menu; on any other day it just marks it done.
  const doneNow = async (d: Detail) => {
    setDetail(null)
    const item = d.day === day ? items.find((it) => it.id === d.id) : undefined
    if (item) return setStatus(item, 'done')
    const { error } = await supabase
      .from('cass_time_blocks')
      .update({ done: true, done_at: new Date().toISOString() })
      .eq('id', d.id)
    if (error) return setError(error.message)
    load()
  }

  // Done at its scheduled end from the card: marked done as scheduled, nothing moves
  const doneAtScheduledEnd = async (d: Detail) => {
    setDetail(null)
    const isTask = d.from === 'item' && items.find((it) => it.id === d.id)?.kind === 'task'
    const { error } = await supabase
      .from(isTask ? 'cass_tasks' : 'cass_time_blocks')
      .update(isTask ? { done: true } : doneAtEnd(d.day, d.start, d.end))
      .eq('id', d.id)
    if (error) return setError(error.message)
    load()
  }

  // Starts a habit's routine timer from the picked step
  const startRoutine = (d: Detail, stepName: string) => {
    const steps = routineFrom(ROUTINES[d.title] ?? [], stepName)
    if (!steps.length) return
    setDetail(null)
    setRoutine({ detail: d, steps, index: 0, stepStartedAt: Date.now() })
  }

  // Records one stretch of a routine as a block under its parent (process_id),
  // on the 6am to 6am day it started. Under a minute isn't kept.
  const recordSegment = async (name: string, startMs: number, endMs: number) => {
    if (!routine || endMs - startMs < 60_000) return
    const begin = logicalNow(new Date(startMs))
    const finish = logicalNow(new Date(endMs))
    const endHours = finish.day === begin.day ? finish.hours : finish.hours + 24
    const { error } = await supabase.from('cass_time_blocks').insert({
      ...toStored(begin.day, begin.hours, endHours),
      title: name,
      kind: 'personal',
      source: 'routine',
      process_id: routine.detail.id,
      process_role: 'member',
      done: true,
      done_at: new Date(endMs).toISOString(),
    })
    if (error) setError(error.message)
  }

  // Loads a block's recorded routine steps when its card opens
  useEffect(() => {
    setDetailParts([])
    if (!detail) return
    supabase
      .from('cass_time_blocks')
      .select('id,title,day,start_time,end_time')
      .eq('process_id', detail.id)
      .order('day')
      .order('start_time')
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        setDetailParts(
          (data ?? []).map((b) => {
            const { start, end } = fromStored(b.day, b.start_time, b.end_time)
            return { id: b.id, title: b.title, start, end }
          }),
        )
      })
  }, [detail?.id])

  // A todo added at a tapped time; the todos and habits from there on move along
  // behind it (insertAtPlan). Mark as Done adds it already done, stamped at its end.
  const addTodoAt = async (title: string, start: number, minutes: number, done: boolean) => {
    setAddAt(null)
    const plan = insertAtPlan(items, start, minutes / 60)
    if ('error' in plan) return setError(plan.error)
    const { error } = await supabase
      .from('cass_time_blocks')
      .insert({
        ...toStored(day, plan.start, plan.end),
        ...(done ? doneAtEnd(day, plan.start, plan.end) : {}),
        title,
        kind: 'personal',
        source: 'app',
      })
    if (error) return setError(error.message)
    await saveMoves(plan.moves)
  }

  // A Help option tracks on today's agenda: a block starting now, with the todos
  // and habits not finished pushed after it (interruptPlan). Then show it.
  const trackHelp = async (name: string, option: string) => {
    const todayItems = await fetchDayItems(today)
    const plan = interruptPlan(todayItems, nowHours(), HELP_MINUTES / 60)
    if ('error' in plan) return setError(plan.error)
    const { error } = await supabase.from('cass_time_blocks').insert({
      ...toStored(today, plan.start, plan.end),
      title: `${name}: ${option}`,
      kind: 'personal',
      source: 'help',
    })
    if (error) return setError(error.message)
    setTab('agenda')
    setDay(today)
    await saveMoves(plan.moves, () => today)
  }

  // Dragging a todo to a new spot re-packs the swapped range back to back from
  // where its first todo started, each keeping its own length.
  const reorder = async (next: Todo[]) => {
    const updates = relayout(todos, next)
    if (!updates.length) return
    const moved = new Map(updates.map((u) => [u.id, u]))
    const list = next.map((t) => ({ ...t, ...(moved.get(t.id) ?? {}) }))
    setByDay((prev) => ({ ...prev, [day]: { items: prev[day]?.items ?? [], todos: list } }))
    const dayById = new Map(todos.map((t) => [t.id, t.day]))
    await saveMoves(
      updates.map((u) => ({ ...u, kind: 'block' as const })),
      (id) => dayById.get(id) ?? day,
    )
  }

  return (
    <View style={styles.screen}>
      {/* Planning (habits) stays mounted, hidden on other tabs, so it's loaded before you open it */}
      <View style={tab === 'planning' ? styles.screenFill : styles.hidden}>
        <HabitsScreen active={tab === 'planning'} today={today} onSettings={setSettingsMenu} />
      </View>
      {tab === 'planning' ? null : tab === 'help' ? (
        <HelpScreen onSettings={setSettingsMenu} onTrack={trackHelp} />
      ) : (
      <View style={styles.screenFill} {...(tab === 'agenda' ? daySwipe.panHandlers : {})}>
        {/* Stays put while the agenda or todos scroll underneath */}
        <View style={[styles.header, styles.fixedHeader]}>
          <Pressable onPress={() => setDay(shiftDay(day, -1))} hitSlop={10}>
            <ChevronLeft size={22} color={c.ink} />
          </Pressable>
          <Pressable onPress={() => setDay(today)}>
            <Text style={styles.title}>{day === today ? 'Today' : dayLabel(day)}</Text>
            {day === today ? <Text style={styles.subtitle}>{dayLabel(day)}</Text> : null}
          </Pressable>
          <View style={styles.headerRight}>
            <Pressable onPress={() => setDay(shiftDay(day, 1))} hitSlop={10}>
              <ChevronRight size={22} color={c.ink} />
            </Pressable>
            <SettingsButton onOpen={setSettingsMenu} />
          </View>
        </View>
        <ScrollView
          scrollEnabled={!dragging}
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {tab === 'todos' ? (
            <View style={styles.card}>
              <TodoList todos={todos} today={today} onMinutes={setMinutes} onReorder={reorder} onDragging={setDragging} onOpen={(t) => setDetail({ id: t.id, from: 'todo', title: t.title, day: t.day, start: t.start, end: t.end, done: false, fixed: !!t.fixed })} />
              <View style={[styles.addRow, todos.length > 0 && styles.addRowDivider]}>
                <TextInput
                  style={styles.addInput}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Add a todo"
                  placeholderTextColor={c.muted}
                  returnKeyType="done"
                  onSubmitEditing={add}
                />
                <Pressable onPress={add} hitSlop={8}>
                  <Plus size={20} color={c.accent} />
                </Pressable>
              </View>
            </View>
          ) : (
            <DayGrid
              items={items}
              showNow={day === today}
              onMore={(item, x, y) => setMenu({ item, x, y })}
              onOpen={(item) => setDetail({ id: item.id, from: 'item', title: item.title, day, start: item.start, end: item.end, done: item.done, fixed: !!item.fixed })}
              onAddAt={setAddAt}
            />
          )}

        </ScrollView>
      </View>
      )}

      <View style={styles.tabBar}>
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key
          return (
            <Pressable
              key={key}
              style={styles.tabItem}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Icon size={20} color={active ? c.accent : c.muted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
            </Pressable>
          )
        })}
      </View>

      <Modal visible={menu !== null} transparent animationType="none" onRequestClose={() => setMenu(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)}>
          {menu ? (
            <View style={[styles.menu, { top: menu.y + 12, right: Math.max(8, width - menu.x - 12) }]}>
              {menuOptions(menu.item, day, today, nowHours()).map(([status, label]) => (
                <Pressable
                  key={status}
                  style={styles.menuItem}
                  onPress={() => {
                    setMenu(null)
                    setStatus(menu.item, status)
                  }}
                >
                  <Text style={styles.menuText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      </Modal>

      <Modal visible={detail !== null} transparent animationType="none" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.detailBackdrop} onPress={() => setDetail(null)}>
          {detail ? (
            <DetailCard
              detail={detail}
              today={today}
              onResize={resizeDetail}
              onMove={moveDetail}
              onDoneNow={doneNow}
              onDoneAtEnd={doneAtScheduledEnd}
              onStartRoutine={startRoutine}
              parts={detailParts}
            />
          ) : null}
        </Pressable>
      </Modal>

      <Modal visible={routine !== null} animationType="slide" onRequestClose={() => setRoutine(null)}>
        {routine ? (
          <RoutineTimer
            run={routine}
            routine={ROUTINES[routine.detail.title] ?? []}
            onSwitch={(choice, index) =>
              setRoutine((r) =>
                r
                  ? {
                      ...r,
                      steps: switchRoutine(ROUTINES[r.detail.title] ?? [], r.steps, index, choice),
                      index: 0,
                      stepStartedAt: Date.now(),
                    }
                  : r,
              )
            }
            onSegment={recordSegment}
            onChange={(index, stepStartedAt) => setRoutine((r) => (r ? { ...r, index, stepStartedAt } : r))}
            onChoresDone={() => doneNow(routine.detail)}
            onClose={() => setRoutine(null)}
          />
        ) : null}
      </Modal>

      <Modal visible={addAt !== null} transparent animationType="none" onRequestClose={() => setAddAt(null)}>
        <KeyboardAvoidingView style={styles.screenFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.detailBackdrop} onPress={() => setAddAt(null)}>
            {addAt !== null ? (
              <AddTodoCard at={addAt} onSave={addTodoAt} />
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={settingsMenu !== null} transparent animationType="none" onRequestClose={() => setSettingsMenu(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSettingsMenu(null)}>
          {settingsMenu ? (
            <View style={[styles.menu, { top: settingsMenu.y + 12, right: Math.max(8, width - settingsMenu.x - 12) }]}>
              <Pressable
                style={[styles.menuItem, styles.menuRow]}
                onPress={() => {
                  setSettingsMenu(null)
                  supabase.auth.signOut()
                }}
              >
                <LogOut size={16} color={c.ink} />
                <Text style={styles.menuText}>Sign out</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  )
}

type Habit = { id: string; title: string; minutes: number; frequency: 'daily' | 'weekly'; weekday: number | null }

// One of a habit's blocks, with its 6am to 6am day and times
type HabitBlock = { logical_day: string; done: boolean; start: number; end: number }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

const TABS = [
  { key: 'todos', label: 'Todos', Icon: ListTodo },
  { key: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { key: 'planning', label: 'Planning', Icon: NotebookPen },
  { key: 'help', label: 'Help', Icon: LifeBuoy },
] as const

// The Help tab's cards and what each one can do. Set here in code for now.
const HELP = [
  { name: 'Theo', options: ['Open window', 'Puzzles'] },
  { name: 'Cat Fight', options: ['Play'] },
]
// How long a Help block starts out; Done now ends it at the real time
const HELP_MINUTES = 15

// Habits with a routine: their card shows a small card per timed step, and
// tapping one starts the full-page timer from that step. Set here in code.
const ROUTINES: Record<string, RoutineStep[]> = {
  'Shut down': [
    { name: 'Dishwasher', minutes: 5 },
    { name: 'Empty sink', minutes: 5 },
    { name: 'Wet food', minutes: 5 },
    // Reaching Puzzles means the chores are done
    { name: 'Puzzles', minutes: 5, afterChores: true },
  ],
}

// Opens the settings menu (just Sign out) beside where it was tapped
function SettingsButton({ onOpen }: { onOpen: (at: { x: number; y: number }) => void }) {
  return (
    <Pressable
      onPress={(e) => onOpen({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      hitSlop={10}
      accessibilityLabel="Settings"
    >
      <Settings size={20} color={c.ink} />
    </Pressable>
  )
}

// Title on the left, settings on the right, for the tabs without day navigation
function ScreenHeader({
  title,
  onSettings,
  onAdd,
}: {
  title: string
  onSettings: (at: { x: number; y: number }) => void
  // Shows "+ Add" left of the gear
  onAdd?: () => void
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.headerRight}>
        {onAdd ? (
          <Pressable style={styles.addButton} onPress={onAdd} hitSlop={8}>
            <Plus size={16} color={c.accent} />
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        ) : null}
        <SettingsButton onOpen={onSettings} />
      </View>
    </View>
  )
}

// Help: a small card per person or pet; tapping one lists what you can do, and
// picking one tracks it on today's agenda starting now
function HelpScreen({
  onSettings,
  onTrack,
}: {
  onSettings: (at: { x: number; y: number }) => void
  onTrack: (name: string, option: string) => void
}) {
  const [open, setOpen] = useState<(typeof HELP)[number] | null>(null)

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <ScreenHeader title="Help" onSettings={onSettings} />
        <View style={styles.helpGrid}>
          {HELP.map((h) => (
            <Pressable key={h.name} style={styles.helpCard} onPress={() => setOpen(h)}>
              <Text style={styles.helpCardText}>{h.name}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={open !== null} transparent animationType="none" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.detailBackdrop} onPress={() => setOpen(null)}>
          {open ? (
            // Claims taps on the card so only the backdrop closes it
            <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.detailTitle}>{open.name}</Text>
              {open.options.map((option) => (
                <Pressable
                  key={option}
                  style={styles.submitButton}
                  onPress={() => {
                    setOpen(null)
                    onTrack(open.name, option)
                  }}
                >
                  <Text style={styles.doneButtonText}>{option}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  )
}

function HabitsScreen({
  active,
  today,
  onSettings,
}: {
  // Whether the Habits tab is showing; opening it refreshes in the background
  active: boolean
  today: string
  onSettings: (at: { x: number; y: number }) => void
}) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Habit | null>(null)
  const [adding, setAdding] = useState(false)
  // Every habit's blocks, loaded with the list so a habit's history is ready the
  // moment its card opens
  const [blocksByHabit, setBlocksByHabit] = useState<Map<string, HabitBlock[]>>(new Map())

  // Loads when the app starts and again each time the tab opens, keeping what's
  // already on screen until the fresh copy arrives
  useEffect(() => {
    if (!active && habits.length) return
    Promise.all([
      supabase.from('cass_habits').select('id,title,minutes,frequency,weekday').order('sort_order'),
      supabase.from('cass_time_blocks').select('habit_id,day,logical_day,start_time,end_time,done').not('habit_id', 'is', null),
    ]).then(([habitRes, blockRes]) => {
      const err = habitRes.error ?? blockRes.error
      if (err) setError(err.message)
      setHabits(habitRes.data ?? [])
      const byHabit = new Map<string, HabitBlock[]>()
      for (const b of blockRes.data ?? []) {
        const row = { logical_day: b.logical_day, done: b.done, ...fromStored(b.day, b.start_time, b.end_time) }
        byHabit.set(b.habit_id, [...(byHabit.get(b.habit_id) ?? []), row])
      }
      setBlocksByHabit(byHabit)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const addHabit = async (draft: Omit<Habit, 'id'>) => {
    setAdding(false)
    const { data, error } = await supabase
      .from('cass_habits')
      .insert({ ...draft, sort_order: habits.length + 1 })
      .select('id,title,minutes,frequency,weekday')
      .single()
    if (error) return setError(error.message)
    setHabits((list) => [...list, data])
  }

  // Saves daily/weekly and the weekday. Unfinished blocks after today are cleared
  // so they get placed again on the right days as those days are opened.
  const changeSchedule = async (habit: Habit, frequency: Habit['frequency'], weekday: number | null) => {
    const next = { ...habit, frequency, weekday: frequency === 'daily' ? null : weekday }
    setHabits((list) => list.map((h) => (h.id === habit.id ? next : h)))
    setSelected(next)
    const { error } = await supabase
      .from('cass_habits')
      .update({ frequency: next.frequency, weekday: next.weekday })
      .eq('id', habit.id)
    if (error) return setError(error.message)
    const cleared = await supabase
      .from('cass_time_blocks')
      .delete()
      .eq('habit_id', habit.id)
      .eq('done', false)
      .gt('logical_day', today)
    if (cleared.error) setError(cleared.error.message)
    // The cleared blocks were unfinished and after today, so they never show in
    // the history; drop them here too so nothing stale lingers
    setBlocksByHabit((map) => {
      const nextMap = new Map(map)
      nextMap.set(habit.id, (map.get(habit.id) ?? []).filter((b) => b.done || b.logical_day <= today))
      return nextMap
    })
  }

  const sections = [
    { title: 'DAILY HABITS', list: habits.filter((h) => h.frequency === 'daily') },
    { title: 'WEEKLY HABITS', list: habits.filter((h) => h.frequency === 'weekly') },
  ]

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <ScreenHeader title="Planning" onSettings={onSettings} onAdd={() => setAdding(true)} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sections.map(({ title, list }) => (
          <View key={title}>
            <Text style={styles.sectionLabel}>{title}</Text>
            <View style={styles.card}>
              {list.length ? (
                list.map((h) => (
                  <Pressable key={h.id} style={styles.todoRow} onPress={() => setSelected(h)}>
                    <Text style={[styles.todoText, { flex: 1 }]}>{h.title}</Text>
                    {h.frequency === 'weekly' ? (
                      <Text style={styles.minutesLabel}>{h.weekday === null ? 'Pick a day' : WEEKDAY_NAMES[h.weekday]}</Text>
                    ) : null}
                    <Text style={styles.minutesLabel}>{h.minutes} min</Text>
                    <ChevronRight size={18} color={c.muted} />
                  </Pressable>
                ))
              ) : (
                <Text style={[styles.minutesLabel, styles.emptySection]}>None yet</Text>
              )}
            </View>
          </View>
        ))}

      </ScrollView>

      {/* Outside the ScrollView, so one tap on the backdrop closes it */}
      <Modal visible={adding} transparent animationType="none" onRequestClose={() => setAdding(false)}>
        {/* The name field opens the keyboard, so the card rises to sit above it */}
        <KeyboardAvoidingView style={styles.screenFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.detailBackdrop} onPress={() => setAdding(false)}>
            {adding ? <AddHabitCard onSave={addHabit} /> : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={selected !== null} transparent animationType="none" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.detailBackdrop} onPress={() => setSelected(null)}>
          {selected ? (
            <HabitHistory
              habit={selected}
              blocks={blocksByHabit.get(selected.id) ?? []}
              today={today}
              onSchedule={changeSchedule}
            />
          ) : null}
        </Pressable>
      </Modal>
    </>
  )
}

// A todo added at a tapped time on the agenda: a name, then the same Start
// (centered on the tapped time) and Duration sliders as the todo card
function AddTodoCard({
  at,
  onSave,
}: {
  at: number
  onSave: (title: string, start: number, minutes: number, done: boolean) => void
}) {
  const [title, setTitle] = useState('')
  const [offset, setOffset] = useState(0)
  const [minutes, setMinutes] = useState(60)
  const ready = title.trim().length > 0
  const startMin = Math.min(Math.max(Math.round(at * 60) + offset, 0), DAY_END * 60 - minutes)
  const start = startMin / 60
  const save = (done: boolean) => ready && onSave(title.trim(), start, minutes, done)

  return (
    // Claims taps on the card so only the backdrop closes it
    <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
      <Text style={styles.detailTitle}>New todo</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Name"
        placeholderTextColor={c.muted}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => save(false)}
      />
      <Text style={styles.detailTimes}>
        {clock(start)} – {clock(start + minutes / 60)} · {minutes} min
      </Text>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Start</Text>
        <Slider
          style={styles.slider}
          value={offset}
          minimumValue={-START_SLIDER_RANGE}
          maximumValue={START_SLIDER_RANGE}
          step={SLIDER_STEP}
          minimumTrackTintColor={c.line}
          maximumTrackTintColor={c.line}
          thumbTintColor={c.accent}
          onValueChange={(v) => setOffset(Math.round(v))}
          accessibilityLabel="Move the start time earlier or later"
        />
      </View>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Duration</Text>
        <Slider
          style={styles.slider}
          value={minutes}
          minimumValue={SLIDER_STEP}
          maximumValue={SLIDER_MAX}
          step={SLIDER_STEP}
          minimumTrackTintColor={c.accent}
          maximumTrackTintColor={c.line}
          thumbTintColor={c.accent}
          onValueChange={(v) => setMinutes(Math.round(v))}
          accessibilityLabel="Duration in minutes"
        />
      </View>
      <View style={styles.doneRow}>
        <Pressable style={[styles.doneButton, !ready && styles.buttonDisabled]} disabled={!ready} onPress={() => save(false)}>
          <Text style={[styles.doneButtonText, !ready && styles.buttonDisabledText]}>Add</Text>
        </Pressable>
        <Pressable style={[styles.doneButton, !ready && styles.buttonDisabled]} disabled={!ready} onPress={() => save(true)}>
          <Text style={[styles.doneButtonText, !ready && styles.buttonDisabledText]}>Mark as Done</Text>
        </Pressable>
      </View>
    </View>
  )
}

// A new habit: name, how long it takes, and daily or weekly (with its day)
function AddHabitCard({ onSave }: { onSave: (draft: Omit<Habit, 'id'>) => void }) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [frequency, setFrequency] = useState<Habit['frequency']>('daily')
  const [weekday, setWeekday] = useState<number | null>(null)
  const ready = title.trim().length > 0 && (frequency === 'daily' || weekday !== null)

  return (
    // Claims taps on the card so only the backdrop closes it
    <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
      <Text style={styles.detailTitle}>New habit</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Name"
        placeholderTextColor={c.muted}
        autoFocus
      />
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Length</Text>
        <View style={styles.durations}>
          {durationOptions(minutes).map((m) => {
            const active = m === minutes
            return (
              <Pressable
                key={m}
                style={[styles.duration, active && styles.durationSelected]}
                onPress={() => setMinutes(m)}
                accessibilityLabel={`${m} minutes`}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.durationText, active && styles.durationTextSelected]}>{m}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <View style={styles.segment}>
        {(['daily', 'weekly'] as const).map((f) => {
          const active = frequency === f
          return (
            <Pressable
              key={f}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setFrequency(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {f === 'daily' ? 'Daily' : 'Weekly'}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {frequency === 'weekly' ? (
        <>
          <Text style={styles.historySummary}>Which day?</Text>
          <View style={styles.weekdays}>
            {WEEKDAYS.map((label, i) => {
              const active = weekday === i
              return (
                <Pressable
                  key={label}
                  style={[styles.weekday, active && styles.segmentItemActive]}
                  onPress={() => setWeekday(i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={WEEKDAY_NAMES[i]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}
      <Pressable
        style={[styles.submitButton, !ready && styles.buttonDisabled]}
        disabled={!ready}
        onPress={() =>
          onSave({ title: title.trim(), minutes, frequency, weekday: frequency === 'weekly' ? weekday : null })
        }
      >
        <Text style={[styles.doneButtonText, !ready && styles.buttonDisabledText]}>Add habit</Text>
      </Pressable>
    </View>
  )
}

// Each day's done or not done for one habit (habitHistory in src/schedule.ts)
function HabitHistory({
  habit,
  blocks,
  today,
  onSchedule,
}: {
  habit: Habit
  blocks: HabitBlock[]
  today: string
  onSchedule: (habit: Habit, frequency: Habit['frequency'], weekday: number | null) => void
}) {
  const rows = habitHistory(blocks, today, habit.frequency === 'weekly' ? habit.weekday : null)

  const past = rows.filter((r) => r.status !== 'pending')
  const doneCount = past.filter((r) => r.status === 'done').length

  return (
    // Claims taps on the card so only the backdrop closes it
    <View style={[styles.detailCard, styles.historyCard]} onStartShouldSetResponder={() => true}>
      <Text style={styles.detailTitle}>{habit.title}</Text>
      <View style={styles.segment}>
        {(['daily', 'weekly'] as const).map((f) => {
          const active = habit.frequency === f
          return (
            <Pressable
              key={f}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => !active && onSchedule(habit, f, habit.weekday)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {f === 'daily' ? 'Daily' : 'Weekly'}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {habit.frequency === 'weekly' ? (
        <>
          <Text style={styles.historySummary}>Which day?</Text>
          <View style={styles.weekdays}>
            {WEEKDAYS.map((label, i) => {
              const active = habit.weekday === i
              return (
                <Pressable
                  key={label}
                  style={[styles.weekday, active && styles.segmentItemActive]}
                  onPress={() => !active && onSchedule(habit, 'weekly', i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={WEEKDAY_NAMES[i]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}
      {rows.length ? (
        <>
          <Text style={styles.historySummary}>
            Done {doneCount} of {past.length} {past.length === 1 ? 'day' : 'days'}
          </Text>
          <ScrollView style={styles.historyList}>
            {rows.map((r) => (
              <View key={r.day} style={styles.todoRow}>
                {r.status === 'done' ? (
                  <Check size={18} color={c.accent} />
                ) : r.status === 'pending' ? (
                  <Clock size={18} color={c.muted} />
                ) : (
                  <X size={18} color={c.muted} />
                )}
                <Text style={[styles.todoText, { flex: 1 }]}>{r.day === today ? 'Today' : dayLabel(r.day)}</Text>
                <Text style={styles.minutesLabel}>
                  {r.status === 'done'
                    ? `${clock(r.start)} · ${r.minutes} min`
                    : r.status === 'pending'
                      ? 'Not done yet'
                      : 'Not done'}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      ) : (
        <Text style={styles.historySummary}>No days yet</Text>
      )}
    </View>
  )
}

// Slider steps for a block's length, in minutes
const SLIDER_STEP = 5
const SLIDER_MAX = 240
// How far the start slider reaches either side of the current start, in minutes
const START_SLIDER_RANGE = 120

function DetailCard({
  detail,
  today,
  onResize,
  onMove,
  onDoneNow,
  onDoneAtEnd,
  onStartRoutine,
  parts,
}: {
  detail: Detail
  today: string
  onResize: (detail: Detail, minutes: number) => void
  onMove: (detail: Detail, start: number) => void
  onDoneNow: (detail: Detail) => void
  onDoneAtEnd: (detail: Detail) => void
  onStartRoutine: (detail: Detail, step: string) => void
  // Recorded routine steps under this block
  parts: { id: string; title: string; start: number; end: number }[]
}) {
  const routineSteps = (ROUTINES[detail.title] ?? []).filter((step) => step.minutes !== null)
  const saved = Math.round((detail.end - detail.start) * 60)
  const savedStart = Math.round(detail.start * 60)
  const [minutes, setMinutes] = useState(saved)
  // The start slider is an offset from the saved start, so it opens centered and
  // snaps back to the middle after each move
  const [offset, setOffset] = useState(0)
  useEffect(() => setMinutes(saved), [saved])
  useEffect(() => setOffset(0), [savedStart])
  const startMin = Math.min(Math.max(savedStart + offset, 0), DAY_END * 60 - minutes)
  const start = startMin / 60

  return (
    // Claims taps on the card so only the backdrop closes it
    <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
      <Text style={styles.detailTitle}>{detail.title}</Text>
      {detail.day === today ? null : <Text style={styles.detailDay}>{dayLabel(detail.day)}</Text>}
      <Text style={styles.detailTimes}>
        {clock(start)} – {clock(start + minutes / 60)} · {minutes} min
      </Text>

      {detail.fixed ? (
        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>Start</Text>
          <Text style={styles.minutesLabel}>Fixed at {clock(detail.start)}</Text>
        </View>
      ) : (
        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>Start</Text>
          <Slider
            style={styles.slider}
            value={offset}
            minimumValue={-START_SLIDER_RANGE}
            maximumValue={START_SLIDER_RANGE}
            step={SLIDER_STEP}
            minimumTrackTintColor={c.line}
            maximumTrackTintColor={c.line}
            thumbTintColor={c.accent}
            onValueChange={(v) => setOffset(Math.round(v))}
            onSlidingComplete={() => {
              if (startMin !== savedStart) onMove(detail, startMin / 60)
              else setOffset(0)
            }}
            accessibilityLabel="Move the start time earlier or later"
          />
        </View>
      )}

      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Duration</Text>
        <Slider
          style={styles.slider}
          value={minutes}
          minimumValue={SLIDER_STEP}
          maximumValue={Math.max(SLIDER_MAX, saved)}
          step={SLIDER_STEP}
          minimumTrackTintColor={c.accent}
          maximumTrackTintColor={c.line}
          thumbTintColor={c.accent}
          onValueChange={(v) => setMinutes(Math.round(v))}
          onSlidingComplete={(v) => {
            const next = Math.round(v)
            if (next !== saved) onResize(detail, next)
          }}
          accessibilityLabel="Duration in minutes"
        />
      </View>

      {routineSteps.length ? (
        <View style={styles.stepCards}>
          {routineSteps.map((step) => (
            <Pressable
              key={step.name}
              style={styles.stepCard}
              onPress={() => onStartRoutine(detail, step.name)}
              accessibilityLabel={`Start the timer from ${step.name}`}
            >
              <Text style={styles.stepCardText}>{step.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {detail.done ? null : (
        <View style={styles.doneRow}>
          <Pressable style={styles.doneButton} onPress={() => onDoneNow(detail)}>
            <Text style={styles.doneButtonText}>Done now</Text>
          </Pressable>
          <Pressable style={styles.doneButton} onPress={() => onDoneAtEnd(detail)}>
            <Text style={styles.doneButtonText}>Done at {clock(detail.end)}</Text>
          </Pressable>
        </View>
      )}

      {parts.length ? (
        <View style={styles.parts}>
          <Text style={styles.sectionLabel}>ACTIVITY</Text>
          {parts.map((p) => (
            <View key={p.id} style={styles.partRow}>
              <Text style={[styles.todoText, { flex: 1 }]}>{p.title}</Text>
              <Text style={styles.minutesLabel}>
                {clock(p.start)} · {Math.round((p.end - p.start) * 60)} min
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

// "4:05" from milliseconds
function mmss(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The full-page routine timer. Each step counts down and moves on by itself, and
// the last one running out ends the run. Reaching the afterChores step (Puzzles)
// marks the habit done once. Every stretch is handed to onSegment for the calendar.
function RoutineTimer({
  run,
  routine,
  onChange,
  onSwitch,
  onSegment,
  onChoresDone,
  onClose,
}: {
  run: { steps: RoutineStep[]; index: number; stepStartedAt: number }
  // The whole routine, for Switch!
  routine: RoutineStep[]
  onChange: (index: number, stepStartedAt: number) => void
  onSwitch: (choice: { step: string } | { oneOff: string }, index: number) => void
  onSegment: (name: string, startMs: number, endMs: number) => void
  onChoresDone: () => void
  onClose: () => void
}) {
  const [now, setNow] = useState(Date.now())
  // When the current step was paused; while set, the clock holds at that moment
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const [switching, setSwitching] = useState(false)
  const [oneOff, setOneOff] = useState('')
  const markedDone = useRef(false)
  // When the current step really began, for its calendar record
  const stepBegan = useRef(run.stepStartedAt)
  // Switch! slides the content out left and the new step in from the right; when
  // that step is done it slides back the other way
  const { width } = useWindowDimensions()
  const slide = useRef(new Animated.Value(0)).current
  const cameBySwitch = useRef(false)
  const slideTo = (direction: 'left' | 'right', between: () => void) => {
    const out = direction === 'left' ? -width : width
    Animated.timing(slide, { toValue: out, duration: 160, useNativeDriver: true }).start(() => {
      between()
      slide.setValue(-out)
      Animated.spring(slide, { toValue: 0, bounciness: 10, speed: 14, useNativeDriver: true }).start()
    })
  }
  // Leaving a step that came by Switch! slides back to the right
  const leaveStep = (move: () => void) => {
    if (!cameBySwitch.current) return move()
    cameBySwitch.current = false
    slideTo('right', move)
  }
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const state = advanceTimer(run.steps, run.index, run.stepStartedAt, pausedAt ?? now)
  const step = run.steps[state.index]
  const next = run.steps[state.index + 1]

  // Steps whose time ran out (several if the phone was locked) are recorded at
  // their scheduled ends, then the timer moves on
  useEffect(() => {
    if (state.index === run.index) return
    let boundary = run.stepStartedAt
    for (let k = run.index; k < state.index; k++) {
      boundary += (run.steps[k].minutes ?? 0) * 60_000
      onSegment(run.steps[k].name, stepBegan.current, boundary)
      stepBegan.current = boundary
    }
    const { index, stepStartedAt } = state
    leaveStep(() => onChange(index, stepStartedAt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index])

  useEffect(() => {
    if (!markedDone.current && step.afterChores) {
      markedDone.current = true
      onChoresDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, step])

  // The last step running out ends the run, the same as tapping Done
  const finished = useRef(false)
  useEffect(() => {
    if (finished.current || next || state.remainingMs !== 0) return
    finished.current = true
    onSegment(step.name, stepBegan.current, state.stepStartedAt + (step.minutes ?? 0) * 60_000)
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.remainingMs, next])

  // Ends the current step now and records it
  const endCurrent = () => {
    const at = Date.now()
    onSegment(step.name, stepBegan.current, at)
    stepBegan.current = at
  }

  const goNext = () => {
    endCurrent()
    setPausedAt(null)
    if (!next) return onClose()
    const index = state.index + 1
    leaveStep(() => onChange(index, Date.now()))
  }

  const stop = () => {
    endCurrent()
    onClose()
  }

  const togglePause = () => {
    if (pausedAt === null) return setPausedAt(Date.now())
    onChange(state.index, resumeTimer(state.stepStartedAt, pausedAt, Date.now()))
    setPausedAt(null)
  }

  const switchTo = (choice: { step: string } | { oneOff: string }) => {
    endCurrent()
    setPausedAt(null)
    setSwitching(false)
    setOneOff('')
    const index = state.index
    slideTo('left', () => {
      cameBySwitch.current = true
      onSwitch(choice, index)
    })
  }

  return (
    <SafeAreaView style={styles.timerScreen}>
      <Animated.View style={[styles.timerContent, { transform: [{ translateX: slide }] }]}>
        <Text style={styles.timerStep}>{step.name}</Text>
        <Text style={styles.timerClock}>{state.remainingMs === null ? mmss(state.elapsedMs) : mmss(state.remainingMs)}</Text>
        <Text style={styles.timerNext}>{pausedAt !== null ? 'Paused' : next ? `Next: ${next.name}` : 'Last one'}</Text>
        <View style={styles.timerButtons}>
          <View style={styles.timerRow}>
            <Pressable style={[styles.timerStop, styles.timerPause, styles.timerHalf]} onPress={togglePause}>
              {pausedAt === null ? <Pause size={18} color={c.ink} /> : <Play size={18} color={c.ink} />}
              <Text style={styles.timerStopText}>{pausedAt === null ? 'Pause' : 'Resume'}</Text>
            </Pressable>
            <Pressable
              style={[styles.timerStop, styles.timerHalf, step.minutes === null && styles.buttonDisabled]}
              disabled={step.minutes === null}
              onPress={() => onChange(state.index, extendStep(state.stepStartedAt, 1))}
              accessibilityLabel="Add a minute"
            >
              <Text style={[styles.timerStopText, step.minutes === null && styles.buttonDisabledText]}>+1 min</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.submitButton, styles.timerButton]} onPress={goNext}>
            <Text style={styles.doneButtonText}>{next ? 'Next' : 'Done'}</Text>
          </Pressable>
          <Pressable style={[styles.timerButton, styles.timerStop]} onPress={stop}>
            <Text style={styles.timerStopText}>Stop</Text>
          </Pressable>
          <Pressable style={[styles.timerButton, styles.timerStop]} onPress={() => setSwitching(true)}>
            <Text style={styles.timerStopText}>Switch!</Text>
          </Pressable>
        </View>
      </Animated.View>

      <Modal visible={switching} transparent animationType="none" onRequestClose={() => setSwitching(false)}>
        <KeyboardAvoidingView style={styles.screenFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.detailBackdrop} onPress={() => setSwitching(false)}>
            <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.detailTitle}>Switch to</Text>
              {routine.map((r) => (
                <Pressable
                  key={r.name}
                  style={[styles.timerStop, r.name === step.name && styles.segmentItemActive]}
                  onPress={() => switchTo({ step: r.name })}
                >
                  <Text style={[styles.timerStopText, r.name === step.name && styles.segmentTextActive]}>{r.name}</Text>
                </Pressable>
              ))}
              <View style={styles.oneOffRow}>
                <TextInput
                  style={[styles.input, styles.oneOffInput]}
                  value={oneOff}
                  onChangeText={setOneOff}
                  placeholder="Something else, just this once"
                  placeholderTextColor={c.muted}
                  returnKeyType="go"
                  onSubmitEditing={() => oneOff.trim() && switchTo({ oneOff: oneOff.trim() })}
                />
                <Pressable
                  style={[styles.submitButton, styles.oneOffStart, !oneOff.trim() && styles.buttonDisabled]}
                  disabled={!oneOff.trim()}
                  onPress={() => switchTo({ oneOff: oneOff.trim() })}
                >
                  <Text style={[styles.doneButtonText, !oneOff.trim() && styles.buttonDisabledText]}>Start</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const ROW_FALLBACK_PX = 56

function TodoList({
  todos,
  today,
  onMinutes,
  onReorder,
  onDragging,
  onOpen,
}: {
  todos: Todo[]
  today: string
  onMinutes: (todo: Todo, minutes: number) => void
  onReorder: (next: Todo[]) => void
  onDragging: (dragging: boolean) => void
  onOpen: (todo: Todo) => void
}) {
  const [drag, setDrag] = useState<{ id: string; from: number; to: number } | null>(null)
  const dy = useRef(new Animated.Value(0)).current
  const heights = useRef(new Map<string, number>()).current
  const responders = useRef(new Map<string, PanResponderInstance>()).current
  // Responders live across renders, so they read the latest values through refs
  const latest = useRef({ todos, drag, onReorder, onDragging })
  latest.current = { todos, drag, onReorder, onDragging }

  const targetIndex = (from: number, offset: number) => {
    const list = latest.current.todos
    let to = from
    let remaining = offset
    while (remaining > 0 && to < list.length - 1) {
      const h = heights.get(list[to + 1].id) ?? ROW_FALLBACK_PX
      if (remaining < h / 2) break
      remaining -= h
      to++
    }
    while (remaining < 0 && to > 0) {
      const h = heights.get(list[to - 1].id) ?? ROW_FALLBACK_PX
      if (-remaining < h / 2) break
      remaining += h
      to--
    }
    return to
  }

  const finish = () => {
    const { drag: d, todos: list, onReorder: reorder, onDragging: setDragging } = latest.current
    setDrag(null)
    dy.setValue(0)
    setDragging(false)
    if (!d || d.to === d.from) return
    const next = [...list]
    const [moved] = next.splice(d.from, 1)
    next.splice(d.to, 0, moved)
    reorder(next)
  }

  const responderFor = (id: string) => {
    let r = responders.get(id)
    if (!r) {
      r = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const from = latest.current.todos.findIndex((t) => t.id === id)
          dy.setValue(0)
          latest.current.onDragging(true)
          const d = { id, from, to: from }
          latest.current.drag = d
          setDrag(d)
        },
        onPanResponderMove: (_e, g) => {
          dy.setValue(g.dy)
          const d = latest.current.drag
          if (!d) return
          const to = targetIndex(d.from, g.dy)
          if (to !== d.to) {
            const nd = { ...d, to }
            latest.current.drag = nd
            setDrag(nd)
          }
        },
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      })
      responders.set(id, r)
    }
    return r
  }

  const draggedHeight = drag ? heights.get(drag.id) ?? ROW_FALLBACK_PX : 0

  return (
    <>
      {todos.map((t, k) => {
        const isDragged = drag?.id === t.id
        let shift = 0
        if (drag && !isDragged) {
          if (drag.from < drag.to && k > drag.from && k <= drag.to) shift = -draggedHeight
          if (drag.to < drag.from && k >= drag.to && k < drag.from) shift = draggedHeight
        }
        return (
          <Animated.View
            key={t.id}
            onLayout={(e) => heights.set(t.id, e.nativeEvent.layout.height)}
            style={[
              isDragged ? [styles.dragging, { transform: [{ translateY: dy }] }] : { transform: [{ translateY: shift }] },
            ]}
          >
            <TodoRow
              todo={t}
              today={today}
              onMinutes={(m) => onMinutes(t, m)}
              onOpen={() => onOpen(t)}
              handle={responderFor(t.id).panHandlers}
            />
          </Animated.View>
        )
      })}
    </>
  )
}

function TodoRow({
  todo,
  today,
  onMinutes,
  onOpen,
  handle,
}: {
  todo: Todo
  today: string
  onMinutes: (minutes: number) => void
  onOpen: () => void
  handle: PanResponderInstance['panHandlers']
}) {
  const minutes = Math.round((todo.end - todo.start) * 60)
  const options = durationOptions(minutes)

  return (
    <View style={styles.todoRow}>
      {todo.fixed ? (
        // A fixed habit keeps its time, so it has no drag handle
        <View style={[styles.handle, styles.handleSpacer]} />
      ) : (
        <View {...handle} style={styles.handle} hitSlop={8} accessibilityLabel="Drag to reorder">
          <GripVertical size={18} color={c.muted} />
        </View>
      )}
      <Pressable style={{ flex: 1 }} onPress={onOpen}>
        <Text style={styles.todoText}>{todo.title}</Text>
        <Text style={styles.todoMeta}>
          {todo.habit ? 'Habit · ' : ''}
          {todo.day === today ? '' : `${dayLabel(todo.day)} · `}
          {clock(todo.start)}
        </Text>
      </Pressable>
      <View style={styles.durations}>
        {options.map((m) => {
          const selected = m === minutes
          return (
            <Pressable
              key={m}
              style={[styles.duration, selected && styles.durationSelected]}
              onPress={() => !selected && onMinutes(m)}
              accessibilityLabel={`${m} minutes`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.durationText, selected && styles.durationTextSelected]}>{m}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function DayGrid({
  items,
  showNow,
  onMore,
  onOpen,
  onAddAt,
}: {
  items: CalItem[]
  showNow: boolean
  onMore: (item: CalItem, x: number, y: number) => void
  onOpen: (item: CalItem) => void
  // A tap in the strip right of the cards, as an hour rounded to the quarter
  onAddAt: (hour: number) => void
}) {
  const nowHours = logicalNow(new Date()).hours
  const first = showNow ? Math.max(0, Math.floor(nowHours - LOOKBACK_HOURS)) : FIRST_HOUR
  const last = showNow ? Math.min(LAST_HOUR, Math.ceil(nowHours + LOOKAHEAD_HOURS)) : LAST_HOUR
  const hours = useMemo(() => Array.from({ length: last - first }, (_, i) => first + i), [first, last])
  const top = (h: number) => (Math.min(Math.max(h, first), last) - first) * HOUR_PX
  // Routine steps are listed on their parent's card, not drawn on the grid
  const visible = items.filter((it) => !it.processId && it.end > first && it.start < last)

  // Blocks under 30 minutes, and blocks done early, take half the column. A block
  // that a half block's minimum height spills into takes the other half.
  const [gridWidth, setGridWidth] = useState(0)
  const column = Math.max(0, gridWidth - EVENT_LEFT - EVENT_RIGHT)
  const side = halfSides(visible, top, SHORT_MIN_PX)

  return (
    <View
      style={[styles.card, { height: (last - first) * HOUR_PX, padding: 0 }]}
      onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
    >
      {hours.map((h) => (
        <View key={h} style={[styles.hourLine, { top: top(h) }]}>
          <Text style={styles.hourLabel}>{clock(h)}</Text>
        </View>
      ))}
      {visible.map((it) => {
        const half = side.get(it.id)
        const height = Math.max(top(it.end) - top(it.start) - 2, half ? SHORT_MIN_PX : 20)
        // Too short for a second line, so only the title shows
        const compact = height < 34
        const dark = it.doneEarly
        return (
          <Pressable
            key={`${it.kind}-${it.id}`}
            onPress={() => onOpen(it)}
            style={[
              styles.event,
              half
                ? half === 'left'
                  ? { left: EVENT_LEFT, right: EVENT_RIGHT + column / 2 + 2 }
                  : { left: EVENT_LEFT + column / 2 + 2, right: EVENT_RIGHT }
                : null,
              {
                top: top(it.start) + 1,
                height,
                backgroundColor: dark ? c.doneEarly : it.done ? c.blockDone : it.kind === 'block' ? c.block : c.task,
              },
            ]}
          >
            <Text style={[styles.eventText, dark && { color: c.onDark }]} numberOfLines={1}>
              {it.title}
            </Text>
            {compact ? null : (
              <Text style={[styles.eventTime, it.done && styles.eventTimeDone, dark && { color: c.onDarkMuted }]}>
                {clock(it.start)}–{clock(it.end)}
              </Text>
            )}
            <Pressable
              style={[styles.more, compact && styles.moreShort]}
              hitSlop={10}
              onPress={(e) => onMore(it, e.nativeEvent.pageX, e.nativeEvent.pageY)}
            >
              <MoreHorizontal size={compact ? 16 : 18} color={dark ? c.onDark : c.ink} />
            </Pressable>
          </Pressable>
        )
      })}
      <Pressable
        style={styles.addStrip}
        onPress={(e) => onAddAt(quarterOf(first + e.nativeEvent.locationY / HOUR_PX))}
        accessibilityLabel="Add a todo at this time"
      />
      {showNow ? <View pointerEvents="none" style={[styles.nowLine, { top: top(nowHours) }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  screenFill: { flex: 1 },
  hidden: { display: 'none' },
  page: { padding: 12, paddingBottom: 40 },
  signIn: { flex: 1, padding: 16, justifyContent: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  fixedHeader: {
    marginBottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: c.bg,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 22, fontWeight: '600', color: c.ink, textAlign: 'center' },
  subtitle: { fontSize: 14, color: c.muted, textAlign: 'center' },
  card: { backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.line, padding: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  addRowDivider: { borderTopWidth: 1, borderTopColor: c.line },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: c.line,
    backgroundColor: c.card,
    paddingTop: 6,
    paddingBottom: 4,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 12, fontWeight: '600', color: c.muted },
  tabLabelActive: { color: c.accent },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8 },
  todoText: { fontSize: 16, color: c.ink },
  handle: { paddingVertical: 6, paddingRight: 2 },
  handleSpacer: { width: 20 },
  dragging: {
    zIndex: 2,
    backgroundColor: c.card,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  todoMeta: { fontSize: 13, color: c.muted },
  durations: { flexDirection: 'row', gap: 4 },
  duration: {
    minWidth: 36,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.line,
  },
  durationSelected: { backgroundColor: c.accent, borderColor: c.accent },
  durationText: { fontSize: 14, color: c.ink },
  durationTextSelected: { color: '#ffffff', fontWeight: '600' },
  minutesLabel: { fontSize: 14, color: c.muted },
  addInput: { flex: 1, fontSize: 16, color: c.ink, paddingVertical: 10 },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderTopColor: c.line },
  hourLabel: { fontSize: 11, color: c.muted, marginLeft: 6, marginTop: 2 },
  event: { position: 'absolute', left: EVENT_LEFT, right: EVENT_RIGHT, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  eventText: { fontSize: 14, fontWeight: '600', color: c.ink, marginRight: 24 },
  eventTime: { fontSize: 12, color: c.muted },
  // muted gray is 3.98:1 on blockDone; ink is 9.79:1
  eventTimeDone: { color: c.ink },
  more: { position: 'absolute', right: 6, top: 4 },
  moreShort: { top: 1, right: 4 },
  menu: {
    position: 'absolute',
    right: 10,
    zIndex: 10,
    backgroundColor: c.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.line,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  menuItem: { paddingVertical: 10, paddingHorizontal: 14 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historySummary: { fontSize: 16, color: c.ink },
  historyCard: { maxHeight: '80%' },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: c.ink, marginTop: 8, marginBottom: 6 },
  emptySection: { paddingVertical: 8, paddingHorizontal: 8 },
  segment: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  segmentItemActive: { backgroundColor: c.accent },
  segmentText: { fontSize: 14, fontWeight: '600', color: c.ink },
  segmentTextActive: { color: '#ffffff' },
  weekdays: { flexDirection: 'row', gap: 4 },
  weekday: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: c.line },
  historyList: { flexGrow: 0 },
  detailBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 16 },
  detailCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, gap: 8 },
  detailTitle: { fontSize: 20, fontWeight: '600', color: c.ink },
  detailDay: { fontSize: 14, color: c.muted },
  detailTimes: { fontSize: 16, color: c.ink },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sliderLabel: { width: 64, fontSize: 13, fontWeight: '600', color: c.muted },
  slider: { flex: 1 },
  doneRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  doneButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, backgroundColor: c.accent },
  doneButtonText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
  // Disabled: muted gray text on the hairline gray, 5.35:1 (fading the green button
  // to 40% instead left white text at 1.94:1)
  // A full-width button on its own line (doneButton is for sharing a row)
  submitButton: { alignItems: 'center', paddingVertical: 12, borderRadius: 8, backgroundColor: c.accent, marginTop: 4 },
  buttonDisabled: { backgroundColor: c.line },
  buttonDisabledText: { color: c.muted },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  addButtonText: { fontSize: 16, fontWeight: '600', color: c.accent },
  helpGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  helpCard: {
    width: '48%',
    paddingVertical: 18,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.card,
  },
  helpCardText: { fontSize: 16, fontWeight: '600', color: c.ink },
  stepCards: { flexDirection: 'row', gap: 6 },
  stepCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.bg,
  },
  stepCardText: { fontSize: 13, fontWeight: '600', color: c.ink },
  timerScreen: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', padding: 16, overflow: 'hidden' },
  timerContent: { alignItems: 'center', gap: 12 },
  timerStep: { fontSize: 28, fontWeight: '600', color: c.ink },
  timerClock: { fontSize: 72, fontWeight: '300', color: c.ink, fontVariant: ['tabular-nums'] },
  timerNext: { fontSize: 16, color: c.muted },
  timerButtons: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  timerButton: { alignSelf: 'stretch' },
  timerStop: { alignItems: 'center', paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: c.line },
  timerStopText: { fontSize: 16, fontWeight: '600', color: c.ink },
  timerPause: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  timerRow: { flexDirection: 'row', gap: 8 },
  timerHalf: { flex: 1 },
  oneOffRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  oneOffInput: { flex: 1 },
  oneOffStart: { marginTop: 0, paddingHorizontal: 16 },
  parts: { marginTop: 4 },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  menuText: { fontSize: 16, color: c.ink },
  addStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: EVENT_RIGHT,
    borderLeftWidth: 1,
    borderLeftColor: c.line,
  },
  nowLine: { position: 'absolute', left: 46, right: 0, height: 2, backgroundColor: c.now },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 12, fontSize: 16, color: c.ink },
  button: { backgroundColor: c.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  error: { color: c.now, fontSize: 14, marginVertical: 4 },
})
