import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
import { ChevronLeft, ChevronRight, LogOut, MoreHorizontal, Plus } from 'lucide-react-native'
import { supabase } from './src/supabase'

type CalItem = { id: string; title: string; start: number; end: number; kind: 'block' | 'task'; done: boolean }
type Status = 'done' | 'not_started' | 'follow_up'

const HOUR_PX = 48
const FIRST_HOUR = 6
// Today's grid starts this many hours before now
const LOOKBACK_HOURS = 2
const LAST_HOUR = 24
// New items fill one-hour blocks, starting here or after the day's last block
const FILL_FROM_HOUR = 15

const c = {
  bg: '#fafaf7',
  card: '#ffffff',
  ink: '#1c1c1a',
  muted: '#5a5a55',
  line: '#e4e2dc',
  accent: '#2f5d50',
  block: '#e6efe9',
  blockDone: '#4ade80',
  task: '#efe9df',
  now: '#c0392b',
}

function toDayString(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shiftDay(day: string, by: number) {
  const [y, m, d] = day.split('-').map(Number)
  return toDayString(new Date(y, m - 1, d + by))
}

function dayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

// "13:30:00" -> 13.5
function hoursOf(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h + m / 60
}

// 15.5 -> "15:30:00"
function timeOf(hours: number) {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

function clock(hours: number) {
  const h = Math.floor(hours) % 24
  const m = Math.round((hours - Math.floor(hours)) * 60)
  const suffix = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
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
// A todo is a block added from this app that isn't done yet, on any day
type Todo = { id: string; title: string; day: string; start: number; end: number }
type Menu = { item: CalItem; x: number; y: number }

function DayPage() {
  const today = toDayString(new Date())
  const [day, setDay] = useState(today)
  const [tab, setTab] = useState<Tab>('agenda')
  const [items, setItems] = useState<CalItem[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { width } = useWindowDimensions()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [blockRes, taskRes, todoRes] = await Promise.all([
      supabase.from('cass_time_blocks').select('id,title,start_time,end_time,done').eq('day', day).order('start_time'),
      supabase.from('cass_tasks').select('id,title,start_time,end_time,done').eq('day', day).not('start_time', 'is', null),
      supabase
        .from('cass_time_blocks')
        .select('id,title,day,start_time,end_time')
        .eq('source', 'app')
        .eq('done', false)
        .order('day')
        .order('start_time'),
    ])
    const err = blockRes.error ?? taskRes.error ?? todoRes.error
    if (err) setError(err.message)
    const blocks: CalItem[] = (blockRes.data ?? []).map((b) => {
      const start = hoursOf(b.start_time)
      return { id: b.id, title: b.title, start, end: b.end_time ? hoursOf(b.end_time) : start + 0.5, kind: 'block', done: b.done }
    })
    const tasks: CalItem[] = (taskRes.data ?? []).map((t) => {
      const start = hoursOf(t.start_time!)
      return { id: t.id, title: t.title, start, end: t.end_time ? hoursOf(t.end_time) : start + 0.5, kind: 'task', done: t.done }
    })
    setItems([...blocks, ...tasks].sort((a, b) => a.start - b.start))
    setTodos(
      (todoRes.data ?? []).map((t) => {
        const start = hoursOf(t.start_time)
        return { id: t.id, title: t.title, day: t.day, start, end: t.end_time ? hoursOf(t.end_time) : start + 1 }
      }),
    )
    setLoading(false)
  }, [day])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    const start = Math.max(FILL_FROM_HOUR, ...items.map((it) => it.end))
    if (start + 1 > 24) return setError('No room left today after the last block')
    const { error } = await supabase
      .from('cass_time_blocks')
      .insert({ day, title, start_time: timeOf(start), end_time: timeOf(start + 1), kind: 'personal', source: 'app' })
    if (error) return setError(error.message)
    load()
  }

  // Done turns the block green. Not started moves it, same length, to start when the
  // day's last other block ends (or at the next quarter hour, if that's already past).
  // Follow-up adds a 30 minute block after the day's last block.
  const setStatus = async (item: CalItem, status: Status) => {
    const table = item.kind === 'block' ? 'cass_time_blocks' : 'cass_tasks'
    if (status === 'follow_up') {
      const start = Math.max(FILL_FROM_HOUR, ...items.map((it) => it.end))
      if (start + 0.5 > 24) return setError('No room left today for a follow-up')
      const { error } = await supabase.from('cass_time_blocks').insert({
        day,
        title: `Follow up: ${item.title}`,
        start_time: timeOf(start),
        end_time: timeOf(start + 0.5),
        kind: 'personal',
        source: 'app',
      })
      if (error) return setError(error.message)
      return load()
    }
    if (status === 'done') {
      const { error } = await supabase.from(table).update({ done: true }).eq('id', item.id)
      if (error) return setError(error.message)
      return load()
    }
    const length = item.end - item.start
    const now = new Date()
    const nextQuarter = Math.ceil((now.getHours() + now.getMinutes() / 60) * 4) / 4
    const lastEnd = Math.max(item.start, ...items.filter((it) => it.id !== item.id).map((it) => it.end))
    const start = day === today ? Math.max(lastEnd, nextQuarter) : lastEnd
    if (start + length > 24) return setError('No room left today to move that block')
    const { error } = await supabase
      .from(table)
      .update({ done: false, start_time: timeOf(start), end_time: timeOf(start + length) })
      .eq('id', item.id)
    if (error) return setError(error.message)
    load()
  }

  // A new length moves this todo's end, and the same day's later todos shift by the
  // same amount so the chain stays back to back.
  const setMinutes = async (todo: Todo, minutes: number) => {
    const delta = todo.start + minutes / 60 - todo.end
    if (!delta) return
    const later = todos.filter((t) => t.day === todo.day && t.id !== todo.id && t.start >= todo.end - 1e-6)
    if (Math.max(todo.end, ...later.map((t) => t.end)) + delta > 24) return setError('That runs past midnight')
    const updates = [
      { id: todo.id, start: todo.start, end: todo.end + delta },
      ...later.map((t) => ({ id: t.id, start: t.start + delta, end: t.end + delta })),
    ]
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
          <Pressable onPress={() => setDay(shiftDay(day, 1))} hitSlop={10}>
            <ChevronRight size={22} color={c.ink} />
          </Pressable>
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
            {todos.map((t) => (
              <TodoRow key={t.id} todo={t} today={today} onMinutes={(m) => setMinutes(t, m)} />
            ))}
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

        <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <LogOut size={14} color={c.muted} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={menu !== null} transparent animationType="none" onRequestClose={() => setMenu(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)}>
          {menu ? (
            <View style={[styles.menu, { top: menu.y + 12, right: Math.max(8, width - menu.x - 12) }]}>
              {(
                [
                  ['done', 'Done'],
                  ['not_started', 'Not started'],
                  ['follow_up', 'Add follow-up'],
                ] as const
              ).map(([status, label]) => (
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
    </View>
  )
}

function TodoRow({ todo, today, onMinutes }: { todo: Todo; today: string; onMinutes: (minutes: number) => void }) {
  const minutes = Math.round((todo.end - todo.start) * 60)
  const [value, setValue] = useState(String(minutes))
  useEffect(() => setValue(String(minutes)), [minutes])

  const commit = () => {
    const next = parseInt(value, 10)
    if (!next || next <= 0) return setValue(String(minutes))
    if (next !== minutes) onMinutes(next)
  }

  return (
    <View style={styles.todoRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.todoText}>{todo.title}</Text>
        <Text style={styles.todoMeta}>
          {todo.day === today ? '' : `${dayLabel(todo.day)} · `}
          {clock(todo.start)}
        </Text>
      </View>
      <TextInput
        style={styles.minutesInput}
        value={value}
        onChangeText={setValue}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
      />
      <Text style={styles.minutesLabel}>min</Text>
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
  const first = showNow ? Math.max(0, Math.floor(nowHours) - LOOKBACK_HOURS) : FIRST_HOUR
  const hours = useMemo(() => Array.from({ length: LAST_HOUR - first }, (_, i) => first + i), [first])
  const top = (h: number) => (Math.max(h, first) - first) * HOUR_PX
  const visible = items.filter((it) => it.end > first)

  return (
    <View style={[styles.card, { height: (LAST_HOUR - first) * HOUR_PX, padding: 0 }]}>
      {hours.map((h) => (
        <View key={h} style={[styles.hourLine, { top: top(h) }]}>
          <Text style={styles.hourLabel}>{clock(h)}</Text>
        </View>
      ))}
      {visible.map((it) => (
        <View
          key={`${it.kind}-${it.id}`}
          style={[
            styles.event,
            {
              top: top(it.start) + 1,
              height: Math.max(top(it.end) - top(it.start) - 2, 20),
              backgroundColor: it.done ? c.blockDone : it.kind === 'block' ? c.block : c.task,
            },
          ]}
        >
          <Text style={styles.eventText} numberOfLines={1}>
            {it.title}
          </Text>
          <Text style={[styles.eventTime, it.done && styles.eventTimeDone]}>
            {clock(it.start)}–{clock(it.end)}
          </Text>
          <Pressable style={styles.more} hitSlop={10} onPress={(e) => onMore(it, e.nativeEvent.pageX, e.nativeEvent.pageY)}>
            <MoreHorizontal size={18} color={c.ink} />
          </Pressable>
        </View>
      ))}
      {showNow ? <View style={[styles.nowLine, { top: top(nowHours) }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { padding: 12, paddingBottom: 40 },
  signIn: { flex: 1, padding: 16, justifyContent: 'center', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
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
  todoMeta: { fontSize: 13, color: c.muted },
  minutesInput: {
    width: 56,
    fontSize: 16,
    color: c.ink,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  minutesLabel: { fontSize: 14, color: c.muted },
  addInput: { flex: 1, fontSize: 16, color: c.ink, paddingVertical: 10 },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderTopColor: c.line },
  hourLabel: { fontSize: 11, color: c.muted, marginLeft: 6, marginTop: 2 },
  event: { position: 'absolute', left: 52, right: 6, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  eventText: { fontSize: 14, fontWeight: '600', color: c.ink, marginRight: 24 },
  eventTime: { fontSize: 12, color: c.muted },
  // muted gray is 3.98:1 on blockDone; ink is 9.79:1
  eventTimeDone: { color: c.ink },
  more: { position: 'absolute', right: 6, top: 4 },
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
  menuText: { fontSize: 16, color: c.ink },
  nowLine: { position: 'absolute', left: 46, right: 0, height: 2, backgroundColor: c.now },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 12, fontSize: 16, color: c.ink },
  button: { backgroundColor: c.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  error: { color: c.now, fontSize: 14, marginVertical: 4 },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  signOutText: { fontSize: 13, color: c.muted },
})
