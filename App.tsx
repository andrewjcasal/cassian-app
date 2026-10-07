import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Image,
  Linking,
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
  Switch,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import type { Session } from '@supabase/supabase-js'
import {
  Archive,
  CalendarDays,
  Camera,
  Check,
  Circle,
  CircleCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  Clock,
  GripVertical,
  ImagePlus,
  ListTodo,
  Moon,
  Info,
  Layers,
  LogOut,
  MoreHorizontal,
  MoreVertical,
  Repeat,
  ExternalLink,
  Trash2,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Settings,
  X,
} from 'lucide-react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import Slider from '@react-native-community/slider'
import { supabase } from './src/supabase'
import type { CassianDayProps } from './widgets/CassianDay'
import type { ImagePickerOptions } from 'expo-image-picker'

// The camera and photo picker need the development build that includes
// expo-image-picker; until it's installed the Todo Lists page says so.
let imagePicker: typeof import('expo-image-picker') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  imagePicker = require('expo-image-picker')
} catch {
  imagePicker = null
}

// The home screen widget only exists in the development build; Expo Go has no
// widget native code, so it's loaded only if it's there.
let cassianWidget: { updateSnapshot: (props: CassianDayProps) => void } | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cassianWidget = require('./widgets/CassianDay').default
} catch {
  cassianWidget = null
}
import {
  type CalItem,
  type Move,
  type Status,
  type Todo,
  clock,
  doneAtEnd,
  donePlan,
  doneNowPlan,
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
  dateAt,
  dayChoice,
  groupByDay,
  nightBefore,
  habitHistory,
  resumeTimer,
  routineFrom,
  habitStartHours,
  habitStartValue,
  startTimeOptions,
  swipeDays,
  switchRoutine,
  type RoutineStep,
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
  shiftDay,
  startNowPlan,
  timeOf,
  toDayString,
} from './src/schedule'

const HOUR_PX = 80
const FIRST_HOUR = 6
const EVENT_LEFT = 52
// Cards stop this far from the right; tapping that strip adds a todo at that time
const EVENT_RIGHT = 30
// The Todos tab lists this many before "View all"
const TODO_PREVIEW = 5
// A short block is at least this tall so its title stays readable
const SHORT_MIN_PX = 20
// Today opens scrolled to this many hours before now (the grid still runs 6am to 2am)
const LOOKBACK_HOURS = 3
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
  // Burgundy, the accent green's complement: a todo's theme
  theme: '#7a2e3b',
  themeTint: '#f6e9ec',
  blockDone: '#4ade80',
  // Events (fixed appointments) on the agenda
  event: '#dbeafe',
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

// The embedded cass_habits row's frequency, whichever shape the client returns
function habitFrequency(habit: unknown) {
  const row = (Array.isArray(habit) ? habit[0] : habit) as { frequency?: string } | null | undefined
  return row?.frequency ?? null
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
  // An event: no done buttons
  event: boolean
  // The habit a habit block belongs to, for its Context
  habitId: string | null
  // The theme a todo is a step of
  themeId?: string | null
}

