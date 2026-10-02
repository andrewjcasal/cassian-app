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
  Clock,
  GripVertical,
  ListTodo,
  LogOut,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Repeat,
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
  logicalNow,
  toStored,
  isDoneEarly,
  menuOptions,
  moveStartPlan,
  moveTodoStartPlan,
  notStartedPlan,
  habitHistory,
  habitSearchFrom,
  placeHabits,
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
const EVENT_RIGHT = 6
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

type Tab = 'todos' | 'agenda' | 'habits' | 'planning'
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
}

function DayPage() {
  const today = logicalNow(new Date()).day
  const [day, setDay] = useState(today)
  const [tab, setTab] = useState<Tab>('agenda')
  // Blocks are kept with the day they were loaded for, so switching days shows an
  // empty grid until the new day arrives, never the previous day's blocks
  const [loaded, setLoaded] = useState<{ day: string; items: CalItem[] }>({ day: '', items: [] })
  const items = loaded.day === day ? loaded.items : []
  // Only the latest load may write, so a slow response for a day you've already
  // left can't land on top of the one you're looking at
  const latestLoad = useRef(0)
  // Todos are kept with the day they were loaded for, like blocks
  const [todosFor, setTodosFor] = useState<{ day: string; list: Todo[] }>({ day: '', list: [] })
  const todos = todosFor.day === day ? todosFor.list : []
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [dragging, setDragging] = useState(false)
  // Where the settings icon was tapped, so its menu opens beside it
  const [settingsMenu, setSettingsMenu] = useState<{ x: number; y: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { width } = useWindowDimensions()

  const fetchItems = useCallback(async () => {
    // The day runs 6am to 6am: this date from 6am on, plus the next date before 6am
    const next = shiftDay(day, 1)
    const morning = timeOf(DAY_START)
    const blockCols = 'id,title,day,start_time,end_time,done,habit_id,source,done_at'
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
      return { id: b.id, title: b.title, start, end, kind: 'block', done: b.done, habitId: b.habit_id, source: b.source, doneEarly }
    })
    const tasks: CalItem[] = [...(taskRes.data ?? []), ...(lateTaskRes.data ?? [])].map((t) => {
      const { start, end } = fromStored(t.day, t.start_time!, t.end_time)
      return { id: t.id, title: t.title, start, end, kind: 'task', done: t.done }
    })
    return [...blocks, ...tasks].sort((a, b) => a.start - b.start)
  }, [day])

  // Today, every habit without a block yet goes into the first gap that fits it.
  // The (habit_id, logical_day) unique index keeps a racing load from placing one
  // twice; logical_day is the 6am to 6am day, so a habit after midnight still counts
  // for the night before.
  const placeHabitBlocks = useCallback(
    async (current: CalItem[]) => {
      const { data: habits, error } = await supabase.from('cass_habits').select('id,title,minutes').order('sort_order')
      if (error) return setError(error.message), false
      const from = habitSearchFrom(day, today, nowHours())
      if (from === null) return false
      const placements = placeHabits(current, habits ?? [], from)
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
    [day, today],
  )

  const load = useCallback(async () => {
    const run = ++latestLoad.current
    setLoading(true)
    setError(null)
    let current = await fetchItems()
    if (run !== latestLoad.current) return
    if (day >= today && (await placeHabitBlocks(current))) current = await fetchItems()
    if (run !== latestLoad.current) return
    // After habits are placed, so a day's first visit lists them
    const todoRes = await supabase
      .from('cass_time_blocks')
      .select('id,title,day,start_time,end_time,habit_id')
      .in('source', ['app', 'habit'])
      .eq('done', false)
      .order('day')
      .order('start_time')
    if (todoRes.error) setError(todoRes.error.message)
    if (run !== latestLoad.current) return
    setLoaded({ day, items: current })
    setTodosFor({
      day,
      // Only the day being shown, by its 6am to 6am day
      list: (todoRes.data ?? [])
        .map((t) => {
          const { day: logicalDay, start, end } = fromStored(t.day, t.start_time, t.end_time)
          return { id: t.id, title: t.title, day: logicalDay, start, end, habit: !!t.habit_id }
        })
        .filter((t) => t.day === day),
    })
    setLoading(false)
  }, [day, today, fetchItems, placeHabitBlocks])

  useEffect(() => {
    load()
  }, [load])

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

  // Dragging a todo to a new spot re-packs the swapped range back to back from
  // where its first todo started, each keeping its own length.
  const reorder = async (next: Todo[]) => {
    const updates = relayout(todos, next)
    if (!updates.length) return
    const moved = new Map(updates.map((u) => [u.id, u]))
    setTodosFor({ day, list: next.map((t) => ({ ...t, ...(moved.get(t.id) ?? {}) })) })
    const dayById = new Map(todos.map((t) => [t.id, t.day]))
    await saveMoves(
      updates.map((u) => ({ ...u, kind: 'block' as const })),
      (id) => dayById.get(id) ?? day,
    )
  }

  return (
    <View style={styles.screen}>
      {tab === 'habits' ? (
        <HabitsScreen today={today} onSettings={setSettingsMenu} />
      ) : tab === 'planning' ? (
        <PlanningScreen onSettings={setSettingsMenu} />
      ) : (
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <View style={styles.header}>
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tab === 'todos' ? (
          <View style={styles.card}>
            <TodoList todos={todos} today={today} onMinutes={setMinutes} onReorder={reorder} onDragging={setDragging} onOpen={(t) => setDetail({ id: t.id, from: 'todo', title: t.title, day: t.day, start: t.start, end: t.end, done: false })} />
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
            onOpen={(item) => setDetail({ id: item.id, from: 'item', title: item.title, day, start: item.start, end: item.end, done: item.done })}
          />
        )}

      </ScrollView>
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

      <Modal visible={detail !== null} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.detailBackdrop} onPress={() => setDetail(null)}>
          {detail ? (
            <DetailCard
              detail={detail}
              today={today}
              onResize={resizeDetail}
              onMove={moveDetail}
              onDoneNow={doneNow}
              onDoneAtEnd={doneAtScheduledEnd}
            />
          ) : null}
        </Pressable>
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

type Habit = { id: string; title: string; minutes: number }

const TABS = [
  { key: 'todos', label: 'Todos', Icon: ListTodo },
  { key: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { key: 'habits', label: 'Habits', Icon: Repeat },
  { key: 'planning', label: 'Planning', Icon: NotebookPen },
] as const

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
function ScreenHeader({ title, onSettings }: { title: string; onSettings: (at: { x: number; y: number }) => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <SettingsButton onOpen={onSettings} />
    </View>
  )
}

// Planning is a blank screen for now
function PlanningScreen({ onSettings }: { onSettings: (at: { x: number; y: number }) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="Planning" onSettings={onSettings} />
    </ScrollView>
  )
}

function HabitsScreen({
  today,
  onSettings,
}: {
  today: string
  onSettings: (at: { x: number; y: number }) => void
}) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Habit | null>(null)

  useEffect(() => {
    supabase
      .from('cass_habits')
      .select('id,title,minutes')
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        setHabits(data ?? [])
      })
  }, [])

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="Habits" onSettings={onSettings} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.card}>
        {habits.map((h) => (
          <Pressable key={h.id} style={styles.todoRow} onPress={() => setSelected(h)}>
            <Text style={[styles.todoText, { flex: 1 }]}>{h.title}</Text>
            <Text style={styles.minutesLabel}>{h.minutes} min</Text>
            <ChevronRight size={18} color={c.muted} />
          </Pressable>
        ))}
      </View>

      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.detailBackdrop} onPress={() => setSelected(null)}>
          {selected ? <HabitHistory habit={selected} today={today} /> : null}
        </Pressable>
      </Modal>
    </ScrollView>
  )
}

