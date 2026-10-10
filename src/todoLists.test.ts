/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTranscribed } from '../supabase/functions/_shared/todoLists.ts'

test('Transcribed todos lose the bullets, boxes and numbers written on the paper', () => {
  assert.deepEqual(cleanTranscribed(['- Call the dentist', '• Groceries', '[ ] Cable organizing', '[x] Laundry', '2. Pay rent', '3) Email a client']), [
    'Call the dentist',
    'Groceries',
    'Cable organizing',
    'Laundry',
    'Pay rent',
    'Email a client',
  ])
})

test('Blank lines and repeats are dropped, and the order on the page is kept', () => {
  assert.deepEqual(cleanTranscribed(['  Milk ', '', '   ', 'Eggs', 'milk', 'Bread']), ['Milk', 'Eggs', 'Bread'])
})

test('A number that is part of the todo stays', () => {
  assert.deepEqual(cleanTranscribed(['3 bags of mulch', '10am dentist']), ['3 bags of mulch', '10am dentist'])
})