function DayPage() {
  const today = logicalNow(new Date()).day
  const [day, setDay] = useState(today)
  const [tab, setTab] = useState<Tab>('agenda')
  // Every day's blocks and todos once loaded, so switching to a day shows it at
  // once while a refresh runs behind it. A day not loaded yet shows empty, never
  // another day's blocks.
  const [byDay, setByDay] = useState<Record<string, { items: CalItem[]; todos: Todo[]; overdue?: Todo[] }>>({})
  const items = byDay[day]?.items ?? []
  const todos = byDay[day]?.todos ?? []
  // Today only: unfinished todos (not habits) from earlier days
  const overdue = day === today ? (byDay[day]?.overdue ?? []) : []
  // Every todo a card can act on, overdue ones included
  const cardTodos = [...todos, ...overdue]
  // Per day, only the latest load may write, so a slow older response can't land
  // on top of a newer one
  const loadRuns = useRef(new Map<string, number>())
  // Days already fetched at least once, so neighbors are prefetched only once
  const fetchedDays = useRef(new Set<string>())
  const [draft, setDraft] = useState('')
  // The Todos tab shows the first TODO_PREVIEW; "View all" opens the day's full list
  const [allTodos, setAllTodos] = useState(false)
  useEffect(() => setAllTodos(false), [tab, day])
  const shownTodos = allTodos ? todos : todos.slice(0, TODO_PREVIEW)
  const splitAdd = !allTodos && todos.length > TODO_PREVIEW
  const [menu, setMenu] = useState<Menu | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  // Swiping sideways on the agenda moves a day (swipeDays: left is the next day).
  // It only claims a gesture that's clearly sideways, so scrolling still works.
  // The agenda follows the finger; a real swipe slides the day off that side and
  // the next one springs in from the other, anything less springs back.
  const daySlide = useRef(new Animated.Value(0)).current
  const screenWidth = useRef(0)
  screenWidth.current = useWindowDimensions().width
  const daySwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > 2 * Math.abs(g.dy),
      onPanResponderMove: (_e, g) => daySlide.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        const by = swipeDays(g.dx, g.dy)
        if (!by) {
          Animated.spring(daySlide, { toValue: 0, bounciness: 6, useNativeDriver: true }).start()
          return
        }
        const off = by > 0 ? -screenWidth.current : screenWidth.current
        Animated.timing(daySlide, { toValue: off, duration: 140, useNativeDriver: true }).start(() => {
          setDay((d) => shiftDay(d, by))
          daySlide.setValue(-off)
          Animated.spring(daySlide, { toValue: 0, bounciness: 8, speed: 16, useNativeDriver: true }).start()
        })
      },
      onPanResponderTerminate: () => {
        Animated.spring(daySlide, { toValue: 0, useNativeDriver: true }).start()
      },
    }),
  ).current
  // Today's agenda opens scrolled to a few hours before now. Set when today's
  // agenda comes into view, used once the scroll content has its size.
  const agendaScroll = useRef<ScrollView>(null)
  const scrollToNowPending = useRef(true)
  // The Help events and sub-events, shared by the Help tab and Planning
  const [help, setHelp] = useState<HelpGroup[]>([])
  const loadHelp = useCallback(async () => {
    const { data, error } = await supabase
      .from('cass_help_items')
      .select('id,group_name,name,minutes,habit_id')
      .order('created_at')
      .order('sort_order')
    if (error) return setError(error.message)
    const groups: HelpGroup[] = []
    for (const row of data ?? []) {
      let g = groups.find((x) => x.name === row.group_name)
      if (!g) groups.push((g = { name: row.group_name, options: [], minutes: {}, ids: {}, habits: {} }))
      g.options.push(row.name)
      g.minutes[row.name] = row.minutes
      g.ids[row.name] = row.id
      g.habits[row.name] = row.habit_id
    }
    setHelp(groups)
  }, [])
  useEffect(() => {
    loadHelp()
  }, [loadHelp])
  const addHelpSub = async (group: string, name: string) => {
    const count = help.find((g) => g.name === group)?.options.length ?? 0
    const { error } = await supabase
      .from('cass_help_items')
      .insert({ group_name: group, name, minutes: HELP_MINUTES, sort_order: count + 1 })
    if (error) return setError(error.message)
    loadHelp()
  }
  // Ties a Help sub-event to a habit (or none), so the habit's card lists it
  const setHelpHabit = async (group: string, option: string, habitId: string | null) => {
    const id = help.find((g) => g.name === group)?.ids[option]
    if (!id) return
    setHelp((list) => list.map((g) => (g.name === group ? { ...g, habits: { ...g.habits, [option]: habitId } } : g)))
    const { error } = await supabase.from('cass_help_items').update({ habit_id: habitId }).eq('id', id)
    if (error) setError(error.message)
  }
  // The time tapped in the agenda's right strip, for a new todo there
  const [addAt, setAddAt] = useState<number | null>(null)
  // The routine timer that's running, if any (full page)
  const [routine, setRoutine] = useState<{ detail: Detail; steps: RoutineStep[]; index: number; stepStartedAt: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  // The Settings page (the gear on every tab)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = () => setSettingsOpen(true)
  // Auto-schedule (cass_settings, on by default): moving a todo to another day
  // puts it at that day's first open time from 8am (moveToDayStart)
  const [autoSchedule, setAutoSchedule] = useState(true)
  useEffect(() => {
    supabase
      .from('cass_settings')
      .select('auto_schedule')
      .maybeSingle()
      .then(({ data }) => {
        if (data) setAutoSchedule(data.auto_schedule)
      })
  }, [])
  const changeAutoSchedule = async (on: boolean) => {
    setAutoSchedule(on)
    const { error } = await supabase.from('cass_settings').upsert({ auto_schedule: on, updated_at: new Date().toISOString() })
    if (error) {
      setAutoSchedule(!on)
      setError(error.message)
    }
  }
  // Themes (Todos tab): the outcome a set of todos is for. A theme isn't scheduled;
  // its todos are (theme_id). themeRows orders them, no next step first.
  const [themes, setThemes] = useState<{ id: string; title: string; sort_order: number }[]>([])
  const [themeSteps, setThemeSteps] = useState<ThemeStep[]>([])
  // The theme page open in the Todos tab, if any
  const [openThemeId, setOpenThemeId] = useState<string | null>(null)
  const [addingTheme, setAddingTheme] = useState(false)
  const [themeName, setThemeName] = useState('')
  const [renamingTheme, setRenamingTheme] = useState(false)
  const [themeMenu, setThemeMenu] = useState(false)
  const loadThemes = useCallback(async () => {
    const [themeRes, stepRes] = await Promise.all([
      supabase.from('cass_themes').select('id,title,sort_order').is('archived_at', null).order('sort_order'),
      supabase
        .from('cass_time_blocks')
        .select('id,title,day,start_time,end_time,done,theme_id')
        .not('theme_id', 'is', null)
        .order('day', { ascending: false })
        .limit(500),
    ])
    const err = themeRes.error ?? stepRes.error
    if (err) return setError(err.message)
    setThemes(themeRes.data ?? [])
    setThemeSteps(
      (stepRes.data ?? []).map((b) => ({
        id: b.id,
        title: b.title,
        ...fromStored(b.day, b.start_time, b.end_time),
        done: b.done,
        themeId: b.theme_id as string,
      })),
    )
  }, [])
  // Refreshed with every load, so the counts follow saves made anywhere
  useEffect(() => {
    loadThemes()
  }, [loadThemes, byDay])
  // A theme page asked for from another tab, opened once the tab switches
  const pendingTheme = useRef<string | null>(null)
  useEffect(() => {
    setOpenThemeId(pendingTheme.current)
    pendingTheme.current = null
    setThemeMenu(false)
    setRenamingTheme(false)
  }, [tab])
  // The card's link icon: the theme's page, with its todos
  const openThemePage = (id: string) => {
    setDetail(null)
    if (tab === 'todos') return setOpenThemeId(id)
    pendingTheme.current = id
    setTab('todos')
  }
  const themeTitle = (id: string | null | undefined) => (id ? themes.find((t) => t.id === id)?.title : undefined)
  const openTheme = themes.find((t) => t.id === openThemeId) ?? null

  const addTheme = async () => {
    const title = themeName.trim()
    if (!title) return
    const { error } = await supabase.from('cass_themes').insert({ title, sort_order: themes.length + 1 })
    if (error) return setError(error.message)
    setThemeName('')
    setAddingTheme(false)
    loadThemes()
  }
  const renameTheme = async (id: string, title: string) => {
    setRenamingTheme(false)
    if (!title.trim()) return
    setThemes((list) => list.map((t) => (t.id === id ? { ...t, title: title.trim() } : t)))
    const { error } = await supabase.from('cass_themes').update({ title: title.trim() }).eq('id', id)
    if (error) setError(error.message)
  }
  const archiveTheme = async (id: string) => {
    setThemeMenu(false)
    setOpenThemeId(null)
    const { error } = await supabase.from('cass_themes').update({ archived_at: new Date().toISOString() }).eq('id', id)
    if (error) return setError(error.message)
    loadThemes()
  }
  // The card's Theme row
  const setTodoTheme = async (d: Detail, themeId: string | null) => {
    setDetail({ ...d, themeId })
    const { error } = await supabase.from('cass_time_blocks').update({ theme_id: themeId }).eq('id', d.id)
    if (error) return setError(error.message)
    await loadDay(d.day)
  }
  // Convert to theme: a theme named after the todo, which stays as its first step.
  // The card then shows the theme above the title and opens the title to rename
  const makeTheme = async (d: Detail) => {
    const { data, error } = await supabase
      .from('cass_themes')
      .insert({ title: d.title, sort_order: themes.length + 1 })
      .select('id,title,sort_order')
      .single()
    if (error) return setError(error.message)
    setThemes((list) => [...list, data])
    await setTodoTheme(d, data.id)
  }
  const renameTodo = async (d: Detail, title: string) => {
    setDetail({ ...d, title })
    const { error } = await supabase.from('cass_time_blocks').update({ title }).eq('id', d.id)
    if (error) return setError(error.message)
    await loadDay(d.day)
  }
  // A theme page's "Add a next step": a todo under the theme, placed today from 8am like any new todo
  const addThemeStep = async (themeId: string, title: string) => {
    const todayItems = byDay[today]?.items ?? (await fetchDayItems(today))
    const start = newBlockStart(todayItems, 1, true, nowHours())
    if (start === null) return setError('No room left today for that step')
    const { error } = await supabase
      .from('cass_time_blocks')
      .insert({ ...toStored(today, start, start + 1), title, kind: 'personal', source: 'app', theme_id: themeId })
    if (error) return setError(error.message)
    await loadDay(today)
  }
  // Opening a step on another day shows that day behind the card, so its card's moves work
  const openThemeStep = async (step: ThemeStep) => {
    if (step.day !== day) {
      setDay(step.day)
      await loadDay(step.day)
    }
    setDetail({ id: step.id, from: 'todo', title: step.title, day: step.day, start: step.start, end: step.end, done: step.done, fixed: false, event: false, habitId: null, themeId: step.themeId })
  }

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
    const blockCols = 'id,title,day,start_time,end_time,done,habit_id,source,done_at,process_id,theme_id,cass_habits(start_time)'
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
      // A set-time habit or an event stays where it is
      const fixed = hasSetTime(b.cass_habits) || b.source === 'event'
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
        themeId: b.theme_id,
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
        .select('id,title,minutes,frequency,weekday,start_time,anytime,use_average')
        .order('sort_order')
      if (error) return setError(error.message), false
      // An avg habit is placed at its last 5 runs' average length
      const averaged = (habits ?? []).filter((h) => h.use_average)
      if (averaged.length) {
        const { data: runs } = await supabase
          .from('cass_time_blocks')
          .select('habit_id,day,start_time,end_time,done')
          .in('habit_id', averaged.map((h) => h.id))
          .eq('done', true)
          .is('process_id', null)
          .order('day', { ascending: false })
          .limit(200)
        for (const h of averaged) {
          const own = (runs ?? []).filter((r) => r.habit_id === h.id).map((r) => ({ ...fromStored(r.day, r.start_time, r.end_time), done: r.done }))
          h.minutes = averageMinutes(own, 5) ?? h.minutes
        }
      }
      const from = habitSearchFrom(day, today, nowHours())
      if (from === null) return false
      // A weekly habit already placed elsewhere this week (Sunday to Saturday) isn't placed again
      const week = weekStart(day)
      const { data: weekBlocks } = await supabase
        .from('cass_time_blocks')
        .select('habit_id,logical_day,habit_week')
        .eq('habit_week', week)
      const forDay = habitsForDay(
        habits ?? [],
        day,
        (weekBlocks ?? []) as { habit_id: string; logical_day: string; habit_week: string | null }[],
      ).map((h) => ({ ...h, start: h.start_time ? habitStartHours(h.start_time) : null }))
      const placements = placeHabits(current, forDay, from, anytimeSearchFrom(day, today, nowHours()) ?? from)
      for (const p of placements) {
        const { error: insertError } = await supabase.from('cass_time_blocks').upsert(
          {
            ...toStored(day, p.start, p.end),
            title: p.title,
            kind: 'personal',
            source: 'habit',
            habit_id: p.habitId,
            // The week it's placed for; moving it to another day keeps this
            habit_week: week,
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
        .select('id,title,day,start_time,end_time,habit_id,theme_id,cass_habits(start_time)')
        .in('source', ['app', 'habit'])
        .eq('done', false)
        .eq('logical_day', d)
        .order('day')
        .order('start_time')
      if (todoRes.error) setError(todoRes.error.message)
      const overdueRes =
        d === today
          ? await supabase
              .from('cass_time_blocks')
              .select('id,title,day,start_time,end_time,habit_id,source,theme_id,cass_habits(frequency)')
              .in('source', ['app', 'habit'])
              .eq('done', false)
              .lt('logical_day', d)
              .order('day')
              .order('start_time')
          : { data: [] as { id: string; title: string; day: string; start_time: string; end_time: string | null; habit_id: string | null; source: string; theme_id: string | null; cass_habits: unknown }[], error: null }
      if (overdueRes.error) setError(overdueRes.error.message)
      if (loadRuns.current.get(d) !== run) return
      // Todos, and weekly habits (a missed daily habit just comes back tomorrow)
      const dayOverdue = (overdueRes.data ?? [])
        .filter((t) => t.source === 'app' || habitFrequency(t.cass_habits) === 'weekly')
        .map((t) => {
          const { day: logicalDay, start, end } = fromStored(t.day, t.start_time, t.end_time)
          return { id: t.id, title: t.title, day: logicalDay, start, end, habit: !!t.habit_id, habitId: t.habit_id, themeId: t.theme_id }
        })
      const dayTodos = (todoRes.data ?? []).map((t) => {
        const { day: logicalDay, start, end } = fromStored(t.day, t.start_time, t.end_time)
        return {
          id: t.id,
          title: t.title,
          day: logicalDay,
          start,
          end,
          habit: !!t.habit_id,
          fixed: hasSetTime(t.cass_habits),
          habitId: t.habit_id,
          themeId: t.theme_id,
        }
      })
      setByDay((prev) => ({ ...prev, [d]: { items: current, todos: dayTodos, overdue: dayOverdue } }))
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

  // Coming back to today's agenda scrolls near now again
  useEffect(() => {
    if (tab !== 'agenda' || day !== today) return
    scrollToNowPending.current = true
    const hour = Math.max(FIRST_HOUR, Math.floor(nowHours() - LOOKBACK_HOURS))
    agendaScroll.current?.scrollTo({ y: (hour - FIRST_HOUR) * HOUR_PX, animated: false })
  }, [tab, day, today])

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
      const todo = cardTodos.find((t) => t.id === d.id)
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
      const todo = cardTodos.find((t) => t.id === d.id)
      if (!todo) return setError('That todo changed; close the card and open it again')
      plan = moveTodoStartPlan(cardTodos, todo, start)
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

  // The card's Date row moves a todo or habit to another day at the same time.
  // A habit can't land on a day that already has one (one per habit per day).
  const moveToDay = async (d: Detail, newDay: string) => {
    if (newDay === d.day) return
    setDetail(null)
    // With Auto-schedule on it takes the new day's first open time; a set-time
    // habit, a past day or a full day keeps its own time
    let { start, end } = d
    if (autoSchedule && !d.fixed) {
      const dayItems = (byDay[newDay]?.items ?? (await fetchDayItems(newDay))).filter((it) => it.id !== d.id)
      const slot = moveToDayStart(dayItems, d.end - d.start, newDay, today, nowHours())
      if (slot !== null) {
        start = slot
        end = slot + (d.end - d.start)
      }
    }
    const { error } = await supabase
      .from('cass_time_blocks')
      .update(toStored(newDay, start, end))
      .eq('id', d.id)
    if (error) {
      return setError(error.code === '23505' ? 'That habit is already on that day' : error.message)
    }
    await Promise.all([loadDay(d.day), loadDay(newDay), loadDay(today)])
  }

  const setMinutes = async (todo: Todo, minutes: number) => {
    const plan = resizePlan(cardTodos, todo, minutes)
    if ('error' in plan) return setError(plan.error)
    if (plan.moves.length) await saveMoves(plan.moves, () => todo.day)
  }

  // Done now from the card. A todo or habit ends now and lands on today
  // (doneNowPlan); a calendar event, task or set-time habit follows the block
  // menu's Done on the day shown, and on any other day is just marked done.
  const doneNow = async (d: Detail) => {
    setDetail(null)
    const item = d.day === day ? items.find((it) => it.id === d.id) : undefined
    const movable =
      !d.event && !d.fixed && (d.from === 'todo' || (item?.kind === 'block' && (item.source === 'app' || item.source === 'habit')))
    if (!movable) {
      if (item) return setStatus(item, 'done')
      const { error } = await supabase
        .from('cass_time_blocks')
        .update({ done: true, done_at: new Date().toISOString() })
        .eq('id', d.id)
      if (error) return setError(error.message)
      return load()
    }
    const todayItems = byDay[today]?.items ?? []
    const self: CalItem = todayItems.find((it) => it.id === d.id) ?? item ?? {
      id: d.id,
      title: d.title,
      start: d.start,
      end: d.end,
      kind: 'block',
      done: false,
    }
    const plan = doneNowPlan(d.day === today ? todayItems : [self], self, d.day, today, nowHours())
    const doneAt = new Date().toISOString()
    let { error } = await supabase
      .from('cass_time_blocks')
      .update({ ...toStored(today, plan.start, plan.end), done: true, done_at: doneAt })
      .eq('id', d.id)
    // A habit whose copy for today already exists can't move onto today, so it's done where it is
    if (error?.code === '23505') {
      ;({ error } = await supabase.from('cass_time_blocks').update({ done: true, done_at: doneAt }).eq('id', d.id))
    }
    if (error) return setError(error.message)
    if (plan.moves.length) await saveMoves(plan.moves, () => today)
    await Promise.all([loadDay(d.day), loadDay(today)])
  }

  // The card's ⋯ Delete: removes the todo; the todos after it stay where they are
  const deleteTodo = async (d: Detail) => {
    setDetail(null)
    // Agenda items can be legacy cass_tasks rows
    const isTask = d.from === 'item' && items.find((it) => it.id === d.id)?.kind === 'task'
    const { error } = await supabase.from(isTask ? 'cass_tasks' : 'cass_time_blocks').delete().eq('id', d.id)
    if (error) return setError(error.message)
    await Promise.all([loadDay(d.day), d.day === day ? null : load()])
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

  // A todo or event added at a tapped time; the todos and habits from there on move
  // along behind it (insertAtPlan). Mark as Done adds it already done, stamped at
  // its end. An event is saved as source 'event', which no rule ever moves.
  const addTodoAt = async (title: string, start: number, minutes: number, as: 'todo' | 'done' | 'event') => {
    setAddAt(null)
    const plan = insertAtPlan(items, start, minutes / 60, { evictOverlap: as === 'event' })
    if ('error' in plan) return setError(plan.error)
    const { error } = await supabase
      .from('cass_time_blocks')
      .insert({
        ...toStored(day, plan.start, plan.end),
        ...(as === 'done' ? doneAtEnd(day, plan.start, plan.end) : {}),
        title,
        kind: 'personal',
        source: as === 'event' ? 'event' : 'app',
      })
    if (error) return setError(error.message)
    await saveMoves(plan.moves)
  }

  // A Help option tracks on today's agenda as an event starting now (fixed, light
  // blue, no done state; its card's Duration sets how long), with the todos and
  // habits not finished pushed after it (interruptPlan). Then show it.
  const trackHelp = async (name: string, option: string) => {
    const todayItems = await fetchDayItems(today)
    const minutes = help.find((g) => g.name === name)?.minutes[option] ?? HELP_MINUTES
    const plan = interruptPlan(todayItems, nowHours(), minutes / 60)
    if ('error' in plan) return setError(plan.error)
    const { error } = await supabase.from('cass_time_blocks').insert({
      ...toStored(today, plan.start, plan.end),
      title: `${name}: ${option}`,
      kind: 'personal',
      source: 'event',
    })
    if (error) return setError(error.message)
    setTab('agenda')
    setDay(today)
    await saveMoves(plan.moves, () => today)
  }

  // The widget shows today's unfinished todos and habits and the Help events;
  // it's refreshed whenever either changes
  const todayTodos = byDay[today]?.todos
  useEffect(() => {
    if (!cassianWidget || !todayTodos) return
    try {
      cassianWidget.updateSnapshot({
        dayLabel: dayLabel(today),
        todos: [...todayTodos].sort((a, b) => a.start - b.start).map((t) => ({ title: t.title, time: clock(t.start) })),
        help: help.map((g) => ({
          name: g.name,
          options: g.options.map((o) => ({
            label: o,
            url: `cassian3://help?name=${encodeURIComponent(g.name)}&option=${encodeURIComponent(o)}`,
          })),
        })),
      })
    } catch {
      // No widget native code (Expo Go)
    }
  }, [todayTodos, help, today])

  // Tapping a Help option in the widget opens cassian3://help?name=..&option=..,
  // which tracks it like the Help tab does
  const trackHelpRef = useRef(trackHelp)
  trackHelpRef.current = trackHelp
  useEffect(() => {
    const handle = (url: string | null) => {
      const m = url?.match(/^cassian3:\/\/help\?(.*)$/)
      if (!m) return
      const params = new URLSearchParams(m[1])
      const name = params.get('name')
      const option = params.get('option')
      if (name && option) trackHelpRef.current(name, option)
    }
    Linking.getInitialURL().then(handle)
    const sub = Linking.addEventListener('url', (e) => handle(e.url))
    return () => sub.remove()
  }, [])

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
        <HabitsScreen
          active={tab === 'planning'}
          today={today}
          help={help}
          onAddHelpSub={addHelpSub}
          onHelpHabit={setHelpHabit}
          onSettings={openSettings}
        />
      </View>
      {tab === 'planning' ? null : tab === 'help' ? (
        <HelpScreen help={help} onSettings={openSettings} onTrack={trackHelp} />
      ) : (
      <View style={styles.screenFill} {...(tab === 'agenda' ? daySwipe.panHandlers : {})}>
        {/* Stays put while the agenda or todos scroll underneath */}
        {tab === 'todos' && openTheme ? (
          // Above the list, so the ⋯ menu that drops below it isn't covered
          <View style={{ zIndex: 5 }}>
            <View style={[styles.header, styles.fixedHeader, { zIndex: 5 }]}>
            <Pressable
              onPress={() => {
                Keyboard.dismiss()
                setOpenThemeId(null)
                setThemeMenu(false)
              }}
              hitSlop={10}
              accessibilityLabel="Back"
              style={[styles.backButton, { width: 64 }]}
            >
              <ChevronLeft size={18} color={c.accent} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={[styles.title, styles.themeHeaderTitle]}>Theme</Text>
            <View style={[styles.headerRight, { width: 64, justifyContent: 'flex-end' }]}>
              <Pressable onPress={() => setThemeMenu(!themeMenu)} hitSlop={10} accessibilityLabel="More" accessibilityState={{ expanded: themeMenu }}>
                <MoreHorizontal size={20} color={c.ink} />
              </Pressable>
            </View>
            {themeMenu ? (
              <View style={[styles.menu, styles.themeMenu]}>
                <Pressable style={[styles.menuItem, styles.menuRow]} onPress={() => archiveTheme(openTheme.id)}>
                  <Archive size={16} color={c.ink} />
                  <Text style={styles.menuText}>Archive</Text>
                </Pressable>
              </View>
            ) : null}
            </View>
            {/* The theme's name, its own bar under the header; tap to rename */}
            <View style={styles.themeNameBar}>
              {renamingTheme ? (
                <TextInput
                  style={[styles.themeNameText, styles.titleInput]}
                  defaultValue={openTheme.title}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={(e) => renameTheme(openTheme.id, e.nativeEvent.text)}
                  onEndEditing={(e) => renameTheme(openTheme.id, e.nativeEvent.text)}
                />
              ) : (
                <Pressable onPress={() => setRenamingTheme(true)} accessibilityHint="Tap to rename">
                  <Text style={styles.themeNameText} numberOfLines={2}>
                    {openTheme.title}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : tab === 'todos' && allTodos ? (
          <View style={[styles.header, styles.fixedHeader]}>
            <Pressable
              onPress={() => {
                Keyboard.dismiss()
                setAllTodos(false)
              }}
              hitSlop={10}
              accessibilityLabel="Back"
              style={[styles.backButton, { width: 64 }]}
            >
              <ChevronLeft size={18} color={c.accent} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            {/* Its own title, so it reads as a separate page from the day view */}
            <View>
              <Text style={styles.title}>All todos</Text>
              <Text style={styles.subtitle}>{day === today ? 'Today' : dayLabel(day)}</Text>
            </View>
            <View style={{ width: 64 }} />
          </View>
        ) : (
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
            <SettingsButton onOpen={openSettings} />
          </View>
        </View>
        )}
        <Animated.View style={[styles.screenFill, { transform: [{ translateX: tab === 'agenda' ? daySlide : 0 }] }]}>
          <ScrollView
            ref={agendaScroll}
            onContentSizeChange={() => {
              if (!scrollToNowPending.current || tab !== 'agenda' || day !== today) return
              scrollToNowPending.current = false
              const hour = Math.max(FIRST_HOUR, Math.floor(nowHours() - LOOKBACK_HOURS))
              agendaScroll.current?.scrollTo({ y: (hour - FIRST_HOUR) * HOUR_PX, animated: false })
            }}
            scrollEnabled={!dragging}
            contentContainerStyle={styles.page}
            keyboardShouldPersistTaps="handled"
            // Keeps "Add a todo" above the keyboard on a long list
            automaticallyAdjustKeyboardInsets
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
          >
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {tab === 'todos' && openTheme ? (
              <ThemeSteps
                key={openTheme.id}
                steps={themeSteps.filter((st) => st.themeId === openTheme.id)}
                today={today}
                onOpen={openThemeStep}
                onAdd={(title) => addThemeStep(openTheme.id, title)}
              />
            ) : null}
            {tab === 'todos' && !openTheme && !allTodos && overdue.length ? (
              <>
                <Text style={[styles.sectionLabel, styles.overdueLabel]}>OVERDUE</Text>
                <View style={[styles.card, styles.overdueCard]}>
                  {overdue.map((t) => (
                    <Pressable
                      key={t.id}
                      style={styles.todoRow}
                      onPress={() =>
                        setDetail({ id: t.id, from: 'todo', title: t.title, day: t.day, start: t.start, end: t.end, done: false, fixed: false, event: false, habitId: t.habitId ?? null, themeId: t.themeId ?? null })
                      }
                    >
                      <Text style={[styles.todoText, { flex: 1 }]}>{t.title}</Text>
                      <Text style={styles.minutesLabel}>
                    {themeTitle(t.themeId) ? `${themeTitle(t.themeId)} · ` : ''}
                    {t.habit ? 'Habit · ' : ''}
                    {dayLabel(t.day)}
                  </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.sectionLabel}>TODAY</Text>
              </>
            ) : null}
            {tab === 'todos' && openTheme ? null : tab === 'todos' ? (
              // With a "View all" row, the list and "Add a todo" are two cards; otherwise one.
              // Only styles change between the two, so the field keeps focus when tapping it
              // opens the full list.
              <View style={splitAdd ? null : styles.card}>
              <View style={splitAdd ? styles.card : null}>
                <TodoList
                  todos={shownTodos}
                  today={today}
                  onMinutes={setMinutes}
                  // A reorder in the preview keeps the rest of the day after it
                  onReorder={(next) => reorder([...next, ...todos.slice(next.length)])}
                  onDragging={setDragging}
                  themeTitle={themeTitle}
                  onOpen={(t) => setDetail({ id: t.id, from: 'todo', title: t.title, day: t.day, start: t.start, end: t.end, done: false, fixed: !!t.fixed, event: false, habitId: t.habitId ?? null, themeId: t.themeId ?? null })}
                />
                {!allTodos && todos.length > TODO_PREVIEW ? (
                  <Pressable style={[styles.viewAllRow, styles.addRowDivider]} onPress={() => setAllTodos(true)} hitSlop={4}>
                    <Text style={[styles.viewAll, { flex: 1, paddingTop: 0 }]}>
                      View all {day === today ? 'for today' : `for ${dayLabel(day)}`} ({todos.length})
                    </Text>
                    <ChevronRight size={16} color={c.accent} />
                  </Pressable>
                ) : null}
              </View>
              <View style={splitAdd ? [styles.card, styles.addCard] : null}>
                <View style={[styles.addRow, !splitAdd && todos.length > 0 && styles.addRowDivider]}>
                  <TextInput
                    style={styles.addInput}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Add a todo"
                    placeholderTextColor={c.muted}
                    // Adding to a day with more than 4 todos opens the full list, scrolled
                    // down to this field once the keyboard is up
                    onFocus={() => {
                      if (allTodos || todos.length <= 4) return
                      setAllTodos(true)
                      setTimeout(() => agendaScroll.current?.scrollToEnd({ animated: true }), 300)
                    }}
                    returnKeyType="done"
                    onSubmitEditing={add}
                  />
                  <Pressable onPress={add} hitSlop={8}>
                    <Plus size={20} color={c.accent} />
                  </Pressable>
                </View>
              </View>
              </View>
            ) : (
              <DayGrid
                items={items}
                showNow={day === today}
                onMore={(item, x, y) => setMenu({ item, x, y })}
                onOpen={(item) => setDetail({ id: item.id, from: 'item', title: item.title, day, start: item.start, end: item.end, done: item.done, fixed: !!item.fixed, event: item.source === 'event', habitId: item.habitId ?? null, themeId: item.themeId ?? null })}
                onAddAt={setAddAt}
              />
            )}

            {/* Themes sit under the day's todos; no next step comes first (themeRows) */}
            {tab === 'todos' && !openTheme && !allTodos ? (
              <>
                <View style={[styles.sectionHeaderRow, styles.themesHeader]}>
                  <Text style={[styles.sectionLabel, { flex: 1 }]}>THEMES</Text>
                  <Pressable style={styles.addButton} onPress={() => setAddingTheme(!addingTheme)} hitSlop={8} accessibilityLabel="Add a theme">
                    <Plus size={16} color={c.accent} />
                    <Text style={styles.addButtonText}>Add</Text>
                  </Pressable>
                </View>
                <View style={styles.card}>
                  {addingTheme ? (
                    <View style={[styles.addRow, themes.length > 0 && styles.listDivider]}>
                      <TextInput
                        style={styles.addInput}
                        value={themeName}
                        onChangeText={setThemeName}
                        placeholder="Theme name"
                        placeholderTextColor={c.muted}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={addTheme}
                      />
                      <Pressable onPress={addTheme} hitSlop={8} accessibilityLabel="Create theme">
                        <Check size={20} color={c.accent} />
                      </Pressable>
                    </View>
                  ) : null}
                  {themeRows(themes, themeSteps).map((r) => (
                    <Pressable key={r.id} style={styles.todoRow} onPress={() => setOpenThemeId(r.id)}>
                      {/* The title gets the full width; its next step sits underneath */}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.todoText}>{r.title}</Text>
                        <Text style={[styles.minutesLabel, !r.next && styles.noNextStep]}>
                          {r.next ? `${r.open} ${r.open === 1 ? 'todo' : 'todos'} · ${whenLabel(r.next.day, r.next.start, today)}` : 'No next step'}
                        </Text>
                      </View>
                      <ChevronRight size={18} color={c.muted} />
                    </Pressable>
                  ))}
                  {!themes.length && !addingTheme ? <Text style={[styles.minutesLabel, styles.emptySection]}>None yet</Text> : null}
                </View>
              </>
            ) : null}
          </ScrollView>
        </Animated.View>
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
              // Its recorded routine steps, already loaded with the day's blocks
              parts={(byDay[detail.day]?.items ?? [])
                .filter((it) => it.processId === detail.id)
                .sort((x, y) => x.start - y.start)
                .map((it) => ({ id: it.id, title: it.title, start: it.start, end: it.end }))}
              help={help}
              onMoveToDay={moveToDay}
              onDelete={!detail.habitId && !detail.event ? deleteTodo : undefined}
              themes={themes}
              // Themes are for todos, not habits or events
              onTheme={!detail.habitId && !detail.event ? setTodoTheme : undefined}
              onMakeTheme={!detail.habitId && !detail.event && !detail.themeId ? makeTheme : undefined}
              onOpenTheme={openThemePage}
              onRename={!detail.habitId && !detail.event ? renameTodo : undefined}
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

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SettingsPage
          autoSchedule={autoSchedule}
          onAutoSchedule={changeAutoSchedule}
          onClose={() => setSettingsOpen(false)}
          onSignOut={() => {
            setSettingsOpen(false)
            supabase.auth.signOut()
          }}
        />
      </Modal>
    </View>
  )
}

type Habit = {
  id: string
  title: string
  minutes: number
  frequency: 'daily' | 'weekly'
  weekday: number | null
  // A set time of day ("23:00:00"), or null to go in the first free gap
  start_time: string | null
  // Duration set to "avg": it follows the last 5 runs' average (averageMinutes)
  use_average: boolean
}

// One of a habit's blocks, with its 6am to 6am day and times
type HabitBlock = { logical_day: string; done: boolean; start: number; end: number; habit_week: string | null }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

const TABS = [
  { key: 'todos', label: 'Todos', Icon: ListTodo },
  { key: 'agenda', label: 'Agenda', Icon: CalendarDays },
  { key: 'planning', label: 'Planning', Icon: NotebookPen },
  { key: 'help', label: 'Help', Icon: LifeBuoy },
] as const

// A Help event (Theo) and its sub-events with their starting lengths, from
// cass_help_items
type HelpGroup = {
  name: string
  options: string[]
  minutes: Record<string, number>
  // Each sub-event's row id, and the habit it's tied to (if any)
  ids: Record<string, string>
  habits: Record<string, string | null>
}
// How long a new sub-event starts out; a tracked event's Duration slider changes it
const HELP_MINUTES = 5

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

// A full page shown in a Modal. SafeAreaView can get no insets inside a Modal,
// which put the Back button under the clock, so this pads by the device's insets
function ModalScreen({ style, children }: { style: ComponentProps<typeof View>['style']; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return <View style={[style, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{children}</View>
}

// The gear's page: settings, then Sign out at the bottom
function SettingsPage({
  autoSchedule,
  onAutoSchedule,
  onClose,
  onSignOut,
}: {
  autoSchedule: boolean
  onAutoSchedule: (on: boolean) => void
  onClose: () => void
  onSignOut: () => void
}) {
  // The ⓘ beside a setting shows what it does, tap again to hide
  const [explaining, setExplaining] = useState(false)
  return (
    <ModalScreen style={styles.screen}>
      <View style={[styles.header, styles.fixedHeader]}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back" style={[styles.backButton, { width: 64 }]}>
          <ChevronLeft size={18} color={c.accent} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 64 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.page, styles.settingsPage]}>
        <Text style={styles.sectionLabel}>SCHEDULING</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Text style={styles.todoText}>Auto-schedule</Text>
            <Pressable
              onPress={() => setExplaining(!explaining)}
              hitSlop={10}
              accessibilityLabel="What Auto-schedule does"
              accessibilityState={{ expanded: explaining }}
            >
              <Info size={16} color={explaining ? c.accent : c.muted} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Switch
              value={autoSchedule}
              onValueChange={onAutoSchedule}
              trackColor={{ true: c.accent }}
              accessibilityLabel="Auto-schedule"
            />
          </View>
          {explaining ? (
            <View style={styles.tooltip}>
              <Text style={styles.tooltipText}>
                When you move a todo to another day, it goes to that day's first open time from 8am, back to back with what's
                already there. Moved to today, it takes the next open time from now. Off, it keeps the time it had. Set-time
                habits like Shut down always keep their time.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1 }} />
        <Pressable style={styles.signOutButton} onPress={onSignOut} accessibilityRole="button">
          <LogOut size={18} color={c.ink} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </ModalScreen>
  )
}

// Opens the Settings page
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

type ThemeStep = { id: string; title: string; day: string; start: number; end: number; done: boolean; themeId: string }

// "Today · 2:28pm" or "Thu, Oct 8 · 10am" for a theme's next step
function whenLabel(day: string, start: number, today: string) {
  if (day === today) return `Today · ${clock(start)}`
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return `${date} · ${clock(start)}`
}

// A theme's page in the Todos tab: its next steps (tap one for its card), a box
// to add the next one, and the steps already done, folded away
function ThemeSteps({
  steps,
  today,
  onOpen,
  onAdd,
}: {
  steps: ThemeStep[]
  today: string
  onOpen: (step: ThemeStep) => void
  onAdd: (title: string) => Promise<void> | void
}) {
  const [draft, setDraft] = useState('')
  // Open by default; the header still folds it
  const [showDone, setShowDone] = useState(true)
  const byWhen = (a: ThemeStep, b: ThemeStep) => (a.day === b.day ? a.start - b.start : a.day < b.day ? -1 : 1)
  const open = steps.filter((st) => !st.done).sort(byWhen)
  const done = steps.filter((st) => st.done).sort((a, b) => byWhen(b, a))
  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await onAdd(title)
  }
  return (
    <>
      <Text style={styles.sectionLabel}>NEXT STEPS</Text>
      <View style={styles.card}>
        {open.map((st) => (
          <Pressable key={st.id} style={styles.todoRow} onPress={() => onOpen(st)}>
            <Text style={[styles.todoText, { flex: 1 }]}>{st.title}</Text>
            <Text style={styles.minutesLabel}>{whenLabel(st.day, st.start, today)}</Text>
            <ChevronRight size={18} color={c.muted} />
          </Pressable>
        ))}
        <View style={[styles.addRow, open.length > 0 && styles.addRowDivider]}>
          <TextInput
            style={styles.addInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a next step"
            placeholderTextColor={c.muted}
            returnKeyType="done"
            onSubmitEditing={add}
          />
          <Pressable onPress={add} hitSlop={8} accessibilityLabel="Add step">
            <Plus size={20} color={c.accent} />
          </Pressable>
        </View>
      </View>
      {done.length ? (
        <>
          <Pressable style={styles.sectionHeaderRow} onPress={() => setShowDone(!showDone)} accessibilityState={{ expanded: showDone }}>
            <Text style={[styles.sectionLabel, { flex: 1 }]}>DONE ({done.length})</Text>
            {showDone ? <ChevronDown size={16} color={c.muted} /> : <ChevronRight size={16} color={c.muted} />}
          </Pressable>
          {showDone ? (
            <View style={styles.card}>
              {done.slice(0, 10).map((st) => (
                // Opens its card, where ⋯ has Delete
                <Pressable key={st.id} style={styles.todoRow} onPress={() => onOpen(st)}>
                  <CircleCheck size={18} color={c.accent} />
                  <Text style={[styles.todoText, styles.todoDoneText, { flex: 1 }]}>{st.title}</Text>
                  <Text style={styles.minutesLabel}>{whenLabel(st.day, st.start, today)}</Text>
                  <ChevronRight size={18} color={c.muted} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </>
  )
}

type TodoList = { id: string; title: string; photo_path: string | null; transcribed_at: string | null; count: number }
type TodoListItem = { id: string; title: string; done: boolean }

// Planning's Todo Lists: paper lists captured as a photo, each with the todos
// read off it (transcribe-todo-list). Tapping one opens its page.
function TodoListsSection({ active }: { active: boolean }) {
  const [lists, setLists] = useState<TodoList[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [open, setOpen] = useState<TodoList | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('cass_todo_lists')
      .select('id,title,photo_path,transcribed_at,cass_todo_list_items(count)')
      .order('created_at', { ascending: false })
    if (error) return setError(error.message)
    setError(null)
    setLists(
      (data ?? []).map(({ cass_todo_list_items: items, ...l }) => ({
        ...l,
        count: (items as { count: number }[] | null)?.[0]?.count ?? 0,
      })),
    )
  }, [])
  useEffect(() => {
    if (active) load()
  }, [active, load])

  const create = async () => {
    const title = name.trim()
    if (!title) return
    const { data, error } = await supabase.from('cass_todo_lists').insert({ title }).select('id,title,photo_path,transcribed_at').single()
    if (error) return setError(error.message)
    setAdding(false)
    setName('')
    setOpen({ ...data, count: 0 })
    load()
  }

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionLabel, { flex: 1 }]}>TODO LISTS</Text>
        <Pressable style={styles.addButton} onPress={() => setAdding(!adding)} hitSlop={8} accessibilityLabel="Add a todo list">
          <Plus size={16} color={c.accent} />
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.card}>
        {adding ? (
          <View style={[styles.addRow, lists.length > 0 && styles.listDivider]}>
            <TextInput
              style={styles.addInput}
              value={name}
              onChangeText={setName}
              placeholder="List name"
              placeholderTextColor={c.muted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={create}
            />
            <Pressable onPress={create} hitSlop={8} accessibilityLabel="Create list">
              <Check size={20} color={c.accent} />
            </Pressable>
          </View>
        ) : null}
        {lists.map((l) => (
          <Pressable key={l.id} style={styles.todoRow} onPress={() => setOpen(l)}>
            <Text style={[styles.todoText, { flex: 1 }]}>{l.title}</Text>
            <Text style={styles.minutesLabel}>
              {l.photo_path ? `${l.count} ${l.count === 1 ? 'todo' : 'todos'}` : 'No photo yet'}
            </Text>
            <ChevronRight size={18} color={c.muted} />
          </Pressable>
        ))}
        {!lists.length && !adding ? <Text style={[styles.minutesLabel, styles.emptySection]}>None yet</Text> : null}
      </View>

      <Modal visible={open !== null} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open ? (
          <TodoListPage
            list={open}
            onClose={() => {
              setOpen(null)
              load()
            }}
          />
        ) : null}
      </Modal>
    </>
  )
}

// One Todo List: the photo of the paper list (or buttons to take one), then the
// todos read off it. A new photo replaces the todos.
function TodoListPage({ list, onClose }: { list: TodoList; onClose: () => void }) {
  const [photoPath, setPhotoPath] = useState(list.photo_path)
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [items, setItems] = useState<TodoListItem[] | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tapping the photo shows it full screen, pinch to zoom
  const [fullPhoto, setFullPhoto] = useState(false)
  // The close button sits below the status bar and Dynamic Island
  const insets = useSafeAreaInsets()

  const loadItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('cass_todo_list_items')
      .select('id,title,done')
      .eq('list_id', list.id)
      .order('sort_order')
    if (error) return setError(error.message)
    setItems(data ?? [])
  }, [list.id])
  useEffect(() => {
    loadItems()
  }, [loadItems])
  // A saved photo is private, so it's shown through a link that lasts an hour
  useEffect(() => {
    if (!photoPath || photoUri) return
    supabase.storage
      .from('todo-lists')
      .createSignedUrl(photoPath, 3600)
      .then(({ data }) => data && setPhotoUri(data.signedUrl))
  }, [photoPath, photoUri])

  const capture = async (from: 'camera' | 'library') => {
    setError(null)
    if (!imagePicker) return setError('The camera needs the new app build. Rebuild from Xcode on the MacBook.')
    if (from === 'camera') {
      const permission = await imagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) return setError('Allow camera access for Cassian in Settings to take a photo.')
    }
    const options: ImagePickerOptions = { mediaTypes: ['images'], quality: 0.4, base64: true }
    const result = from === 'camera' ? await imagePicker.launchCameraAsync(options) : await imagePicker.launchImageLibraryAsync(options)
    const asset = result.canceled ? null : result.assets[0]
    if (!asset?.base64) return
    setPhotoUri(asset.uri)
    await transcribe(asset.base64)
  }

  // Sends a new photo, or reads the saved one again when there's none
  const transcribe = async (imageBase64?: string) => {
    setReading(true)
    const { error } = await supabase.functions.invoke('transcribe-todo-list', {
      body: { list_id: list.id, image_base64: imageBase64 },
    })
    setReading(false)
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
      const status = (error as { context?: Response }).context?.status
      // 502 is the read step: the photo is already saved, and there's no working
      // Anthropic key yet, so the todos get added from a Claude session for now
      if (status === 502 && imageBase64) {
        setPhotoPath((p) => p ?? 'uploaded')
        return setError('Photo saved. Reading it automatically is not set up yet, so ask Claude to add the todos from it.')
      }
      return setError(detail?.error ?? error.message)
    }
    // The function saved the photo; the picked one is already showing, so only the flag matters here
    if (imageBase64) setPhotoPath((p) => p ?? 'uploaded')
    loadItems()
  }

  const toggle = async (item: TodoListItem) => {
    setItems((list) => list?.map((it) => (it.id === item.id ? { ...it, done: !it.done } : it)) ?? null)
    const { error } = await supabase.from('cass_todo_list_items').update({ done: !item.done }).eq('id', item.id)
    if (error) setError(error.message)
  }

  return (
    <ModalScreen style={styles.screen}>
      <View style={[styles.header, styles.fixedHeader]}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back" style={[styles.backButton, { width: 64 }]}>
          <ChevronLeft size={18} color={c.accent} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
          {list.title}
        </Text>
        <View style={{ width: 64 }} />
      </View>
      <ScrollView contentContainerStyle={styles.page}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {photoUri ? (
          <Pressable onPress={() => setFullPhoto(true)} accessibilityRole="imagebutton" accessibilityLabel="Show the photo full screen">
            <Image source={{ uri: photoUri }} style={styles.listPhoto} resizeMode="contain" />
          </Pressable>
        ) : null}
        <View style={styles.captureRow}>
          <Pressable style={[styles.captureButton, reading && styles.buttonDisabled]} disabled={reading} onPress={() => capture('camera')}>
            <Camera size={18} color="#ffffff" />
            <Text style={styles.doneButtonText}>{photoPath ? 'Retake' : 'Take photo'}</Text>
          </Pressable>
          <Pressable style={[styles.captureButtonQuiet, reading && styles.buttonQuietDisabled]} disabled={reading} onPress={() => capture('library')}>
            <ImagePlus size={18} color={c.accent} />
            <Text style={styles.captureQuietText}>Choose photo</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>TODOS</Text>
        <View style={styles.card}>
          {reading ? (
            <View style={styles.readingRow}>
              <ActivityIndicator size="small" color={c.accent} />
              <Text style={styles.todoText}>Reading your list...</Text>
            </View>
          ) : items === null ? (
            <ActivityIndicator style={styles.emptySection} size="small" color={c.accent} />
          ) : items.length ? (
            items.map((it) => (
              <Pressable
                key={it.id}
                style={styles.todoRow}
                onPress={() => toggle(it)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: it.done }}
              >
                {it.done ? <CircleCheck size={20} color={c.accent} /> : <Circle size={20} color={c.muted} />}
                <Text style={[styles.todoText, { flex: 1 }, it.done && styles.todoDoneText]}>{it.title}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={[styles.minutesLabel, styles.emptySection]}>
              {photoPath ? 'No todos were read from the photo. Try a clearer photo.' : 'Take a photo of the list to fill this in.'}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* A layer over the page, not a second Modal: iOS doesn't reliably close a
          Modal opened from inside another. Tapping the photo or the X closes it. */}
      {fullPhoto && photoUri ? (
        <View style={[StyleSheet.absoluteFill, styles.photoViewer]}>
          <ScrollView
            style={styles.screenFill}
            contentContainerStyle={styles.photoViewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Pressable style={styles.screenFill} onPress={() => setFullPhoto(false)} accessibilityLabel="Close photo">
              <Image source={{ uri: photoUri }} style={styles.photoViewerImage} resizeMode="contain" />
            </Pressable>
          </ScrollView>
          <Pressable
            onPress={() => setFullPhoto(false)}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            style={[styles.photoViewerCloseButton, { top: insets.top + 8 }]}
          >
            <X size={22} color="#ffffff" />
          </Pressable>
        </View>
      ) : null}
    </ModalScreen>
  )
}

// Help: a small card per person or pet; tapping one lists what you can do, and
// picking one tracks it on today's agenda starting now
function HelpScreen({
  help,
  onSettings,
  onTrack,
}: {
  help: HelpGroup[]
  onSettings: (at: { x: number; y: number }) => void
  onTrack: (name: string, option: string) => void
}) {
  const [open, setOpen] = useState<HelpGroup | null>(null)

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <ScreenHeader title="Help" onSettings={onSettings} />
        <View style={styles.helpGrid}>
          {help.map((h) => (
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
  help,
  onAddHelpSub,
  onHelpHabit,
  onSettings,
}: {
  help: HelpGroup[]
  onAddHelpSub: (group: string, name: string) => void
  onHelpHabit: (group: string, option: string, habitId: string | null) => void
  // Whether the Habits tab is showing; opening it refreshes in the background
  active: boolean
  today: string
  onSettings: (at: { x: number; y: number }) => void
}) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Habit | null>(null)
  const [adding, setAdding] = useState(false)
  // Which Help events are expanded, the sub-event whose card is open, and the
  // Help event a new sub-event is being added to
  const [addingSub, setAddingSub] = useState<string | null>(null)
  const [subName, setSubName] = useState('')
  const [pickingHabit, setPickingHabit] = useState(false)
  const [helpExpanded, setHelpExpanded] = useState<Set<string>>(new Set())
  const [subEvent, setSubEvent] = useState<{ name: string; option: string } | null>(null)
  // Every tracked Help event, by its title ("Theo: Open window"), loaded with the list
  const [helpHistory, setHelpHistory] = useState<Map<string, { day: string; start: number; end: number }[]>>(new Map())
  // Every habit's blocks, loaded with the list so a habit's history is ready the
  // moment its card opens
  const [blocksByHabit, setBlocksByHabit] = useState<Map<string, HabitBlock[]>>(new Map())

  // Loads when the app starts and again each time the tab opens, keeping what's
  // already on screen until the fresh copy arrives
  useEffect(() => {
    if (!active && habits.length) return
    Promise.all([
      supabase.from('cass_habits').select('id,title,minutes,frequency,weekday,start_time,use_average').order('sort_order'),
      supabase.from('cass_time_blocks').select('habit_id,day,logical_day,start_time,end_time,done,habit_week').not('habit_id', 'is', null),
      // Skipped until the Help list has loaded (an empty list isn't a valid filter)
      help.length
        ? supabase
            .from('cass_time_blocks')
            .select('title,day,start_time,end_time')
            .eq('source', 'event')
            .in('title', help.flatMap((h) => h.options.map((o) => `${h.name}: ${o}`)))
        : Promise.resolve({ data: [] as { title: string; day: string; start_time: string; end_time: string | null }[], error: null }),
    ]).then(([habitRes, blockRes, helpRes]) => {
      const err = habitRes.error ?? blockRes.error ?? helpRes.error
      const byTitle = new Map<string, { day: string; start: number; end: number }[]>()
      for (const b of helpRes.data ?? []) {
        const row = fromStored(b.day, b.start_time, b.end_time)
        byTitle.set(b.title, [...(byTitle.get(b.title) ?? []), row])
      }
      for (const list of byTitle.values()) list.sort((x, y) => (x.day === y.day ? y.start - x.start : x.day < y.day ? 1 : -1))
      setHelpHistory(byTitle)
      if (err) setError(err.message)
      setHabits(habitRes.data ?? [])
      const byHabit = new Map<string, HabitBlock[]>()
      for (const b of blockRes.data ?? []) {
        const row = { logical_day: b.logical_day, done: b.done, habit_week: b.habit_week, ...fromStored(b.day, b.start_time, b.end_time) }
        byHabit.set(b.habit_id, [...(byHabit.get(b.habit_id) ?? []), row])
      }
      setBlocksByHabit(byHabit)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, help])

  const addHabit = async (draft: Omit<Habit, 'id'>) => {
    setAdding(false)
    const { data, error } = await supabase
      .from('cass_habits')
      .insert({ ...draft, sort_order: habits.length + 1 })
      .select('id,title,minutes,frequency,weekday,start_time,use_average')
      .single()
    if (error) return setError(error.message)
    setHabits((list) => [...list, data])
  }

  // Saves daily/weekly and the weekday. Unfinished blocks after today are cleared
  // so they get placed again on the right days as those days are opened.
  type HabitEdit = Partial<Pick<Habit, 'frequency' | 'weekday' | 'minutes' | 'start_time' | 'use_average'>>
  const editHabit = async (habit: Habit, patch: HabitEdit) => {
    const next = { ...habit, ...patch }
    if (next.frequency === 'daily') next.weekday = null
    setHabits((list) => list.map((h) => (h.id === habit.id ? next : h)))
    setSelected(next)
    const { error } = await supabase
      .from('cass_habits')
      .update({ frequency: next.frequency, weekday: next.weekday, minutes: next.minutes, start_time: next.start_time, use_average: next.use_average })
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

  const changeSchedule = (habit: Habit, frequency: Habit['frequency'], weekday: number | null) =>
    editHabit(habit, { frequency, weekday })

  const sections = [
    { title: 'DAILY HABITS', list: habits.filter((h) => h.frequency === 'daily') },
    { title: 'WEEKLY HABITS', list: habits.filter((h) => h.frequency === 'weekly') },
  ]
  // The Habits page, opened from Planning's Habits row
  const [showHabits, setShowHabits] = useState(false)

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        {showHabits ? (
          <View style={styles.header}>
            <Pressable onPress={() => setShowHabits(false)} hitSlop={10} accessibilityLabel="Back" style={[styles.backButton, { width: 64 }]}>
              <ChevronLeft size={18} color={c.accent} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={[styles.title, { flex: 1 }]}>Habits</Text>
            <View style={[styles.headerRight, { width: 64, justifyContent: 'flex-end' }]}>
              <Pressable style={styles.addButton} onPress={() => setAdding(true)} hitSlop={8}>
                <Plus size={16} color={c.accent} />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScreenHeader title="Planning" onSettings={onSettings} />
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {showHabits ? null : (
          <View style={styles.card}>
            <Pressable style={styles.todoRow} onPress={() => setShowHabits(true)} accessibilityLabel="Habits">
              <Repeat size={18} color={c.accent} />
              <Text style={[styles.todoText, { flex: 1 }]}>Habits</Text>
              <Text style={styles.minutesLabel}>
                {sections[0].list.length} daily · {sections[1].list.length} weekly
              </Text>
              <ChevronRight size={18} color={c.muted} />
            </Pressable>
          </View>
        )}
        {!showHabits ? null : sections.map(({ title, list }) => (
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
                    <Text style={styles.minutesLabel}>
                      {h.use_average
                        ? `avg · ${averageMinutes((blocksByHabit.get(h.id) ?? []).map((b) => ({ ...b, day: b.logical_day })), 5) ?? h.minutes} min`
                        : `${h.minutes} min`}
                    </Text>
                    <ChevronRight size={18} color={c.muted} />
                  </Pressable>
                ))
              ) : (
                <Text style={[styles.minutesLabel, styles.emptySection]}>None yet</Text>
              )}
            </View>
          </View>
        ))}

        {showHabits ? null : (
          <>
          <Text style={styles.sectionLabel}>HELP EVENTS</Text>
          <View style={styles.card}>
            {help.map((h) => {
              const open = helpExpanded.has(h.name)
              return (
                <View key={h.name}>
                  <Pressable
                    style={styles.todoRow}
                    onPress={() =>
                      setHelpExpanded((set) => {
                        const next = new Set(set)
                        if (open) next.delete(h.name)
                        else next.add(h.name)
                        return next
                      })
                    }
                    accessibilityState={{ expanded: open }}
                  >
                    <View style={styles.titleWithAdd}>
                      <Text style={styles.todoText}>{h.name}</Text>
                      {/* Adding a sub-event shows only while the row is expanded */}
                      {open ? (
                        <Pressable
                          onPress={() => {
                            setSubName('')
                            setAddingSub(h.name)
                          }}
                          hitSlop={10}
                          accessibilityLabel={`Add a sub-event to ${h.name}`}
                        >
                          <Plus size={18} color={c.accent} />
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={styles.minutesLabel}>
                      {h.options.length} {h.options.length === 1 ? 'event' : 'events'}
                    </Text>
                    {open ? <ChevronDown size={18} color={c.muted} /> : <ChevronRight size={18} color={c.muted} />}
                  </Pressable>
                  {open
                    ? h.options.map((option) => (
                        <Pressable
                          key={option}
                          style={[styles.todoRow, styles.subRow]}
                          onPress={() => setSubEvent({ name: h.name, option })}
                        >
                          <Text style={[styles.todoText, { flex: 1 }]}>{option}</Text>
                          <Text style={styles.minutesLabel}>{h.minutes[option] ?? HELP_MINUTES} min</Text>
                        </Pressable>
                      ))
                    : null}
                </View>
              )
            })}
          </View>

          <TodoListsSection active={active} />
          </>
        )}
      </ScrollView>

      {/* Outside the ScrollView, so one tap on the backdrop closes it */}
      <Modal visible={addingSub !== null} transparent animationType="none" onRequestClose={() => setAddingSub(null)}>
        <KeyboardAvoidingView style={styles.screenFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.detailBackdrop} onPress={() => setAddingSub(null)}>
            {addingSub ? (
              // Claims taps on the card so only the backdrop closes it
              <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
                <Text style={styles.detailTitle}>New {addingSub} event</Text>
                <TextInput
                  style={styles.input}
                  value={subName}
                  onChangeText={setSubName}
                  placeholder="Name"
                  placeholderTextColor={c.muted}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (!subName.trim()) return
                    onAddHelpSub(addingSub, subName.trim())
                    setAddingSub(null)
                  }}
                />
                <Pressable
                  style={[styles.submitButton, !subName.trim() && styles.buttonDisabled]}
                  disabled={!subName.trim()}
                  onPress={() => {
                    onAddHelpSub(addingSub, subName.trim())
                    setAddingSub(null)
                  }}
                >
                  <Text style={[styles.doneButtonText, !subName.trim() && styles.buttonDisabledText]}>Add</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={subEvent !== null} transparent animationType="none" onRequestClose={() => setSubEvent(null)}>
        <Pressable style={styles.detailBackdrop} onPress={() => setSubEvent(null)}>
          {subEvent ? (
            // Claims taps on the card so only the backdrop closes it
            <View style={[styles.detailCard, styles.historyCard]} onStartShouldSetResponder={() => true}>
              <Text style={styles.detailTitle}>{subEvent.option}</Text>
              <Text style={styles.detailDay}>
                {subEvent.name} ·{' '}
                {help.find((g) => g.name === subEvent.name)?.minutes[subEvent.option] ?? HELP_MINUTES} min to start
              </Text>
              {(() => {
                const habitId = help.find((g) => g.name === subEvent.name)?.habits[subEvent.option] ?? null
                const current = habits.find((h) => h.id === habitId)
                return (
                  <>
                    <View style={styles.sliderRow}>
                      <Text style={styles.sliderLabel}>Habit</Text>
                      <Pressable style={styles.dropdown} onPress={() => setPickingHabit(!pickingHabit)} accessibilityLabel="Habit">
                        <Text style={styles.dropdownText}>{current ? current.title : 'None'}</Text>
                        <ChevronDown size={16} color={c.muted} />
                      </Pressable>
                    </View>
                    {pickingHabit ? (
                      <ScrollView style={styles.dropdownList} nestedScrollEnabled>
                        {[null, ...habits].map((h) => {
                          const id = h ? h.id : null
                          const active = id === habitId
                          return (
                            <Pressable
                              key={id ?? 'none'}
                              style={[styles.dropdownItem, active && styles.segmentItemActive]}
                              onPress={() => {
                                setPickingHabit(false)
                                if (!active) onHelpHabit(subEvent.name, subEvent.option, id)
                              }}
                            >
                              <Text style={[styles.dropdownText, active && styles.segmentTextActive]}>{h ? h.title : 'None'}</Text>
                            </Pressable>
                          )
                        })}
                      </ScrollView>
                    ) : null}
                  </>
                )
              })()}
              {(() => {
                const times = helpHistory.get(`${subEvent.name}: ${subEvent.option}`) ?? []
                return times.length ? (
                  <ScrollView style={styles.historyList}>
                    {times.map((t, i) => (
                      <View key={`${t.day}-${t.start}-${i}`} style={styles.partRow}>
                        <Text style={[styles.todoText, { flex: 1 }]}>{t.day === today ? 'Today' : dayLabel(t.day)}</Text>
                        <Text style={styles.minutesLabel}>
                          {clock(t.start)} · {Math.round((t.end - t.start) * 60)} min
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.historySummary}>Not tracked yet</Text>
                )
              })()}
            </View>
          ) : null}
        </Pressable>
      </Modal>

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
              related={help
                .flatMap((g) => g.options.filter((o) => g.habits[o] === selected.id).map((o) => `${g.name}: ${o}`))
                .flatMap((title) => (helpHistory.get(title) ?? []).map((t) => ({ title, ...t })))
                .sort((x, y) => (x.day === y.day ? y.start - x.start : x.day < y.day ? 1 : -1))}
              blocks={blocksByHabit.get(selected.id) ?? []}
              today={today}
              onSchedule={changeSchedule}
              onEdit={editHabit}
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
  onSave: (title: string, start: number, minutes: number, as: 'todo' | 'done' | 'event') => void
}) {
  // A todo, or an event (fixed: no rule moves it)
  const [mode, setMode] = useState<'todo' | 'event'>('todo')
  const [title, setTitle] = useState('')
  const [offset, setOffset] = useState(0)
  const [minutes, setMinutes] = useState(60)
  const ready = title.trim().length > 0
  const startMin = Math.min(Math.max(Math.round(at * 60) + offset, 0), DAY_END * 60 - minutes)
  const start = startMin / 60
  const save = (as: 'todo' | 'done' | 'event') => ready && onSave(title.trim(), start, minutes, as)

  return (
    // Claims taps on the card so only the backdrop closes it
    <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
      <View style={styles.modeRow}>
        <Text style={[styles.detailTitle, styles.modeHalf]}>{mode === 'todo' ? 'New todo' : 'New event'}</Text>
        <Pressable style={styles.modeHalf} onPress={() => setMode(mode === 'todo' ? 'event' : 'todo')} hitSlop={8}>
          <Text style={styles.modeSwitch}>{mode === 'todo' ? 'Event' : 'Todo'}</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Name"
        placeholderTextColor={c.muted}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => save(mode === 'event' ? 'event' : 'todo')}
      />
      <Text style={styles.detailTimes}>
        {clock(start)} – {clock(start + minutes / 60)} · {minutes} min
      </Text>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Start</Text>
        <SteadySlider
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
        <SteadySlider
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
      {mode === 'event' ? (
        <Pressable style={[styles.submitButton, !ready && styles.buttonDisabled]} disabled={!ready} onPress={() => save('event')}>
          <Text style={[styles.doneButtonText, !ready && styles.buttonDisabledText]}>Save</Text>
        </Pressable>
      ) : (
        <View style={styles.doneRow}>
          <Pressable style={[styles.doneButton, !ready && styles.buttonDisabled]} disabled={!ready} onPress={() => save('todo')}>
            <Text style={[styles.doneButtonText, !ready && styles.buttonDisabledText]}>Add</Text>
          </Pressable>
          <Pressable style={[styles.doneButton, !ready && styles.buttonDisabled]} disabled={!ready} onPress={() => save('done')}>
            <Text style={[styles.doneButtonText, !ready && styles.buttonDisabledText]}>Mark as Done</Text>
          </Pressable>
        </View>
      )}
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
          onSave({ title: title.trim(), minutes, frequency, weekday: frequency === 'weekly' ? weekday : null, start_time: null, use_average: false })
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
  onEdit,
  related,
}: {
  habit: Habit
  blocks: HabitBlock[]
  today: string
  onSchedule: (habit: Habit, frequency: Habit['frequency'], weekday: number | null) => void
  onEdit: (habit: Habit, patch: { minutes?: number; start_time?: string | null; use_average?: boolean }) => void
  // Tracked Help events tied to this habit, newest first
  related: { title: string; day: string; start: number; end: number }[]
}) {
  const [pickingStart, setPickingStart] = useState(false)
  const rows = habitHistory(blocks, today, habit.frequency === 'weekly' ? habit.weekday : null)
  // Duration: avg sets it to the last 5 runs' average (averageMinutes); the slider
  // shows where it's going while dragging and saves on release
  const avg = averageMinutes(blocks.map((b) => ({ ...b, day: b.logical_day })), 5)
  const [dragMinutes, setDragMinutes] = useState(habit.minutes)
  useEffect(() => setDragMinutes(habit.minutes), [habit.minutes])

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
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Duration</Text>
        <Pressable
          style={[styles.duration, habit.use_average && styles.durationSelected, avg === null && styles.avgDisabled]}
          disabled={avg === null}
          onPress={() => avg !== null && !habit.use_average && onEdit(habit, { minutes: avg, use_average: true })}
          accessibilityLabel={avg === null ? 'Average, not done yet' : `Use the average of the last 5 times, ${avg} minutes`}
        >
          <Text style={[styles.durationText, habit.use_average && styles.durationTextSelected]}>avg</Text>
        </Pressable>
        <SteadySlider
          style={styles.slider}
          value={dragMinutes}
          minimumValue={SLIDER_STEP}
          maximumValue={Math.max(SLIDER_MAX, habit.minutes)}
          step={SLIDER_STEP}
          minimumTrackTintColor={c.accent}
          maximumTrackTintColor={c.line}
          thumbTintColor={c.accent}
          onValueChange={(v) => setDragMinutes(Math.round(v))}
          onSlidingComplete={(v) => {
            // Dragging sets a fixed length, which takes it off avg
            const next = Math.round(v)
            if (next !== habit.minutes || habit.use_average) onEdit(habit, { minutes: next, use_average: false })
          }}
          accessibilityLabel="Duration in minutes"
        />
        <Text style={[styles.minutesLabel, styles.durationValue]}>{dragMinutes} min</Text>
      </View>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>Start</Text>
        <Pressable style={styles.dropdown} onPress={() => setPickingStart(!pickingStart)} accessibilityLabel="Start time">
          <Text style={styles.dropdownText}>{habit.start_time ? clock(habitStartHours(habit.start_time)) : 'Any time'}</Text>
          <ChevronDown size={16} color={c.muted} />
        </Pressable>
      </View>
      {pickingStart ? (
        <ScrollView style={styles.dropdownList} nestedScrollEnabled>
          {[null, ...startTimeOptions()].map((h) => {
            const value = h === null ? null : habitStartValue(h)
            const active = (habit.start_time ?? null) === value
            return (
              <Pressable
                key={value ?? 'any'}
                style={[styles.dropdownItem, active && styles.segmentItemActive]}
                onPress={() => {
                  setPickingStart(false)
                  if (!active) onEdit(habit, { start_time: value })
                }}
              >
                <Text style={[styles.dropdownText, active && styles.segmentTextActive]}>
                  {h === null ? 'Any time (first free gap)' : clock(h)}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
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
                <Text style={[styles.todoText, { flex: 1 }]}>
                  {habit.frequency === 'weekly' ? `Week of ${dayLabel(r.day)}` : r.day === today ? 'Today' : dayLabel(r.day)}
                </Text>
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
      {related.length ? (
        <View style={styles.parts}>
          <Text style={styles.sectionLabel}>RELATED EVENTS</Text>
          {related.map((r, i) => (
            <View key={`${r.title}-${r.day}-${r.start}-${i}`} style={styles.partRow}>
              <Text style={[styles.todoText, { flex: 1 }]}>{r.title}</Text>
              <Text style={styles.minutesLabel}>
                {r.day === today ? 'Today' : dayLabel(r.day)} · {clock(r.start)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

// The slider draws its handle at the start on its first frame, then jumps to
// its value once it has measured itself. This keeps it invisible until it has
// laid out, so it appears already in place.
function SteadySlider(props: ComponentProps<typeof Slider>) {
  const [ready, setReady] = useState(false)
  return (
    <Slider
      {...props}
      style={[props.style, !ready && styles.invisible]}
      onLayout={(e) => {
        props.onLayout?.(e)
        if (!ready) requestAnimationFrame(() => setReady(true))
      }}
    />
  )
}

// How many days a habit card's Context shows before View all
const CONTEXT_PREVIEW_DAYS = 3
// How many completed runs Context's Last times lists
const LAST_TIMES = 5

// Days of a habit's tied events: each day's heading with when the habit was done
// the night before, then that day's events
function ContextDays({
  days,
  nights,
  habitTitle,
}: {
  days: { day: string; rows: { title: string; start: number; end: number }[] }[]
  nights: { logical_day: string; done: boolean; done_at: string | null }[]
  habitTitle: string
}) {
  return (
    <>
      {days.map((g) => {
        const night = nightBefore(nights, g.day)
        return (
          <View key={g.day} style={styles.contextDay}>
            <View style={styles.contextHeader}>
              <Text style={[styles.sectionLabel, { flex: 1 }]}>{dayLabel(g.day).toUpperCase()}</Text>
              {night === null ? null : (
                <View style={styles.nightBefore} accessibilityLabel={`${habitTitle} the night before`}>
                  <Moon size={12} color={c.muted} />
                  <Text style={styles.nightBeforeText}>{night === 'not done' ? 'not done' : clock(night)}</Text>
                </View>
              )}
            </View>
            {g.rows.map((r, i) => (
              <View key={`${r.title}-${r.start}-${i}`} style={styles.partRow}>
                <Text style={[styles.todoText, { flex: 1 }]}>{r.title}</Text>
                <Text style={styles.minutesLabel}>
                  {clock(r.start)} · {Math.round((r.end - r.start) * 60)} min
                </Text>
              </View>
            ))}
          </View>
        )
      })}
    </>
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
  help,
  onMoveToDay,
  onDelete,
  themes,
  onTheme,
  onMakeTheme,
  onOpenTheme,
  onRename,
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
  help: HelpGroup[]
  // Date row (todos and habits from the Todos tab): moves it to another day
  onMoveToDay: (detail: Detail, day: string) => void
  // The ⋯ menu's Delete; left out where deleting wouldn't stick (habits come back)
  onDelete?: (detail: Detail) => void
  // Theme row (todos only, not habits or events): pick one, convert to one, or none
  themes: { id: string; title: string }[]
  onTheme?: (detail: Detail, themeId: string | null) => void
  // Convert to theme: a theme named after this todo, which stays as its first step
  onMakeTheme?: (detail: Detail) => void
  // The link icon beside the theme: its page in the Todos tab
  onOpenTheme?: (themeId: string) => void
  // Tapping the title renames a todo
  onRename?: (detail: Detail, title: string) => void
}) {
  const [pickingDate, setPickingDate] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(detail.title)
  useEffect(() => setTitleDraft(detail.title), [detail.title])
  const [pickingTheme, setPickingTheme] = useState(false)
  const [pickerTop, setPickerTop] = useState(46)
  const themeName = themes.find((t) => t.id === detail.themeId)?.title
  // Blur and the checkmark can both fire for one save
  const savingTitle = useRef(false)
  const saveTitle = () => {
    if (savingTitle.current) return
    savingTitle.current = true
    setTimeout(() => (savingTitle.current = false), 0)
    setRenaming(false)
    const next = titleDraft.trim()
    if (next && next !== detail.title) onRename?.(detail, next)
    else setTitleDraft(detail.title)
  }
  // The todo's title becomes the theme; the title opens for the step's own name
  const convertToTheme = () => {
    setPickingTheme(false)
    onMakeTheme?.(detail)
    setTitleDraft(detail.title)
    setRenaming(true)
  }
  // Context: the Help events tied to this habit, day by day
  const [showContext, setShowContext] = useState(false)
  // The full page of every day, opened from View all
  const [showAll, setShowAll] = useState(false)
  const [context, setContext] = useState<ReturnType<typeof groupByDay<{ title: string; day: string; start: number; end: number }>> | null>(null)
  const contextTitles = detail.habitId
    ? help.flatMap((g) => g.options.filter((o) => g.habits[o] === detail.habitId).map((o) => `${g.name}: ${o}`))
    : []
  // The habit's own blocks, for when it was done the night before each day
  const [habitNights, setHabitNights] = useState<{ logical_day: string; done: boolean; done_at: string | null }[]>([])
  // Last times: the habit's recent completed runs (lastTimes), for every habit
  const [runs, setRuns] = useState<ReturnType<typeof lastTimes> | null>(null)
  useEffect(() => {
    if (!detail.habitId) return
    supabase
      .from('cass_time_blocks')
      .select('day,start_time,end_time,done')
      .eq('habit_id', detail.habitId)
      .eq('done', true)
      .is('process_id', null)
      .order('day', { ascending: false })
      .limit(20)
      .then(({ data }) =>
        setRuns(lastTimes((data ?? []).map((b) => ({ ...fromStored(b.day, b.start_time, b.end_time), done: b.done })), LAST_TIMES)),
      )
  }, [detail.habitId])
  // Loaded when the card opens, so Context is ready the moment it's tapped
  useEffect(() => {
    if (!contextTitles.length) return
    supabase
      .from('cass_time_blocks')
      .select('title,day,start_time,end_time')
      .eq('source', 'event')
      .in('title', contextTitles)
      .then(({ data }) => {
        setContext(groupByDay((data ?? []).map((b) => ({ title: b.title, ...fromStored(b.day, b.start_time, b.end_time) }))))
      })
    supabase
      .from('cass_time_blocks')
      .select('logical_day,done,done_at')
      .eq('habit_id', detail.habitId!)
      .then(({ data }) => setHabitNights(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.habitId, contextTitles.join('|')])
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
      <View style={[styles.modeRow, { alignItems: 'flex-start' }]}>
        <View style={styles.modeHalf}>
          {/* The theme above the title: its dropdown, and a link to its page */}
          {onTheme ? (
            <View
              style={styles.titleThemeRow}
              // Where the dropdown starts: just under this row (the card has 16 of padding)
              onLayout={(e) => setPickerTop(16 + e.nativeEvent.layout.y + e.nativeEvent.layout.height + 2)}
            >
              <Pressable
                // Plain text until tapped; the outlined chip shows only while its list is open
                style={[styles.titleThemeChip, pickingTheme ? styles.titleThemeChipOpen : null]}
                onPress={() => setPickingTheme(!pickingTheme)}
                accessibilityState={{ expanded: pickingTheme }}
                accessibilityLabel={themeName ? `Theme: ${themeName}. Change it` : 'Pick a theme'}
              >
                <Text style={[styles.titleThemeText, themeName ? styles.titleThemeTextSet : null]} numberOfLines={1}>
                  {themeName ?? 'No theme'}
                </Text>
                <ChevronDown size={16} color={themeName ? c.theme : c.muted} />
              </Pressable>
              {themeName && onOpenTheme ? (
                <Pressable onPress={() => onOpenTheme(detail.themeId!)} hitSlop={8} accessibilityLabel={`Open ${themeName}`}>
                  <ExternalLink size={16} color={c.theme} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {renaming ? (
            <View style={styles.titleEditRow}>
              <TextInput
                style={[styles.detailTitle, styles.titleInput, { flex: 1 }]}
                value={titleDraft}
                onChangeText={setTitleDraft}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={saveTitle}
                onBlur={saveTitle}
              />
              <Pressable style={styles.titleSave} onPress={saveTitle} hitSlop={8} accessibilityLabel="Save title">
                <Check size={18} color={c.accent} />
              </Pressable>
            </View>
          ) : onRename ? (
            <Pressable onPress={() => setRenaming(true)} accessibilityHint="Tap to rename">
              <Text style={styles.detailTitle}>{detail.title}</Text>
            </Pressable>
          ) : (
            <Text style={styles.detailTitle}>{detail.title}</Text>
          )}
        </View>
        {/* Every habit has Context: its last times, then any Help events tied to it */}
        {detail.habitId ? (
          <Pressable onPress={() => setShowContext(!showContext)} hitSlop={8} accessibilityState={{ expanded: showContext }}>
            <Text style={styles.modeSwitch}>{showContext ? 'General' : 'Context'}</Text>
          </Pressable>
        ) : null}
        {onDelete || onMakeTheme ? (
          <Pressable
            style={styles.moreButton}
            onPress={() => setMoreOpen(!moreOpen)}
            hitSlop={8}
            accessibilityLabel="More"
            accessibilityState={{ expanded: moreOpen }}
          >
            <MoreVertical size={18} color={c.ink} />
          </Pressable>
        ) : null}
      </View>
          {/* A tap anywhere else on the card closes the dropdown */}
          {onTheme && pickingTheme ? (
            <Pressable style={styles.pickerDismiss} onPress={() => setPickingTheme(false)} accessibilityLabel="Close theme list" />
          ) : null}
          {onTheme && pickingTheme ? (
            <View style={[styles.themePicker, { top: pickerTop }]}>
              {themes.map((t) => (
                <Pressable
                  key={t.id}
                  style={styles.themePickerRow}
                  onPress={() => {
                    setPickingTheme(false)
                    if (t.id !== detail.themeId) onTheme(detail, t.id)
                  }}
                >
                  <Text style={[styles.menuText, { flex: 1 }]} numberOfLines={1}>
                    {t.title}
                  </Text>
                  {t.id === detail.themeId ? <Check size={16} color={c.accent} /> : null}
                </Pressable>
              ))}
              {onMakeTheme ? (
                <Pressable style={styles.themePickerRow} onPress={convertToTheme}>
                  <Layers size={16} color={c.accent} />
                  <Text style={[styles.menuText, { color: c.accent }]}>Convert to theme</Text>
                </Pressable>
              ) : null}
              {detail.themeId ? (
                <Pressable
                  style={styles.themePickerRow}
                  onPress={() => {
                    setPickingTheme(false)
                    onTheme(detail, null)
                  }}
                >
                  <Text style={[styles.menuText, { color: c.muted }]}>None</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
      {moreOpen && (onDelete || onMakeTheme) ? (
        <View style={[styles.menu, styles.moreMenu]}>
          {onMakeTheme ? (
            <Pressable
              style={[styles.menuItem, styles.menuRow]}
              onPress={() => {
                setMoreOpen(false)
                convertToTheme()
              }}
            >
              <Layers size={16} color={c.ink} />
              <Text style={styles.menuText}>Convert to theme</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable style={[styles.menuItem, styles.menuRow]} onPress={() => onDelete(detail)}>
              <Trash2 size={16} color={c.now} />
              <Text style={[styles.menuText, styles.deleteText]}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showContext ? (
        <View style={styles.parts}>
          <Text style={styles.sectionLabel}>LAST TIMES</Text>
          {runs === null ? (
            <ActivityIndicator size="small" color={c.accent} />
          ) : runs.length ? (
            runs.map((r) => (
              <View key={r.day + r.end} style={styles.lastTimeRow}>
                <Text style={[styles.todoText, { flex: 1 }]}>{dayLabel(r.day)}</Text>
                <Text style={styles.minutesLabel}>
                  ended {clock(r.end)} · {r.minutes} min
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.minutesLabel}>Not done yet.</Text>
          )}
          {contextTitles.length ? <Text style={styles.sectionLabel}>HELP EVENTS</Text> : null}
          {!contextTitles.length ? null : context && context.length ? (
            <>
              <ContextDays days={context.slice(0, CONTEXT_PREVIEW_DAYS)} nights={habitNights} habitTitle={detail.title} />
              {context.length > CONTEXT_PREVIEW_DAYS ? (
                <Pressable onPress={() => setShowAll(true)} hitSlop={8}>
                  <Text style={styles.viewAll}>View all ({context.length} days)</Text>
                </Pressable>
              ) : null}
              <Modal visible={showAll} animationType="slide" onRequestClose={() => setShowAll(false)}>
                <ModalScreen style={styles.screen}>
                  <View style={[styles.header, styles.fixedHeader]}>
                    <Pressable onPress={() => setShowAll(false)} hitSlop={10} accessibilityLabel="Back">
                      <ChevronLeft size={22} color={c.ink} />
                    </Pressable>
                    <Text style={styles.title}>{detail.title}</Text>
                    <View style={{ width: 22 }} />
                  </View>
                  <ScrollView contentContainerStyle={styles.page}>
                    <ContextDays days={context} nights={habitNights} habitTitle={detail.title} />
                  </ScrollView>
                </ModalScreen>
              </Modal>
            </>
          ) : context ? (
            <Text style={styles.minutesLabel}>None tracked yet.</Text>
          ) : null}
        </View>
      ) : null}
      {/* Context shows on its own; General is the rest of the card */}
      {showContext ? null : (
        <>
          {detail.day === today ? null : <Text style={styles.detailDay}>{dayLabel(detail.day)}</Text>}
          <Text style={styles.detailTimes}>
            {clock(start)} – {clock(start + minutes / 60)} · {minutes} min
          </Text>

{/* Done blocks keep their date and time; only the read-out above shows them */}
{detail.from === 'todo' && !detail.done ? (
  <>
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>Date</Text>
      <View style={styles.durations}>
        {(['today', '1d', '3d'] as const).map((choice) => {
          const target = dayChoice(choice, today)
          const active = target === detail.day
          return (
            <Pressable
              key={choice}
              style={[styles.duration, active && styles.durationSelected]}
              onPress={() => onMoveToDay(detail, target)}
              accessibilityLabel={choice === 'today' ? 'Today' : `In ${choice}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.durationText, active && styles.durationTextSelected]}>{choice === 'today' ? 'Today' : choice}</Text>
            </Pressable>
          )
        })}
        <Pressable style={styles.duration} onPress={() => setPickingDate(!pickingDate)} accessibilityLabel="Pick a date">
          <CalendarDays size={16} color={c.ink} />
        </Pressable>
      </View>
    </View>
    {pickingDate ? (
      <DateTimePicker
        value={dateAt(detail.day, 12)}
        mode="date"
        display="inline"
        onChange={(_e, picked) => {
          setPickingDate(false)
          if (picked) onMoveToDay(detail, toDayString(picked))
        }}
      />
    ) : null}
  </>
) : null}

          {detail.done ? null : (
            <>
            {/* Every block's start is yours to move, a set-time habit like Shut down
                included; the automatic rules still leave set-time habits where they are */}
            <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Start</Text>
                <SteadySlider
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
              <SteadySlider
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
            </>
          )}

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

          {detail.done || detail.event ? null : (
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
        </>
      )}
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
    <ModalScreen style={styles.timerScreen}>
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
    </ModalScreen>
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
  themeTitle,
}: {
  todos: Todo[]
  today: string
  onMinutes: (todo: Todo, minutes: number) => Promise<void> | void
  onReorder: (next: Todo[]) => void
  onDragging: (dragging: boolean) => void
  onOpen: (todo: Todo) => void
  // A todo's theme, shown first in its grey line
  themeTitle: (themeId: string | null | undefined) => string | undefined
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
              theme={themeTitle(t.themeId)}
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
  theme,
  handle,
}: {
  todo: Todo
  today: string
  onMinutes: (minutes: number) => Promise<void> | void
  onOpen: () => void
  theme?: string
  handle: PanResponderInstance['panHandlers']
}) {
  const minutes = Math.round((todo.end - todo.start) * 60)
  const options = durationOptions(minutes)
  // While a new duration saves, a spinner takes the chips' place at the same width
  const [saving, setSaving] = useState(false)
  const [chipsWidth, setChipsWidth] = useState<number | undefined>(undefined)
  const pick = async (m: number) => {
    setSaving(true)
    try {
      await onMinutes(m)
    } finally {
      setSaving(false)
    }
  }

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
          {theme ? `${theme} · ` : ''}
          {todo.habit ? 'Habit · ' : ''}
          {todo.day === today ? '' : `${dayLabel(todo.day)} · `}
          {clock(todo.start)}
        </Text>
      </Pressable>
      {saving ? (
        <View style={[styles.durations, styles.durationsSaving, { width: chipsWidth }]}>
          <ActivityIndicator size="small" color={c.accent} />
        </View>
      ) : (
      <View style={styles.durations} onLayout={(e) => setChipsWidth(e.nativeEvent.layout.width)}>
        {options.map((m) => {
          const selected = m === minutes
          return (
            <Pressable
              key={m}
              style={[styles.duration, selected && styles.durationSelected]}
              onPress={() => !selected && pick(m)}
              accessibilityLabel={`${m} minutes`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.durationText, selected && styles.durationTextSelected]}>{m}</Text>
            </Pressable>
          )
        })}
      </View>
      )}
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
  // Every day, today included, runs the whole 6am to 2am; today opens scrolled near now
  const first = FIRST_HOUR
  const last = LAST_HOUR
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
                backgroundColor: dark
                  ? c.doneEarly
                  : it.done
                    ? c.blockDone
                    : it.source === 'event'
                      ? c.event
                      : it.kind === 'block'
                        ? c.block
                        : c.task,
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
            {it.source === 'event' ? null : (
              <Pressable
                style={[styles.more, compact && styles.moreShort]}
                hitSlop={10}
                onPress={(e) => onMore(it, e.nativeEvent.pageX, e.nativeEvent.pageY)}
              >
                <MoreHorizontal size={compact ? 16 : 18} color={dark ? c.onDark : c.ink} />
              </Pressable>
            )}
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
  // Lines up with the page's section labels (page padding is 12)
  themeNameBar: {
    paddingHorizontal: 12,
    paddingTop: 14,
    backgroundColor: c.bg,
  },
  themeHeaderTitle: { flex: 1, fontSize: 17 },
  themeNameText: { fontSize: 20, fontWeight: '600', color: c.theme },
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
  subRow: { paddingLeft: 24 },
  contextDay: { paddingHorizontal: 8, paddingTop: 6 },
  overdueLabel: { color: c.now },
  overdueCard: { borderColor: c.now, marginBottom: 6 },
  contextHeader: { flexDirection: 'row', alignItems: 'center' },
  invisible: { opacity: 0 },
  addCard: { marginTop: 8 },
  themesHeader: { marginTop: 12 },
  noNextStep: { color: c.theme, fontWeight: '600' },
  themeMenu: { top: 48, right: 12 },
  titleThemeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  titleThemeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 4,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  titleThemeChipOpen: { paddingHorizontal: 8, borderColor: c.theme, backgroundColor: c.themeTint },
  titleThemeText: { flexShrink: 1, fontSize: 15, color: c.muted },
  titleThemeTextSet: { color: c.theme, fontWeight: '600' },
  titleEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleSave: { padding: 4 },
  titleInput: { borderBottomWidth: 1, borderBottomColor: c.accent, paddingVertical: 2 },
  themeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.line,
  },
  themeChipSet: { borderColor: c.accent, backgroundColor: c.block },
  themeChipText: { flex: 1, fontSize: 15, color: c.muted },
  themeChipTextSet: { color: c.ink, fontWeight: '600' },
  pickerDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9 },
  // Drops down over the title from the theme above it
  themePicker: {
    position: 'absolute',
    left: 16,
    minWidth: 220,
    maxWidth: '80%',
    zIndex: 10,
    elevation: 6,
    backgroundColor: c.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.line,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  themePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12 },
  avgDisabled: { opacity: 0.5 },
  durationValue: { width: 52, textAlign: 'right' },
  lastTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  settingsPage: { flexGrow: 1 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 8 },
  tooltip: { marginHorizontal: 8, marginBottom: 8, padding: 10, borderRadius: 8, backgroundColor: c.block },
  tooltipText: { fontSize: 15, lineHeight: 21, color: c.ink },
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.card,
  },
  signOutText: { fontSize: 16, fontWeight: '600', color: c.ink },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  listDivider: { borderBottomWidth: 1, borderBottomColor: c.line },
  listPhoto: { width: '100%', height: 260, borderRadius: 10, backgroundColor: c.line, marginBottom: 8 },
  captureRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  captureButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: c.accent,
  },
  captureButtonQuiet: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.accent,
    backgroundColor: c.card,
  },
  buttonQuietDisabled: { opacity: 0.5 },
  captureQuietText: { fontSize: 16, fontWeight: '600', color: c.accent },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 8 },
  photoViewer: { backgroundColor: '#000000', zIndex: 20 },
  photoViewerContent: { flexGrow: 1, justifyContent: 'center' },
  photoViewerImage: { width: '100%', height: '100%' },
  photoViewerCloseButton: { position: 'absolute', right: 12, zIndex: 2, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 },
  todoDoneText: { textDecorationLine: 'line-through', color: c.muted },
  moreButton: { alignSelf: 'flex-start', marginTop: 4, marginLeft: 12 },
  moreMenu: { top: 44, right: 12 },
  deleteText: { color: c.now, fontWeight: '600' },
  durationsSaving: { justifyContent: 'center', alignItems: 'center', minHeight: 30 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 16, fontWeight: '600', color: c.accent },
  viewAllRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 8 },
  viewAll: { fontSize: 14, fontWeight: '600', color: c.accent, paddingHorizontal: 8, paddingTop: 8 },
  nightBefore: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 6 },
  nightBeforeText: { fontSize: 12, fontWeight: '700', color: c.muted },
  titleWithAdd: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dropdown: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 6,
  },
  dropdownText: { fontSize: 16, color: c.ink },
  dropdownList: { maxHeight: 200, borderWidth: 1, borderColor: c.line, borderRadius: 6 },
  dropdownItem: { paddingVertical: 8, paddingHorizontal: 10 },
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
  modeRow: { flexDirection: 'row', alignItems: 'baseline' },
  modeHalf: { flex: 1 },
  modeSwitch: { fontSize: 16, fontWeight: '600', color: c.muted },
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
