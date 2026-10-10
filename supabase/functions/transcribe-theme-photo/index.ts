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

// Limits that keep one account from running up the Anthropic bill
const MAX_BASE64_CHARS = 7_000_000 // about 5 MB of JPEG, the most the API reads
const MAX_READS_PER_THEME = 3
const MAX_READS_PER_DAY = 15
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  // The project is shared with other apps that allow anonymous sign-in; this one never does
  if (auth.user.is_anonymous) return json({ error: 'Sign in with your account' }, 403)

  const { theme_id: themeId, image_base64: imageBase64 } = await req.json().catch(() => ({}))
  if (typeof themeId !== 'string' || !UUID.test(themeId)) return json({ error: 'theme_id is required' }, 400)
  if (imageBase64 !== undefined && typeof imageBase64 !== 'string') return json({ error: 'image_base64 must be a string' }, 400)
  if (typeof imageBase64 === 'string' && imageBase64.length > MAX_BASE64_CHARS) return json({ error: 'That photo is too large' }, 413)
  const { data: theme } = await supabase.from('cass_themes').select('id,photo_path,photo_read_at').eq('id', themeId).maybeSingle()
  if (!theme) return json({ error: 'That theme was not found' }, 404)
  if (theme.photo_read_at) return json({ error: 'This photo has already been read' }, 409)

  let photo: string
  if (typeof imageBase64 === 'string' && imageBase64) {
    // One photo per theme: no retakes
    if (theme.photo_path) return json({ error: 'This theme already has its photo' }, 409)
    photo = imageBase64
    let bytes: Uint8Array
    try {
      bytes = decodeBase64(photo)
    } catch {
      return json({ error: 'That is not a valid photo' }, 400)
    }
    // JPEG files start FF D8 FF
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return json({ error: 'The photo must be a JPEG' }, 415)
    }
    const path = `${auth.user.id}/theme-${themeId}.jpg`
    const upload = await supabase.storage.from('todo-lists').upload(path, bytes, { contentType: 'image/jpeg' })
    if (upload.error) { console.error('upload failed', upload.error); return json({ error: 'Saving the photo failed; try again' }, 500) }
    const saved = await supabase.from('cass_themes').update({ photo_path: path }).eq('id', themeId)
    if (saved.error) { console.error('save failed', saved.error); return json({ error: 'Saving the photo failed; try again' }, 500) }
  } else if (theme.photo_path) {
    // The photo was saved but reading it failed last time
    const download = await supabase.storage.from('todo-lists').download(theme.photo_path)
    if (download.error) { console.error('download failed', download.error); return json({ error: 'Reading the saved photo failed; try again' }, 500) }
    photo = encodeBase64(new Uint8Array(await download.data.arrayBuffer()))
  } else {
    return json({ error: 'Take a photo of the list first' }, 400)
  }

  // Count this read before paying for it. The ledger table has no write grants for
  // users, so only the service role can add rows and a user can't reset their own count.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const [perTheme, perDay] = await Promise.all([
    admin.from('cass_photo_reads').select('id', { count: 'exact', head: true }).eq('theme_id', themeId),
    admin.from('cass_photo_reads').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id).gte('created_at', since),
  ])
  if (perTheme.error || perDay.error) return json({ error: 'Reading the photo failed; try again' }, 502)
  if ((perTheme.count ?? 0) >= MAX_READS_PER_THEME) return json({ error: 'This photo has been read too many times' }, 429)
  if ((perDay.count ?? 0) >= MAX_READS_PER_DAY) return json({ error: 'Too many photos today; try again tomorrow' }, 429)
  const logged = await admin.from('cass_photo_reads').insert({ user_id: auth.user.id, theme_id: themeId })
  if (logged.error) return json({ error: 'Reading the photo failed; try again' }, 502)

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  // fallbacks "default": if a safety check declines, the API retries on a fallback model
  const params = {
    model: 'claude-opus-5-5',
    max_tokens: 4000,
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
