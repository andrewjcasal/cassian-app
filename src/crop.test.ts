import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampView, cropOf, thumbLayout, viewOf } from './crop.ts'

const photo = { w: 3024, h: 4032 }
const frame = { w: 340, h: 260 }
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`)

test('at zoom 1, centered, the frame shows a full width band from the middle of a tall photo', () => {
  const crop = cropOf({ zoom: 1, tx: 0, ty: 0 }, photo, frame)
  near(crop.x, 0)
  near(crop.w, 1)
  near(crop.y + crop.h / 2, 0.5)
})

test('the frame never runs off the photo, and zoom stays from 1 to the max', () => {
  const v = clampView({ zoom: 0.5, tx: 5000, ty: -5000 }, photo, frame)
  assert.equal(v.zoom, 1)
  const crop = cropOf(v, photo, frame)
  near(crop.x, 0)
  assert.ok(crop.y + crop.h <= 1 + 1e-9 && crop.y >= -1e-9)
})

test('opening the editor on a saved crop shows the same crop', () => {
  const crop = cropOf(clampView({ zoom: 2.5, tx: 120, ty: -300 }, photo, frame), photo, frame)
  const again = cropOf(viewOf(crop, photo, frame), photo, frame)
  for (const k of ['x', 'y', 'w', 'h'] as const) near(again[k], crop[k])
})

test('the thumbnail draws the photo so its box shows exactly the crop', () => {
  const t = thumbLayout({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { w: 300, h: 100 })
  assert.deepEqual(t, { width: 600, height: 400, left: -150, top: -200 })
})
