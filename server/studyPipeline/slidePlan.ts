export interface SlidePlanItem {
  title: string
  bullets: string[]
  durationSec: number
}

/**
 * Deterministically splits narration text into slides (one per paragraph,
 * capped at ~4 bullets each) and allocates narration duration proportional to
 * each slide's share of the total word count. Used by both the slides stage
 * (pptx) and the video-render stage (per-slide image timing), so both must
 * derive the exact same plan from the same input text.
 */
export function buildSlidePlan(text: string, totalDurationSec: number): SlidePlanItem[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks = paragraphs.length > 0 ? paragraphs : [text.trim() || 'Untitled']
  const wordCounts = chunks.map((c) => c.split(/\s+/).filter(Boolean).length)
  const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1

  return chunks.map((chunk, i) => {
    const sentences = chunk.split(/(?<=[.!?])\s+/).filter(Boolean)
    const title = sentences[0]?.slice(0, 80) ?? `Slide ${i + 1}`
    const bullets = sentences.slice(1, 5)
    const share = wordCounts[i] / totalWords
    const durationSec = Math.max(3, Math.round(totalDurationSec * share))
    return { title, bullets, durationSec }
  })
}
