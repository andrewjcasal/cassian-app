// The 4x4 (systemLarge) home screen widget: today's unfinished todos and habits,
// and the Help events whose options open Cassian to log them. Widget code runs in
// its own runtime: no hooks, no app state, nothing from module scope, so all it
// shows comes in through props (the app sends them with updateSnapshot).
import { HStack, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { bold, font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'

export type CassianDayProps = {
  dayLabel: string
  todos: { title: string; time: string }[]
  help: { name: string; options: { label: string; url: string }[] }[]
}

const CassianDay = (props: CassianDayProps, _environment: WidgetEnvironment) => {
  'widget'
  return (
    <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 14 }), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
      <HStack>
        <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle('#1c1c1a')]}>Today</Text>
        <Spacer />
        <Text modifiers={[font({ size: 13 }), foregroundStyle('#5a5a55')]}>{props.dayLabel}</Text>
      </HStack>

      <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle('#1c1c1a')]}>TODOS</Text>
      {props.todos.length ? (
        props.todos.slice(0, 7).map((t, i) => (
          <HStack key={`${t.title}-${i}`} spacing={8}>
            <Text modifiers={[font({ size: 13 }), foregroundStyle('#5a5a55'), frame({ width: 58, alignment: 'leading' })]}>{t.time}</Text>
            <Text modifiers={[font({ size: 15 }), foregroundStyle('#1c1c1a')]}>{t.title}</Text>
          </HStack>
        ))
      ) : (
        <Text modifiers={[font({ size: 15 }), foregroundStyle('#5a5a55')]}>All done</Text>
      )}

      <Spacer />

      <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle('#1c1c1a')]}>HELP</Text>
      {props.help.map((h) => (
        <HStack key={h.name} spacing={10}>
          <Text modifiers={[font({ size: 15 }), bold(), foregroundStyle('#1c1c1a'), frame({ width: 84, alignment: 'leading' })]}>{h.name}</Text>
          {h.options.map((o) => (
            <Link key={o.label} destination={o.url}>
              <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle('#2f5d50')]}>{o.label}</Text>
            </Link>
          ))}
        </HStack>
      ))}
    </VStack>
  )
}

export default createWidget('CassianDay', CassianDay)
