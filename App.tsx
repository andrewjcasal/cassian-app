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
import { ChevronLeft, ChevronRight, GripVertical, LogOut, Menu as MenuIcon, MoreHorizontal, Plus, Repeat } from 'lucide-react-native'
import { supabase } from './src/supabase'
import {
  type CalItem,
  type Move,
  type Status,
  type Todo,
  clock,
  donePlan,
  durationOptions,
  newBlockStart,
  halfSides,
  hoursOf,
  isDoneEarly,
  menuOptions,
  notStartedPlan,
  placeHabits,
  relayout,
  resizePlan,
  shiftDay,
  startNowPlan,
  timeOf,
  toDayString,
} from './src/schedule'

const HOUR_PX = 48
const FIRST_HOUR = 6
const EVENT_LEFT = 52
const EVENT_RIGHT = 6
// A short block is at least this tall so its title stays readable
const SHORT_MIN_PX = 20
// Today's grid shows this many hours before and after now
const LOOKBACK_HOURS = 3
const LOOKAHEAD_HOURS = 5
const LAST_HOUR = 24

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

function nowHours() {
  const now = new Date()
  return now.getHours() + now.getMinutes() / 60
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

type Tab = 'todos' | 'agenda'
// A todo is a block added from this app, or a placed habit, that isn't done yet, on any day
type Menu = { item: CalItem; x: number; y: number }

function DayPage() {
  const today = toDayString(new Date())
  const [day, setDay] = useState(today)
  const [tab, setTab] = useState<Tab>('agenda')
  const [items, setItems] = useState<CalItem[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [dragging, setDragging] = useState(false)
  const [navMenu, setNavMenu] = useState<{ x: number; y: number } | null>(null)
  const [view, setView] = useState<'day' | 'habits'>('day')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { width } = useWindowDimensions()

  const fetchItems = useCallback(async () => {
    const [blockRes, taskRes] = await Promise.all([
      supabase.from('cass_time_blocks').select('id,title,start_time,end_time,done,habit_id,source,done_at').eq('day', day).order('start_time'),
      supabase.from('cass_tasks').select('id,title,start_time,end_time,done').eq('day', day).not('start_time', 'is', null),
    ])
    const err = blockRes.error ?? taskRes.error
    if (err) setError(err.message)
    const blocks: CalItem[] = (blockRes.data ?? []).map((b) => {
      const start = hoursOf(b.start_time)
      const end = b.end_time ? hoursOf(b.end_time) : start + 0.5
      const doneEarly = isDoneEarly(b.done, b.done_at, day, start)
      return { id: b.id, title: b.title, start, end, kind: 'block', done: b.done, habitId: b.habit_id, source: b.source, doneEarly }
    })
    const tasks: CalItem[] = (taskRes.data ?? []).map((t) => {
      const start = hoursOf(t.start_time!)
      return { id: t.id, title: t.title, start, end: t.end_time ? hoursOf(t.end_time) : start + 0.5, kind: 'task', done: t.done }
    })
    return [...blocks, ...tasks].sort((a, b) => a.start - b.start)
  }, [day])

  // Today, every habit without a block yet goes into the first gap that fits it.
  // The (habit_id, day) unique index keeps a racing load from placing one twice.
  const placeHabitBlocks = useCallback(
    async (current: CalItem[]) => {
      const { data: habits, error } = await supabase.from('cass_habits').select('id,title,minutes').order('sort_order')
      if (error) return setError(error.message), false
      const placements = placeHabits(current, habits ?? [], nowHours())
      for (const p of placements) {
        const { error: insertError } = await supabase.from('cass_time_blocks').upsert(
          {
            day,
            title: p.title,
            start_time: timeOf(p.start),
            end_time: timeOf(p.end),
            kind: 'personal',
            source: 'habit',
            habit_id: p.habitId,
          },
          { onConflict: 'habit_id,day', ignoreDuplicates: true },
        )
        if (insertError) return setError(insertError.message), true
      }
      return placements.length > 0
    },
    [day],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const todoRes = await supabase
      .from('cass_time_blocks')
      .select('id,title,day,start_time,end_time,habit_id')
      .in('source', ['app', 'habit'])
      .eq('done', false)
      .order('day')
      .order('start_time')
    if (todoRes.error) setError(todoRes.error.message)
    let current = await fetchItems()
    if (day === today && (await placeHabitBlocks(current))) current = await fetchItems()
    setItems(current)
    setTodos(
      (todoRes.data ?? []).map((t) => {
        const start = hoursOf(t.start_time)
        return { id: t.id, title: t.title, day: t.day, start, end: t.end_time ? hoursOf(t.end_time) : start + 1, habit: !!t.habit_id }
      }),
    )
    setLoading(false)
  }, [day, today, fetchItems, placeHabitBlocks])

  useEffect(() => {
    load()
  }, [load])

  // Saves new times for every moved block, then reloads
  const saveMoves = async (moves: Move[]) => {
    const results = await Promise.all(
      moves.map((m) =>
        supabase
          .from(m.kind === 'block' ? 'cass_time_blocks' : 'cass_tasks')
          .update({ start_time: timeOf(m.start), end_time: timeOf(m.end) })
          .eq('id', m.id),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    load()
  }

  // New todos and follow-ups fill the first gap that fits
  const insertBlock = async (title: string, length: number, label: string) => {
    const start = newBlockStart(items, length, day === today, nowHours())
    if (start === null) return setError(`No room left today for ${label}`)
    const { error } = await supabase
      .from('cass_time_blocks')
      .insert({ day, title, start_time: timeOf(start), end_time: timeOf(start + length), kind: 'personal', source: 'app' })
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
      if (plan.endAt !== null) update.end_time = timeOf(plan.endAt)
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

  const setMinutes = async (todo: Todo, minutes: number) => {
    const plan = resizePlan(todos, todo, minutes)
    if ('error' in plan) return setError(plan.error)
    if (plan.moves.length) saveMoves(plan.moves)
  }

  if (view === 'habits') return <HabitsScreen onBack={() => setView('day')} />

  // Dragging a todo to a new spot re-packs the swapped range back to back from
  // where its first todo started, each keeping its own length.
  const reorder = async (next: Todo[]) => {
    const updates = relayout(todos, next)
    if (!updates.length) return
    const moved = new Map(updates.map((u) => [u.id, u]))
    setTodos(next.map((t) => ({ ...t, ...(moved.get(t.id) ?? {}) })))
    const results = await Promise.all(
      updates.map((u) =>
        supabase.from('cass_time_blocks').update({ start_time: timeOf(u.start), end_time: timeOf(u.end) }).eq('id', u.id),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    load()
  }

  return (
    <View style={styles.screen}>
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
            <Pressable
              onPress={(e) => setNavMenu({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
              hitSlop={10}
              accessibilityLabel="Menu"
            >
              <MenuIcon size={20} color={c.ink} />
            </Pressable>
          </View>
        </View>

        <View style={styles.tabs}>
          {(
            [
              ['todos', 'Todos'],
              ['agenda', 'Agenda'],
            ] as const
          ).map(([key, label]) => (
            <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {tab === 'todos' ? (
          <View style={styles.card}>
            <TodoList todos={todos} today={today} onMinutes={setMinutes} onReorder={reorder} onDragging={setDragging} />
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
          <DayGrid items={items} showNow={day === today} onMore={(item, x, y) => setMenu({ item, x, y })} />
        )}

      </ScrollView>

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

      <Modal visible={navMenu !== null} transparent animationType="none" onRequestClose={() => setNavMenu(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setNavMenu(null)}>
          {navMenu ? (
            <View style={[styles.menu, { top: navMenu.y + 12, right: Math.max(8, width - navMenu.x - 12) }]}>
              <Pressable
                style={[styles.menuItem, styles.menuRow]}
                onPress={() => {
                  setNavMenu(null)
                  setView('habits')
                }}
              >
                <Repeat size={16} color={c.ink} />
                <Text style={styles.menuText}>Habits</Text>
              </Pressable>
              <Pressable
                style={[styles.menuItem, styles.menuRow]}
                onPress={() => {
                  setNavMenu(null)
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

function HabitsScreen({ onBack }: { onBack: () => void }) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [error, setError] = useState<string | null>(null)

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
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back">
          <ChevronLeft size={22} color={c.ink} />
        </Pressable>
        <Text style={styles.title}>Habits</Text>
        <View style={{ width: 22 }} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.card}>
        {habits.map((h) => (
          <View key={h.id} style={styles.todoRow}>
            <Text style={[styles.todoText, { flex: 1 }]}>{h.title}</Text>
            <Text style={styles.minutesLabel}>{h.minutes} min</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const ROW_FALLBACK_PX = 56

function TodoList({
  todos,
  today,
  onMinutes,
  onReorder,
  onDragging,
}: {
  todos: Todo[]
  today: string
  onMinutes: (todo: Todo, minutes: number) => void
  onReorder: (next: Todo[]) => void
  onDragging: (dragging: boolean) => void
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
  handle,
}: {
  todo: Todo
  today: string
  onMinutes: (minutes: number) => void
  handle: PanResponderInstance['panHandlers']
}) {
  const minutes = Math.round((todo.end - todo.start) * 60)
  const options = durationOptions(minutes)

  return (
    <View style={styles.todoRow}>
      <View {...handle} style={styles.handle} hitSlop={8} accessibilityLabel="Drag to reorder">
        <GripVertical size={18} color={c.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.todoText}>{todo.title}</Text>
        <Text style={styles.todoMeta}>
          {todo.habit ? 'Habit · ' : ''}
          {todo.day === today ? '' : `${dayLabel(todo.day)} · `}
          {clock(todo.start)}
        </Text>
      </View>
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
}: {
  items: CalItem[]
  showNow: boolean
  onMore: (item: CalItem, x: number, y: number) => void
}) {
  const now = new Date()
  const nowHours = now.getHours() + now.getMinutes() / 60
  const first = showNow ? Math.max(0, Math.floor(nowHours - LOOKBACK_HOURS)) : FIRST_HOUR
  const last = showNow ? Math.min(24, Math.ceil(nowHours + LOOKAHEAD_HOURS)) : LAST_HOUR
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
          <View
            key={`${it.kind}-${it.id}`}
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
          </View>
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
  tabs: { flexDirection: 'row', gap: 4, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: c.line },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive: { borderBottomColor: c.accent },
  tabText: { fontSize: 16, color: c.muted },
  tabTextActive: { color: c.ink, fontWeight: '600' },
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
  menuText: { fontSize: 16, color: c.ink },
  nowLine: { position: 'absolute', left: 46, right: 0, height: 2, backgroundColor: c.now },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 12, fontSize: 16, color: c.ink },
  button: { backgroundColor: c.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  error: { color: c.now, fontSize: 14, marginVertical: 4 },
})
