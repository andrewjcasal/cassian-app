// Shared by the transcribe-todo-list function and the app's tests (npm test).

// Bullets, checkboxes and list numbers written in front of a todo on paper
const MARKER = /^(?:[-*•·–—]\s+|\[[\sxX✓✔]?\]\s*|[☐☑✓✔]\s*|\d+[.)]\s+)/

// The todos read off a photo, as the app stores them: markers stripped, blank
// lines and repeats (ignoring case) dropped, in the order they were written.
export function cleanTranscribed(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    let text = line.trim()
    // "- [ ] Milk" carries two markers
    for (let i = 0; i < 2 && MARKER.test(text); i++) text = text.replace(MARKER, '').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}
