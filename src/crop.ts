// Reposition thumbnail: a photo zoomed and moved behind a fixed frame the shape of
// the theme page's thumbnail. Pure math, so it's tested without the screen.
// Sizes are { w, h } in points; a crop is the part of the photo the frame shows,
// as fractions of the photo ({ x, y, w, h }, all 0 to 1).

export type Size = { w: number; h: number }
export type Crop = { x: number; y: number; w: number; h: number }
// zoom 1 = the photo just covers the frame; tx, ty = the photo's center from the frame's
export type View = { zoom: number; tx: number; ty: number }

export const MAX_ZOOM = 8

// The photo's shown size at a zoom: at 1 it covers the frame edge to edge
export function shownSize(photo: Size, frame: Size, zoom: number): Size {
  const cover = Math.max(frame.w / photo.w, frame.h / photo.h)
  return { w: photo.w * cover * zoom, h: photo.h * cover * zoom }
}

// Keeps the zoom in range and the frame inside the photo, so no empty edge shows
export function clampView(view: View, photo: Size, frame: Size): View {
  const zoom = Math.min(Math.max(view.zoom, 1), MAX_ZOOM)
  const shown = shownSize(photo, frame, zoom)
  const maxX = Math.max(0, (shown.w - frame.w) / 2)
  const maxY = Math.max(0, (shown.h - frame.h) / 2)
  return { zoom, tx: Math.min(Math.max(view.tx, -maxX), maxX), ty: Math.min(Math.max(view.ty, -maxY), maxY) }
}

// What the frame shows, as fractions of the photo
export function cropOf(view: View, photo: Size, frame: Size): Crop {
  const shown = shownSize(photo, frame, view.zoom)
  const left = frame.w / 2 + view.tx - shown.w / 2
  const top = frame.h / 2 + view.ty - shown.h / 2
  return { x: -left / shown.w, y: -top / shown.h, w: frame.w / shown.w, h: frame.h / shown.h }
}

// The reverse, to open the editor on the saved crop
export function viewOf(crop: Crop, photo: Size, frame: Size): View {
  const base = shownSize(photo, frame, 1)
  const zoom = frame.w / crop.w / base.w
  const shown = shownSize(photo, frame, zoom)
  return clampView(
    { zoom, tx: -crop.x * shown.w + shown.w / 2 - frame.w / 2, ty: -crop.y * shown.h + shown.h / 2 - frame.h / 2 },
    photo,
    frame,
  )
}

// How to draw the photo inside a thumbnail box so the box shows exactly the crop
export function thumbLayout(crop: Crop, box: Size) {
  const width = box.w / crop.w
  const height = box.h / crop.h
  return { width, height, left: -crop.x * width, top: -crop.y * height }
}
