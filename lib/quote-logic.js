/** Chip label length before the ellipsis. Display only; the stored quote stays intact. */
const PREVIEW_LIMIT = 24

/**
 * Normalize a browser selection to LF newlines.
 * Indentation and trailing spaces stay, so a partial code selection is not rewritten.
 * @param {string} text `Selection.toString()` result.
 * @returns {string}
 */
export function normalizeSelection(text) {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Short label for the composer chip. Whitespace is collapsed for the label only.
 * @param {string} text Normalized selection. Not empty after trim.
 * @param {{ code: boolean, language?: string }} kind `code` when the whole selection sits in a code block.
 * @returns {string}
 */
export function previewLabel(text, kind) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const head = flat.length > PREVIEW_LIMIT ? flat.slice(0, PREVIEW_LIMIT) + '\u2026' : flat
  if (kind.code && typeof kind.language === 'string' && kind.language !== '') return kind.language + ' \u00b7 ' + head
  if (kind.code) return 'code \u00b7 ' + head
  return head
}

/**
 * Caret at the end of the draft, in detect coordinates.
 * On ui-conversation 0.2.0-rc.2 each reference chip is one detect character
 * and `occurrence.length` clipboard characters. The published snapshot has
 * `draft`, `draftRev`, and `occurrences`, and does not include the caret.
 * @param {unknown} snapshot Input snapshot from `useInput`.
 * @returns {{ start: number, end: number, draftRev: number } | null} Null when a required field is missing or the math would land before 0.
 */
export function detectCaret(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  const draft = snapshot.draft
  const draftRev = snapshot.draftRev
  const occurrences = snapshot.occurrences
  if (typeof draft !== 'string' || typeof draftRev !== 'number' || !Array.isArray(occurrences)) return null
  let shrink = 0
  for (const occ of occurrences) {
    if (occ === null || typeof occ !== 'object' || typeof occ.length !== 'number') return null
    shrink += occ.length - 1
  }
  const end = draft.length - shrink
  if (end < 0) return null
  return { start: end, end, draftRev }
}

/**
 * Detect span that `insertText('', span)` deletes for one reference chip.
 * `index` is that chip's place among every reference chip in document order
 * (`occurrences`, and `[data-composer-chip]` inside the composer).
 * A single space immediately after the chip is included, unless that character
 * is the next chip's clipboard text.
 * @param {unknown} snapshot Input snapshot from `useInput`.
 * @param {number} index Chip index in `occurrences`.
 * @param {string} source Only this chip source is removable.
 * @returns {{ start: number, end: number, draftRev: number } | null}
 */
export function chipSpan(snapshot, index, source) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  if (!Number.isInteger(index) || index < 0) return null
  const draft = snapshot.draft
  const draftRev = snapshot.draftRev
  const occurrences = snapshot.occurrences
  if (typeof draft !== 'string' || typeof draftRev !== 'number' || !Array.isArray(occurrences)) return null
  if (index >= occurrences.length) return null
  let shrink = 0
  for (let i = 0; i < index; i++) {
    const prev = occurrences[i]
    if (prev === null || typeof prev !== 'object' || typeof prev.length !== 'number' || typeof prev.offset !== 'number') return null
    shrink += prev.length - 1
  }
  const occ = occurrences[index]
  if (occ === null || typeof occ !== 'object' || occ.source !== source) return null
  if (typeof occ.length !== 'number' || typeof occ.offset !== 'number') return null
  const start = occ.offset - shrink
  if (start < 0) return null
  let end = start + 1
  const boundary = occ.offset + occ.length
  const next = occurrences[index + 1]
  const nextIsChip = next !== undefined && next !== null && typeof next === 'object' && typeof next.offset === 'number' && next.offset === boundary
  if (!nextIsChip && draft.charAt(boundary) === ' ') end += 1
  return { start, end, draftRev }
}

