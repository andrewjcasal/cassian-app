// Reads the photo of a paper todo list on a theme and returns its todos.
// POST { theme_id, image_base64? } with the user's session. With a photo it's
// saved to the todo-lists bucket first (one per theme, no retakes); without one,
// the theme's saved photo is read again (when reading it failed before). The app
// turns the todos into real todos under the theme and sets photo_read_at.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { cleanTranscribed } from '../_shared/todoLists.ts'

const PROMPT = `This is a photo of a todo list written or printed on paper.
List every todo on it, one string per item, in the order they appear on the page.
Keep the wording as written. Include items that are crossed out or checked off.
Leave out the list's title, any date heading, and anything that isn't a todo.
If a word is hard to read, give your best reading of it.`

const SCHEMA = {
  type: 'object',
  properties: { todos: { type: 'array', items: { type: 'string' } } },
  required: ['todos'],
  additionalProperties: false,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Sign in first' }, 401)

  // Every read and write runs as the user, so the owner-only policies apply
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return json({ error: 'Sign in first' }, 401)

  const { theme_id: themeId, image_base64: imageBase64 } = await req.json().catch(() => ({}))
  if (typeof themeId !== 'string') return json({ error: 'theme_id is required' }, 400)
  const { data: theme } = await supabase.from('cass_themes').select('id,photo_path,photo_read_at').eq('id', themeId).maybeSingle()
  if (!theme) return json({ error: 'That theme was not found' }, 404)
  if (theme.photo_read_at) return json({ error: 'This photo has already been read' }, 409)

  let photo: string
  if (typeof imageBase64 === 'string' && imageBase64) {
    // One photo per theme: no retakes
    if (theme.photo_path) return json({ error: 'This theme already has its photo' }, 409)
    photo = imageBase64
    const path = `${auth.user.id}/theme-${themeId}.jpg`
    const upload = await supabase.storage.from('todo-lists').upload(path, decodeBase64(photo), { contentType: 'image/jpeg' })
    if (upload.error) return json({ error: upload.error.message }, 500)
    const saved = await supabase.from('cass_themes').update({ photo_path: path }).eq('id', themeId)
    if (saved.error) return json({ error: saved.error.message }, 500)
  } else if (theme.photo_path) {
    // The photo was saved but reading it failed last time
    const download = await supabase.storage.from('todo-lists').download(theme.photo_path)
    if (download.error) return json({ error: download.error.message }, 500)
    photo = encodeBase64(new Uint8Array(await download.data.arrayBuffer()))
  } else {
    return json({ error: 'Take a photo of the list first' }, 400)
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  // fallbacks "default": if a safety check declines, the API retries on a fallback model
  const params = {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photo } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  }
  let todos: string[]
  try {
    // deno-lint-ignore no-explicit-any
    const message = await anthropic.beta.messages.create(params as any)
    if (message.stop_reason === 'refusal') return json({ error: 'The photo could not be read' }, 422)
    const text = message.content.find((b) => b.type === 'text')
    todos = cleanTranscribed(JSON.parse(text && 'text' in text ? text.text : '{}').todos ?? [])
  } catch (e) {
    console.error('transcribe failed', e)
    return json({ error: 'Reading the photo failed; try again' }, 502)
  }

  // The app places them as todos (placeSteps in src/schedule.ts), then sets photo_read_at
  return json({ todos })
})