// Each day's done or not done for one habit (habitHistory in src/schedule.ts)
function HabitHistory({ habit, today }: { habit: Habit; today: string }) {
  const [rows, setRows] = useState<ReturnType<typeof habitHistory> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('cass_time_blocks')
      .select('logical_day,done')
      .eq('habit_id', habit.id)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        setRows(habitHistory(data ?? [], today))
      })
  }, [habit.id, today])

  const past = (rows ?? []).filter((r) => r.status !== 'pending')
  const doneCount = past.filter((r) => r.status === 'done').length

  return (
    // Swallows taps so only the backdrop closes the card
    <Pressable style={[styles.detailCard, styles.historyCard]} onPress={() => {}}>
      <Text style={styles.detailTitle}>{habit.title}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rows && rows.length ? (
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
                  {r.status === 'done' ? 'Done' : r.status === 'pending' ? 'Not done yet' : 'Not done'}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      ) : rows ? (
        <Text style={styles.historySummary}>No days yet</Text>
      ) : null}
    </Pressable>
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
}: {
  detail: Detail
  today: string
  onResize: (detail: Detail, minutes: number) => void
  onMove: (detail: Detail, start: number) => void
  onDoneNow: (detail: Detail) => void
  onDoneAtEnd: (detail: Detail) => void
}) {
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
    // Swallows taps so only the backdrop closes the card
    <Pressable style={styles.detailCard} onPress={() => {}}>
      <Text style={styles.detailTitle}>{detail.title}</Text>
      {detail.day === today ? null : <Text style={styles.detailDay}>{dayLabel(detail.day)}</Text>}
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
          onSlidingComplete={() => {
            if (startMin !== savedStart) onMove(detail, startMin / 60)
            else setOffset(0)
          }}
          accessibilityLabel="Move the start time earlier or later"
        />
      </View>

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
    </Pressable>
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
      <View {...handle} style={styles.handle} hitSlop={8} accessibilityLabel="Drag to reorder">
        <GripVertical size={18} color={c.muted} />
      </View>
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
}: {
  items: CalItem[]
  showNow: boolean
  onMore: (item: CalItem, x: number, y: number) => void
  onOpen: (item: CalItem) => void
}) {
  const nowHours = logicalNow(new Date()).hours
  const first = showNow ? Math.max(0, Math.floor(nowHours - LOOKBACK_HOURS)) : FIRST_HOUR
  const last = showNow ? Math.min(LAST_HOUR, Math.ceil(nowHours + LOOKAHEAD_HOURS)) : LAST_HOUR
  const hours = useMemo(() => Array.from({ length: last - first }, (_, i) => first + i), [first, last])
  const top = (h: number) => (Math.min(Math.max(h, first), last) - first) * HOUR_PX
  const visible = items.filter((it) => it.end > first && it.start < last)

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
      {showNow ? <View style={[styles.nowLine, { top: top(nowHours) }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { padding: 12, paddingBottom: 40 },
  signIn: { flex: 1, padding: 16, justifyContent: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
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
  menuText: { fontSize: 16, color: c.ink },
  nowLine: { position: 'absolute', left: 46, right: 0, height: 2, backgroundColor: c.now },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 12, fontSize: 16, color: c.ink },
  button: { backgroundColor: c.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  error: { color: c.now, fontSize: 14, marginVertical: 4 },
})