/**
 * Pack the label into the reference id. `serialize` reads it back.
 * The label has no newlines; the selection text may.
 * @param {string} text Full selection.
 * @param {string} label Chip label from `previewLabel`.
 * @returns {string}
 */
export function packQuoteRef(text, label) {
  return 'dsh-quote-v1\n' + label + '\n' + text
}

/**
 * Split a packed reference id. Plain text from older chips returns null.
 * @param {string} ref Reference id stored on the chip.
 * @returns {{ label: string, text: string } | null}
 */
export function unpackQuoteRef(ref) {
  const prefix = 'dsh-quote-v1\n'
  if (!ref.startsWith(prefix)) return null
  const rest = ref.slice(prefix.length)
  const nl = rest.indexOf('\n')
  if (nl < 0) return null
  return { label: rest.slice(0, nl), text: rest.slice(nl + 1) }
}

/**
 * Model text for one quote. The transcript shows this string; the client
 * replaces a well-formed wire with the same short chip the composer shows.
 * Lengths are UTF-16 code units, matching `String.slice`.
 * @param {string} text Full selection.
 * @param {string} label Chip label.
 * @param {boolean} [code] True when the selection came from a code block.
 * @returns {string}
 */
export function quoteWire(text, label, code) {
  const flag = code === true ? ' k="c"' : ''
  return '<dsh-quote l="' + label.length + '" n="' + text.length + '"' + flag + '>' + label + text + '</dsh-quote>'
}

/**
 * Read one wire starting at `index`.
 * @param {string} source
 * @param {number} index
 * @returns {{ label: string, text: string, end: number, code: boolean } | null} `end` is the index after the wire.
 */
export function readQuoteWire(source, index) {
  const open = '<dsh-quote l="'
  if (source.slice(index, index + open.length) !== open) return null
  let i = index + open.length
  const lEnd = source.indexOf('"', i)
  if (lEnd < 0) return null
  const lRaw = source.slice(i, lEnd)
  if (!/^\d+$/.test(lRaw)) return null
  if (source.slice(lEnd, lEnd + 5) !== '" n="') return null
  i = lEnd + 5
  const nEnd = source.indexOf('"', i)
  if (nEnd < 0) return null
  const nRaw = source.slice(i, nEnd)
  if (!/^\d+$/.test(nRaw)) return null
  let code = false
  let bodyAt = nEnd + 2
  if (source.slice(nEnd, nEnd + 2) === '">') {
    bodyAt = nEnd + 2
  } else if (source.slice(nEnd, nEnd + 8) === '" k="c">') {
    code = true
    bodyAt = nEnd + 8
  } else {
    return null
  }
  const labelLen = Number(lRaw)
  const textLen = Number(nRaw)
  const label = source.slice(bodyAt, bodyAt + labelLen)
  const text = source.slice(bodyAt + labelLen, bodyAt + labelLen + textLen)
  const closeAt = bodyAt + labelLen + textLen
  if (label.length !== labelLen || text.length !== textLen) return null
  if (source.slice(closeAt, closeAt + '</dsh-quote>'.length) !== '</dsh-quote>') return null
  return { label, text, end: closeAt + '</dsh-quote>'.length, code }
}

/**
 * Language token on a code chip label, or null when the label is prose.
 * `previewLabel` writes code labels as `lang · head`.
 * @param {string} label
 * @returns {string | null}
 */
export function codeChipName(label) {
  const mark = ' \u00b7 '
  const at = label.indexOf(mark)
  if (at <= 0) return null
  const name = label.slice(0, at)
  if (name !== 'code' && !/^[\w+-]+$/.test(name)) return null
  return name
}

/**
 * Hover preview for a code quote. A few lines, each capped, so the transcript stays a chip.
 * @param {string} text Full selection.
 * @returns {string}
 */
export function codePreview(text) {
  const lines = text.split('\n')
  const shown = lines.slice(0, 8).map((line) => line.length > 80 ? line.slice(0, 80) + '\u2026' : line)
  if (lines.length > 8) shown.push('\u2026')
  return shown.join('\n')
}
