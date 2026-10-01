import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chipSpan, codeChipName, codePreview, detectCaret, normalizeSelection, packQuoteRef, previewLabel, quoteWire, readQuoteWire, unpackQuoteRef } from '../lib/quote-logic.js'

test('normalizeSelection keeps indentation and converts CRLF', () => {
  assert.equal(normalizeSelection('  a\r\nb\rc'), '  a\nb\nc')
})

test('previewLabel collapses whitespace and marks code', () => {
  assert.equal(previewLabel('hello   world', { code: false }), 'hello world')
  assert.equal(previewLabel('const x = 1', { code: true, language: 'ts' }), 'ts \u00b7 const x = 1')
  assert.equal(previewLabel('const x = 1', { code: true }), 'code \u00b7 const x = 1')
  const long = 'abcdefghijklmnopqrstuvwxyz'
  assert.equal(previewLabel(long, { code: false }), 'abcdefghijklmnopqrstuvwx\u2026')
})

test('detectCaret counts each chip as one detect character', () => {
  assert.deepEqual(detectCaret({ draft: 'abc', draftRev: 2, occurrences: [] }), {
    start: 3,
    end: 3,
    draftRev: 2,
  })
  assert.deepEqual(detectCaret({
    draft: 'hi' + 'abcdefghij',
    draftRev: 4,
    occurrences: [{ length: 10 }],
  }), { start: 3, end: 3, draftRev: 4 })
  assert.deepEqual(detectCaret({
    draft: 'abcd' + 'wxyz',
    draftRev: 1,
    occurrences: [{ length: 4 }, { length: 4 }],
  }), { start: 2, end: 2, draftRev: 1 })
})

test('detectCaret refuses a snapshot that cannot be mapped', () => {
  assert.equal(detectCaret(null), null)
  assert.equal(detectCaret({ draft: 'a', draftRev: 1 }), null)
  assert.equal(detectCaret({ draft: 'a', draftRev: '1', occurrences: [] }), null)
  assert.equal(detectCaret({ draft: 'a', draftRev: 1, occurrences: [{}] }), null)
  assert.equal(detectCaret({ draft: 'a', draftRev: 1, occurrences: [{ length: 10 }] }), null)
})

test('chipSpan maps a chip index to the detect range insertText deletes', () => {
  const quote = { source: 'add-to-chat', offset: 2, length: 10 }
  assert.deepEqual(chipSpan({
    draft: 'hi' + 'abcdefghij' + ' ',
    draftRev: 3,
    occurrences: [quote],
  }, 0, 'add-to-chat'), { start: 2, end: 4, draftRev: 3 })
  assert.deepEqual(chipSpan({
    draft: 'hi' + 'abcdefghij' + 'x' + 'wxyz',
    draftRev: 1,
    occurrences: [quote, { source: 'add-to-chat', offset: 13, length: 4 }],
  }, 1, 'add-to-chat'), { start: 4, end: 5, draftRev: 1 })
  assert.equal(chipSpan({
    draft: 'hi' + 'abcdefghij',
    draftRev: 1,
    occurrences: [{ source: 'reference', offset: 2, length: 10 }],
  }, 0, 'add-to-chat'), null)
  assert.equal(chipSpan({ draft: 'hi', draftRev: 1, occurrences: [] }, 0, 'add-to-chat'), null)
})

test('quote wire keeps the short label and the full selection', () => {
  const text = 'line "a"\nline/b'
  const label = 'ts · line "a"'
  const wire = quoteWire(text, label)
  assert.deepEqual(readQuoteWire(wire, 0), { label, text, end: wire.length, code: false })
  assert.equal(readQuoteWire('xx' + wire, 2)?.text, text)
  assert.equal(readQuoteWire('nope', 0), null)
  assert.deepEqual(unpackQuoteRef(packQuoteRef(text, label)), { label, text })
  assert.equal(unpackQuoteRef(text), null)
})

test('code wire keeps a short hover preview separate from the chip name', () => {
  const text = 'int a = 1\n' + 'b'.repeat(81) + '\n' + 'c\n'.repeat(8)
  const label = 'cpp \u00b7 int a = 1'
  const wire = quoteWire(text, label, true)
  assert.equal(wire.includes(' k="c"'), true)
  assert.deepEqual(readQuoteWire(wire, 0), { label, text, end: wire.length, code: true })
  assert.equal(codeChipName(label), 'cpp')
  assert.equal(codeChipName('code \u00b7 x'), 'code')
  assert.equal(codeChipName('名字'), null)
  const preview = codePreview(text)
  assert.equal(preview.split('\n')[0], 'int a = 1')
  assert.equal(preview.split('\n')[1], 'b'.repeat(80) + '\u2026')
  assert.equal(preview.endsWith('\n\u2026'), true)
})

test('client.js keeps the same helper bodies as quote-logic.js', () => {
  const logic = readFileSync(new URL('../lib/quote-logic.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const name of ['normalizeSelection', 'previewLabel', 'detectCaret', 'chipSpan', 'packQuoteRef', 'unpackQuoteRef', 'quoteWire', 'readQuoteWire', 'codeChipName', 'codePreview']) {
    assert.equal(flatten(extractFunction(client, name)), flatten(extractFunction(logic, name)), name)
  }
})

/** Source of one function declaration, from its name through the matching closing brace. */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name)
  assert.notEqual(start, -1, name)
  let depth = 0
  let seen = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') {
      depth += 1
      seen = true
    } else if (ch === '}') {
      depth -= 1
      if (seen && depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error('unclosed ' + name)
}

function flatten(source) {
  return source.replace(/\s+/g, ' ').trim()
}
