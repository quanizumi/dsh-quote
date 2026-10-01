/**
 * Add to Chat browser face for DeepSeek Harness 0.2.0-rc.2.
 * Selecting text in a conversation message shows a button; the click appends
 * one reference chip. The chip label is short. Submit serializes `ref`, which
 * is the full selection.
 *
 * Checked against this build:
 * - `inputTriggers.registerSource` owns the chip. `codec.serialize(ref, signal)`
 *   is what the model receives. A missing codec rejects the send.
 * - `sessions.scope(sessionId).bail(..., "slash/input-insert-reference", { reference, span })`
 *   is the same insert the @ picker uses. `span` is detect coordinates plus `draftRev`.
 * - `conversation.input.dock` is session-scoped and receives `useInput` and `sessionId`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-add-to-chat',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const SOURCE = 'add-to-chat'
    /** Not `@` or `/`, so this source never joins those menus. Serialization looks up the source by name. */
    const TRIGGER = '\uE000'
    /** Set while the plugin is applied. The dock component closes over this, not over `apply`'s locals. */
    let sessionsApi = null
    const PREVIEW_LIMIT = 24

    function normalizeSelection(text) {
      return text.replace(/\r\n?/g, '\n')
    }

    function previewLabel(text, kind) {
      const flat = text.replace(/\s+/g, ' ').trim()
      const head = flat.length > PREVIEW_LIMIT ? flat.slice(0, PREVIEW_LIMIT) + '\u2026' : flat
      if (kind.code && typeof kind.language === 'string' && kind.language !== '') return kind.language + ' \u00b7 ' + head
      if (kind.code) return 'code \u00b7 ' + head
      return head
    }

    function detectCaret(snapshot) {
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

    function chipSpan(snapshot, index, source) {
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

    function packQuoteRef(text, label) {
      return 'dsh-quote-v1\n' + label + '\n' + text
    }

    function unpackQuoteRef(ref) {
      const prefix = 'dsh-quote-v1\n'
      if (!ref.startsWith(prefix)) return null
      const rest = ref.slice(prefix.length)
      const nl = rest.indexOf('\n')
      if (nl < 0) return null
      return { label: rest.slice(0, nl), text: rest.slice(nl + 1) }
    }

    function quoteWire(text, label, code) {
      const flag = code === true ? ' k="c"' : ''
      return '<dsh-quote l="' + label.length + '" n="' + text.length + '"' + flag + '>' + label + text + '</dsh-quote>'
    }

    function readQuoteWire(source, index) {
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

    function codeChipName(label) {
      const mark = ' \u00b7 '
      const at = label.indexOf(mark)
      if (at <= 0) return null
      const name = label.slice(0, at)
      if (name !== 'code' && !/^[\w+-]+$/.test(name)) return null
      return name
    }

    function codePreview(text) {
      const lines = text.split('\n')
      const shown = lines.slice(0, 8).map((line) => line.length > 80 ? line.slice(0, 80) + '\u2026' : line)
      if (lines.length > 8) shown.push('\u2026')
      return shown.join('\n')
    }

    const BUTTON_CSS = [
      '.dsh-add-to-chat {',
      '  position: fixed;',
      '  z-index: 80;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  height: 28px;',
      '  padding: 0 10px 0 8px;',
      '  border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 8px;',
      '  background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-primary);',
      '  font-family: var(--dsw-font-family);',
      '  font-size: 12px;',
      '  line-height: 1;',
      '  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);',
      '  cursor: pointer;',
      '  user-select: none;',
      '}',
      '.dsh-add-to-chat:hover {',
      '  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08), inset 0 0 0 999px var(--dsw-alias-interactive-bg-hover);',
      '}',
      '.dsh-add-to-chat svg { display: block; }',
      '[data-composer-seat] [data-composer-chip="add-to-chat"] > span::before {',
      '  content: "\\00d7";',
      '  display: none;',
      '  align-items: center;',
      '  justify-content: center;',
      '  align-self: center;',
      '  flex: none;',
      '  width: 16px;',
      '  height: 16px;',
      '  margin-right: 2px;',
      '  border-radius: 999px;',
      '  color: var(--dsw-alias-state-business-primary);',
      '  font-size: 14px;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '}',
      '[data-composer-seat] [data-composer-chip="add-to-chat"]:hover > span::before {',
      '  display: inline-flex;',
      '}',
      '[data-composer-seat] [data-composer-chip="add-to-chat"] > span > span[aria-hidden="true"] {',
      '  display: none;',
      '}',
      '.dsh-add-to-chat-sent {',
      '  display: inline;',
      '  position: relative;',
      '  padding: 0 4px;',
      '  border-radius: var(--dsw-radius-sm);',
      '  line-height: inherit;',
      '  vertical-align: baseline;',
      '  color: var(--dsw-alias-state-business-primary);',
      '  font-weight: 500;',
      '  white-space: nowrap;',
      '  user-select: none;',
      '}',
      '.dsh-add-to-chat-sent:hover { background: var(--dsw-alias-state-business-tertiary); }',
      '.dsh-add-to-chat-preview {',
      '  display: none;',
      '  position: absolute;',
      '  z-index: 30;',
      '  right: 0;',
      '  bottom: calc(100% + 4px);',
      '  width: max-content;',
      '  max-width: 420px;',
      '  max-height: 180px;',
      '  overflow: auto;',
      '  padding: 8px 10px;',
      '  border: 1px solid var(--dsw-alias-border-l2);',
      '  border-radius: 8px;',
      '  background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-primary);',
      '  font-weight: 400;',
      '  font-family: var(--dsw-font-family-code, ui-monospace, monospace);',
      '  font-size: 12px;',
      '  line-height: 1.45;',
      '  white-space: pre;',
      '  text-align: left;',
      '  pointer-events: none;',
      '  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08);',
      '}',
      '.dsh-add-to-chat-sent:hover .dsh-add-to-chat-preview,',
      '.dsh-add-to-chat-sent:focus-visible .dsh-add-to-chat-preview { display: block; }',
    ].join('\n')

    function ensureStyle() {
      let tag = document.querySelector('style[data-plugin="dsh-add-to-chat"]')
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-add-to-chat'
        document.head.appendChild(tag)
      }
      if (tag.textContent !== BUTTON_CSS) tag.textContent = BUTTON_CSS
    }

    /** Button copy follows the document language. Chinese UI says 添加到对话. */
    function buttonLabel() {
      const lang = (document.documentElement.lang || '').toLowerCase()
      return lang.startsWith('zh') ? '\u6dfb\u52a0\u5230\u5bf9\u8bdd' : 'Add to Chat'
    }

    /**
     * Element that contains a selection endpoint.
     * @param {Node} node
     * @returns {Element | null}
     */
    function elementOf(node) {
      if (node.nodeType === 1) return /** @type {Element} */ (node)
      return node.parentElement
    }

    /**
     * Whether this range is a quoteable message selection.
     * The composer and this button are excluded. At least one end must sit in a message row.
     * @param {Range} range
     * @returns {boolean}
     */
    function inTranscript(range) {
      const root = elementOf(range.commonAncestorContainer)
      if (root === null) return false
      if (root.closest('[data-composer-seat]') !== null) return false
      if (root.closest('[data-add-to-chat]') !== null) return false
      if (root.closest('[data-conversation-scroll]') === null) return false
      const start = elementOf(range.startContainer)
      const end = elementOf(range.endContainer)
      const inMessage = (el) => el !== null && el.closest('[data-chat-anchor-key]') !== null
      return inMessage(start) || inMessage(end)
    }

    /**
     * Code-block kind for a selection whose common ancestor is inside the code body.
     * Language comes only from a `language-*` class on the block's `code` element.
     * @param {Range} range
     * @returns {{ code: boolean, language?: string }}
     */
    function codeKind(range) {
      const el = elementOf(range.commonAncestorContainer)
      if (el === null) return { code: false }
      const content = el.closest('[data-code-block-content]')
      if (content === null) return { code: false }
      const coded = content.querySelector('code')
      const className = coded !== null && typeof coded.className === 'string' ? coded.className : ''
      const match = /(?:^|\s)language-([\w+-]+)/.exec(className)
      if (match !== null) return { code: true, language: match[1] }
      return { code: true }
    }

    /** First visible client rect of a range, or null when the selection has no box. */
    function firstRect(range) {
      const rects = range.getClientRects()
      for (const rect of rects) {
        if (rect.width > 0 || rect.height > 0) return rect
      }
      const box = range.getBoundingClientRect()
      if (box.width > 0 || box.height > 0) return box
      return null
    }

    function focusComposer() {
      const root = document.querySelector('[data-composer-seat] [contenteditable="true"]')
      if (root instanceof HTMLElement) root.focus()
    }

    /**
     * Session-scoped mount. Owns the selection button and inserts one chip per click.
     * @param {{ sessionId: string, useInput: (select: (state: object) => object) => object }} props
     */
    function AddToChatMount(props) {
      const snapshot = props.useInput((state) => state)
      const snapRef = React.useRef(snapshot)
      const actionsRef = React.useRef(props.inputActions)
      actionsRef.current = props.inputActions
      React.useEffect(() => {
        snapRef.current = snapshot
      }, [snapshot])

      React.useEffect(() => {
        const sessionId = props.sessionId
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        ensureStyle()
        let button = null
        let dragging = false
        let raf = 0
        /** Selection captured for the visible button. Kept off the DOM so a long quote is not an attribute. */
        let pending = null

        const hide = () => {
          pending = null
          if (button !== null) {
            button.remove()
            button = null
          }
        }

        /**
         * Append the selection as one chip at the detect-end of the draft.
         * @param {string} text Normalized selection.
         * @param {{ code: boolean, language?: string }} kind
         * @returns {boolean}
         */
        const insertQuote = (text, kind) => {
          const span = detectCaret(snapRef.current)
          if (span === null || sessionsApi === null) return false
          const actx = sessionsApi.scope(sessionId)
          if (actx === undefined) return false
          const applied = actx.bail(actx, 'slash/input-insert-reference', {
            reference: {
              source: SOURCE,
              ref: packQuoteRef(text, previewLabel(text, kind)),
              label: previewLabel(text, kind),
              clipboardText: text,
            },
            span,
          })
          return applied === true
        }

        const show = () => {
          raf = 0
          if (dragging) return
          const selection = window.getSelection()
          if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
            hide()
            return
          }
          const range = selection.getRangeAt(0)
          if (!inTranscript(range)) {
            hide()
            return
          }
          const text = normalizeSelection(selection.toString())
          if (text.trim() === '') {
            hide()
            return
          }
          const rect = firstRect(range)
          if (rect === null) {
            hide()
            return
          }
          const host = elementOf(range.commonAncestorContainer)
          if (host === null) {
            hide()
            return
          }
          const scroll = host.closest('[data-conversation-scroll]')
          const bounds = scroll === null ? null : scroll.getBoundingClientRect()
          if (bounds !== null && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) {
            hide()
            return
          }
          const kind = codeKind(range)
          if (button === null) {
            button = document.createElement('button')
            button.type = 'button'
            button.className = 'dsh-add-to-chat'
            button.setAttribute('data-add-to-chat', '')
            button.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path fill="currentColor" d="M2 2.5h10a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H6.2L3.4 12v-2.3H2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"/></svg><span></span>'
            button.addEventListener('mousedown', (event) => {
              event.preventDefault()
              event.stopPropagation()
            })
            button.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              const quoted = pending
              if (quoted === null || quoted.text.trim() === '') return
              const applied = insertQuote(quoted.text, quoted.kind)
              if (!applied) return
              hide()
              const live = window.getSelection()
              if (live !== null) live.removeAllRanges()
              requestAnimationFrame(focusComposer)
            })
            document.body.appendChild(button)
          }
          const label = button.querySelector('span')
          if (label !== null) label.textContent = buttonLabel()
          pending = { text, kind }
          const width = 148
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
          const top = Math.max(8, rect.top - 36)
          button.style.left = left + 'px'
          button.style.top = top + 'px'
        }

        const schedule = () => {
          if (raf !== 0) cancelAnimationFrame(raf)
          raf = requestAnimationFrame(show)
        }

        /**
         * Remove the quote chip whose × was pressed.
         * The × is a ::before inside the blue chip span, at its left, and only while hovered.
         * @param {PointerEvent} event
         * @returns {boolean} Whether this press was on that ×.
         */
        const dismissChip = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return false
          const host = target.closest('[data-composer-chip="add-to-chat"]')
          if (host === null) return false
          const chip = host.querySelector(':scope > span')
          if (chip === null) return false
          if (getComputedStyle(chip, '::before').display === 'none') return false
          const rect = chip.getBoundingClientRect()
          if (event.clientX > rect.left + 20) return false
          event.preventDefault()
          event.stopPropagation()
          const seat = host.closest('[data-composer-seat]')
          if (seat === null) return true
          const chips = seat.querySelectorAll('[data-composer-chip]')
          const index = Array.prototype.indexOf.call(chips, host)
          const span = chipSpan(snapRef.current, index, SOURCE)
          const insertText = actionsRef.current && actionsRef.current.insertText
          if (span !== null && typeof insertText === 'function') insertText('', span)
          return true
        }

        const onPointerDown = (event) => {
          if (dismissChip(event)) return
          const target = event.target
          if (target instanceof Element && target.closest('[data-add-to-chat]') !== null) return
          dragging = true
          hide()
        }
        const onPointerUp = () => {
          dragging = false
          schedule()
        }
        const onSelectionChange = () => {
          const selection = window.getSelection()
          if (selection === null || selection.isCollapsed) hide()
          else if (!dragging) schedule()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') hide()
        }
        const onKeyUp = () => {
          if (!dragging) schedule()
        }
        const onScroll = () => hide()

        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('pointerup', onPointerUp, true)
        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('keyup', onKeyUp, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
          if (raf !== 0) cancelAnimationFrame(raf)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('pointerup', onPointerUp, true)
          document.removeEventListener('selectionchange', onSelectionChange)
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('keyup', onKeyUp, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          hide()
        }
      }, [props.sessionId])

      return null
    }

    /**
     * Sent-message chip, inline with the rest of that message.
     * A code quote shows only its language; the excerpt appears on hover.
     * @param {string} label
     * @param {string} text Full selection.
     * @param {boolean} code
     * @returns {HTMLSpanElement}
     */
    function sentChip(label, text, code) {
      const chip = document.createElement('span')
      chip.className = 'dsh-add-to-chat-sent'
      const name = document.createElement('span')
      if (code) {
        const lang = codeChipName(label)
        name.textContent = lang === null ? 'code' : lang
        const preview = document.createElement('span')
        preview.className = 'dsh-add-to-chat-preview'
        preview.textContent = codePreview(text)
        chip.append(name, preview)
        chip.tabIndex = 0
      } else {
        name.textContent = label
        chip.title = label
        chip.append(name)
      }
      return chip
    }

    /**
     * Map a combined-text offset onto a collected text node.
     * @param {{ node: Text, start: number, value: string }[]} parts
     * @param {number} offset
     * @returns {{ node: Text, offset: number } | null}
     */
    function pointAt(parts, offset) {
      for (const part of parts) {
        const end = part.start + part.value.length
        if (offset <= end) return { node: part.node, offset: offset - part.start }
      }
      return null
    }

    /**
     * Replace quote wires in one rendered subtree with sent chips.
     * Skips the composer editor. Walks text that React split around other chips.
     * @param {ParentNode} root
     */
    function paintRoot(root) {
      const parts = []
      let combined = ''
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement
          if (parent === null) return NodeFilter.FILTER_REJECT
          if (parent.closest('[contenteditable="true"]') !== null) return NodeFilter.FILTER_REJECT
          if (parent.closest('.dsh-add-to-chat-sent') !== null) return NodeFilter.FILTER_REJECT
          if (parent.closest('[data-code-block-content]') !== null) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let current = walker.nextNode()
      while (current !== null) {
        const value = current.nodeValue || ''
        parts.push({ node: /** @type {Text} */ (current), start: combined.length, value })
        combined += value
        current = walker.nextNode()
      }
      if (!combined.includes('<dsh-quote ')) return
      const wires = []
      let cursor = 0
      while (cursor < combined.length) {
        const at = combined.indexOf('<dsh-quote ', cursor)
        if (at < 0) break
        const wire = readQuoteWire(combined, at)
        if (wire === null) {
          cursor = at + 1
          continue
        }
        wires.push({ start: at, end: wire.end, label: wire.label, text: wire.text, code: wire.code || codeChipName(wire.label) !== null })
        cursor = wire.end
      }
      for (let i = wires.length - 1; i >= 0; i--) {
        const wire = wires[i]
        const start = pointAt(parts, wire.start)
        const end = pointAt(parts, wire.end)
        if (start === null || end === null) continue
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        range.deleteContents()
        range.insertNode(sentChip(wire.label, wire.text, wire.code))
      }
    }

    /** Paint quote chips inside each user bubble and the queue, not across the whole transcript. */
    function paintSentQuotes() {
      document.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-submission-echo], [data-queue-dock]').forEach((root) => {
        paintRoot(root)
      })
    }

    /**
     * Register the quote source and the selection button.
     * @param {object} ctx Cordis client context with `sessions`, `inputTriggers`, and `slots`.
     */
    function apply(ctx) {
      const inputTriggers = ctx.inputTriggers
      ctx.effect(() => {
        sessionsApi = ctx.sessions
        const disposeSource = inputTriggers.registerSource({
          trigger: TRIGGER,
          name: SOURCE,
          order: 90,
          showGroupTitle: false,
          candidates: async () => [],
          onPick: () => undefined,
          codec: {
            clipboardText(ref) {
              if (typeof ref !== 'string') return ''
              const packed = unpackQuoteRef(ref)
              return packed === null ? ref : packed.text
            },
            serialize(ref) {
              if (typeof ref !== 'string') return Promise.reject(new Error('add-to-chat: reference is not text'))
              const packed = unpackQuoteRef(ref)
              if (packed === null) return Promise.resolve(quoteWire(ref, previewLabel(ref, { code: false }), false))
              return Promise.resolve(quoteWire(packed.text, packed.label, codeChipName(packed.label) !== null))
            },
          },
        })
        return () => {
          disposeSource()
          sessionsApi = null
        }
      }, 'dsh-add-to-chat: source')

      ctx.effect(() => {
        ensureStyle()
        let raf = 0
        const schedule = () => {
          if (raf !== 0) return
          raf = requestAnimationFrame(() => {
            raf = 0
            paintSentQuotes()
          })
        }
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const node = record.target
            const el = node instanceof Element ? node : node.parentElement
            if (el === null) continue
            if (el.closest('[contenteditable="true"]') !== null) continue
            if (el.closest('[data-conversation-scroll], [data-queue-dock]') !== null) {
              schedule()
              return
            }
          }
        })
        observer.observe(document.body, { subtree: true, childList: true, characterData: true })
        schedule()
        return () => {
          observer.disconnect()
          if (raf !== 0) cancelAnimationFrame(raf)
        }
      }, 'dsh-add-to-chat: sent chips')

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'add-to-chat',
        order: 40,
      }, AddToChatMount))
    }

    exports.name = 'dsh-add-to-chat'
    exports.inject = ['slots', 'sessions', 'inputTriggers']
    exports.apply = apply
    return module.exports
  },
})
