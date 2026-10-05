// Reads a photo of a paper todo list into a Todo List's items.
// POST { list_id, image_base64? } with the user's session. With a photo it's
// saved to the todo-lists bucket first; without one, the list's saved photo is
// read again. The list's items are replaced by what Claude reads off the page.
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

  const { list_id: listId, image_base64: imageBase64 } = await req.json().catch(() => ({}))
  if (typeof listId !== 'string') return json({ error: 'list_id is required' }, 400)
  const { data: list } = await supabase.from('cass_todo_lists').select('id,photo_path').eq('id', listId).maybeSingle()
  if (!list) return json({ error: 'That list was not found' }, 404)

  let photo: string
  if (typeof imageBase64 === 'string' && imageBase64) {
    photo = imageBase64
    const path = `${auth.user.id}/${listId}.jpg`
    const upload = await supabase.storage
      .from('todo-lists')
      .upload(path, decodeBase64(photo), { contentType: 'image/jpeg', upsert: true })
    if (upload.error) return json({ error: upload.error.message }, 500)
    const saved = await supabase.from('cass_todo_lists').update({ photo_path: path }).eq('id', listId)
    if (saved.error) return json({ error: saved.error.message }, 500)
  } else if (list.photo_path) {
    const download = await supabase.storage.from('todo-lists').download(list.photo_path)
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

  // A retake replaces the list's todos
  const cleared = await supabase.from('cass_todo_list_items').delete().eq('list_id', listId)
  if (cleared.error) return json({ error: cleared.error.message }, 500)
  if (todos.length) {
    const inserted = await supabase
      .from('cass_todo_list_items')
      .insert(todos.map((title, sort_order) => ({ list_id: listId, title, sort_order })))
    if (inserted.error) return json({ error: inserted.error.message }, 500)
  }
  await supabase.from('cass_todo_lists').update({ transcribed_at: new Date().toISOString() }).eq('id', listId)
  return json({ count: todos.length })
})
