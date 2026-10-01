import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import type { Session } from '@supabase/supabase-js'
import { ChevronLeft, ChevronRight, LogOut, Plus } from 'lucide-react-native'
import { supabase } from './src/supabase'

type CalItem = { id: string; title: string; start: number; end: number; kind: 'block' | 'task'; done: boolean }

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

function DayPage() {
  const today = toDayString(new Date())
  const [day, setDay] = useState(today)
  const [items, setItems] = useState<CalItem[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [blockRes, taskRes] = await Promise.all([
      supabase.from('cass_time_blocks').select('id,title,start_time,end_time').eq('day', day).order('start_time'),
      supabase.from('cass_tasks').select('id,title,start_time,end_time,done').eq('day', day).not('start_time', 'is', null),
    ])
    const err = blockRes.error ?? taskRes.error
    if (err) setError(err.message)
    const blocks: CalItem[] = (blockRes.data ?? []).map((b) => {
      const start = hoursOf(b.start_time)
      return { id: b.id, title: b.title, start, end: b.end_time ? hoursOf(b.end_time) : start + 0.5, kind: 'block', done: false }
    })
    const tasks: CalItem[] = (taskRes.data ?? []).map((t) => {
      const start = hoursOf(t.start_time!)
      return { id: t.id, title: t.title, start, end: t.end_time ? hoursOf(t.end_time) : start + 0.5, kind: 'task', done: t.done }
    })
    setItems([...blocks, ...tasks].sort((a, b) => a.start - b.start))
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

  return (
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.card, styles.addRow]}>
        <TextInput
          style={styles.addInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add an hour block"
          placeholderTextColor={c.muted}
          returnKeyType="done"
          onSubmitEditing={add}
        />
        <Pressable onPress={add} hitSlop={8}>
          <Plus size={20} color={c.accent} />
        </Pressable>
      </View>

      <DayGrid items={items} showNow={day === today} />

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <LogOut size={14} color={c.muted} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  )
}

function DayGrid({ items, showNow }: { items: CalItem[]; showNow: boolean }) {
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
              backgroundColor: it.kind === 'block' ? c.block : c.task,
            },
          ]}
        >
          <Text style={[styles.eventText, it.done && styles.done]} numberOfLines={1}>
            {it.title}
          </Text>
          <Text style={styles.eventTime}>
            {clock(it.start)}–{clock(it.end)}
          </Text>
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
  done: { color: c.muted, textDecorationLine: 'line-through' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 10 },
  addInput: { flex: 1, fontSize: 16, color: c.ink, paddingVertical: 10 },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderTopColor: c.line },
  hourLabel: { fontSize: 11, color: c.muted, marginLeft: 6, marginTop: 2 },
  event: { position: 'absolute', left: 52, right: 6, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  eventText: { fontSize: 14, fontWeight: '600', color: c.ink },
  eventTime: { fontSize: 12, color: c.muted },
  nowLine: { position: 'absolute', left: 46, right: 0, height: 2, backgroundColor: c.now },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 12, fontSize: 16, color: c.ink },
  button: { backgroundColor: c.accent, borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  error: { color: c.now, fontSize: 14, marginVertical: 4 },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  signOutText: { fontSize: 13, color: c.muted },
})
