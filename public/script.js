import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6.6.0'
import { EditorView, keymap, lineNumbers } from 'https://esm.sh/@codemirror/view@6.40.0?deps=@codemirror/state@6.6.0'
import { indentWithTab, defaultKeymap } from 'https://esm.sh/@codemirror/commands@6.10.3?deps=@codemirror/state@6.6.0'
import { StreamLanguage, indentUnit, bracketMatching, HighlightStyle, syntaxHighlighting } from 'https://esm.sh/@codemirror/language@6.12.2?deps=@codemirror/state@6.6.0'
import { tags } from 'https://esm.sh/@lezer/highlight@1.2.3'
import { javascript } from 'https://esm.sh/@codemirror/lang-javascript@6.2.5?deps=@codemirror/state@6.6.0'
import { python } from 'https://esm.sh/@codemirror/lang-python@6.2.1?deps=@codemirror/state@6.6.0'
import { cpp } from 'https://esm.sh/@codemirror/lang-cpp@6.0.3?deps=@codemirror/state@6.6.0'
import { java } from 'https://esm.sh/@codemirror/lang-java@6.0.2?deps=@codemirror/state@6.6.0'
import { rust } from 'https://esm.sh/@codemirror/lang-rust@6.0.2?deps=@codemirror/state@6.6.0'
import * as zigPkg from 'https://esm.sh/codemirror-lang-zig@0.1.0?deps=@codemirror/state@6.6.0,@codemirror/language@6.12.2'
import { dart, objectiveC } from 'https://esm.sh/@codemirror/legacy-modes@6.5.2/mode/clike?deps=@codemirror/state@6.6.0,@codemirror/language@6.12.2'
import { swift } from 'https://esm.sh/@codemirror/legacy-modes@6.5.2/mode/swift?deps=@codemirror/state@6.6.0,@codemirror/language@6.12.2'
import { gas, gasArm } from 'https://esm.sh/@codemirror/legacy-modes@6.5.2/mode/gas?deps=@codemirror/state@6.6.0,@codemirror/language@6.12.2'

const sourceLangSelect = document.getElementById('source-lang')
const targetLangSelect = document.getElementById('target-lang')
const translateBtn = document.getElementById('translate-btn')
const copyBtn = document.getElementById('copy-btn')
const sourceEditorEl = document.getElementById('source-editor')
const targetEditorEl = document.getElementById('target-editor')
const sourceHighlightBadge = document.getElementById('source-highlight-badge')
const targetHighlightBadge = document.getElementById('target-highlight-badge')
const sourceCustomLangInput = document.getElementById('source-custom-lang')
const targetCustomLangInput = document.getElementById('target-custom-lang')
const translatingIndicator = document.getElementById('translating-indicator')
const feedbackMessageEl = document.getElementById('feedback-message')

if (!sourceLangSelect || !targetLangSelect || !translateBtn || !copyBtn || !sourceEditorEl || !targetEditorEl || !sourceHighlightBadge || !targetHighlightBadge || !sourceCustomLangInput || !targetCustomLangInput) {
  throw new Error('Translator UI failed to initialize due to missing elements.')
}

let debounceTimer = null
let activeAbortController = null
let translateRequestId = 0
let feedbackTimer = null
let feedbackResetTimer = null

const zigLanguageFactory =
  typeof zigPkg.zig === 'function'
    ? zigPkg.zig
    : typeof zigPkg.default === 'function'
      ? zigPkg.default
      : null

const zigExtension = zigLanguageFactory ? [zigLanguageFactory()] : [cpp()]

const langExtensions = {
  auto: [],
  javascript: [javascript({ typescript: false })],
  typescript: [javascript({ typescript: true })],
  python: [python()],
  c: [cpp()],
  cpp: [cpp()],
  java: [java()],
  rust: [rust()],
  zig: zigExtension,
  dart: [StreamLanguage.define(dart)],
  swift: [StreamLanguage.define(swift)],
  objc: [StreamLanguage.define(objectiveC)],
  asm_x86: [StreamLanguage.define(gas)],
  asm_x86_64: [StreamLanguage.define(gas)],
  asm_arm: [StreamLanguage.define(gasArm)],
  asm_arm64: [StreamLanguage.define(gasArm)]
}

const getSelectedLanguageLabel = (selectEl) => {
  if (selectEl.value === 'custom') {
    const inputEl = selectEl === sourceLangSelect ? sourceCustomLangInput : targetCustomLangInput
    const customLang = inputEl.value.trim()
    return customLang || 'Custom language'
  }
  return selectEl.selectedOptions?.[0]?.textContent?.trim() || selectEl.value
}

const getEffectiveLanguageValue = (selectEl) => {
  if (selectEl.value !== 'custom') {
    return selectEl.value
  }

  const inputEl = selectEl === sourceLangSelect ? sourceCustomLangInput : targetCustomLangInput
  const customLang = inputEl.value.trim()
  return customLang || 'custom'
}

const syncCustomLanguageInput = (selectEl) => {
  const inputEl = selectEl === sourceLangSelect ? sourceCustomLangInput : targetCustomLangInput
  const isCustom = selectEl.value === 'custom'
  inputEl.hidden = !isCustom
  if (isCustom && !inputEl.value.trim()) {
    inputEl.focus()
  }
}

const getLanguageExtension = (lang) => {
  const extension = langExtensions[lang]
  return {
    extension: Array.isArray(extension) ? extension : [],
    supported: Array.isArray(extension)
  }
}

const setHighlightBadgeState = (badgeEl, selectEl, supported) => {
  if (supported) {
    badgeEl.hidden = true
    badgeEl.removeAttribute('title')
    return
  }

  const label = getSelectedLanguageLabel(selectEl)
  badgeEl.hidden = false
  badgeEl.title = `Syntax highlighting is not supported for ${label} yet.`
}

const showFeedback = (message, tone = 'info', duration = 3800) => {
  if (!feedbackMessageEl) {
    return
  }

  const toneClasses = ['info', 'success', 'warning', 'error']

  if (!message) {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
    }

    if (feedbackResetTimer) {
      clearTimeout(feedbackResetTimer)
      feedbackResetTimer = null
    }

    feedbackMessageEl.classList.remove('is-visible', ...toneClasses)
    feedbackMessageEl.setAttribute('aria-hidden', 'true')
    feedbackResetTimer = setTimeout(() => {
      feedbackMessageEl.textContent = ''
      feedbackResetTimer = null
    }, 280)
    return
  }

  if (feedbackTimer) {
    clearTimeout(feedbackTimer)
    feedbackTimer = null
  }

  if (feedbackResetTimer) {
    clearTimeout(feedbackResetTimer)
    feedbackResetTimer = null
  }

  feedbackMessageEl.textContent = message
  feedbackMessageEl.classList.remove(...toneClasses)
  feedbackMessageEl.classList.add(tone, 'is-visible')
  feedbackMessageEl.setAttribute('aria-hidden', 'false')

  if (duration > 0) {
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null
      showFeedback('', tone, 0)
    }, duration)
  }
}

const setTranslatingState = (isTranslating) => {
  targetEditorEl.classList.toggle('loading', isTranslating)
  targetEditorEl.setAttribute('aria-busy', isTranslating ? 'true' : 'false')
  if (translatingIndicator) {
    translatingIndicator.hidden = !isTranslating
  }
  translateBtn.disabled = isTranslating
}

const indentSizeForLanguage = (lang) => {
  if (lang === 'javascript' || lang === 'typescript') {
    return '  '
  }
  return '    '
}

const editorTheme = EditorView.theme({
  '&': {
    borderRadius: '8px',
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-fg)'
  },
  '&.cm-focused': {
    outline: 'none'
  },
  '.cm-content': {
    caretColor: 'var(--editor-caret)'
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--editor-caret)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection)'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-gutter-bg)',
    color: 'var(--editor-gutter-fg)',
    borderRight: '1px solid var(--editor-gutter-border)'
  }
})

const tokenHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--syntax-operator)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--syntax-variable)' },
  { tag: [tags.meta, tags.annotation], color: 'var(--syntax-meta)' }
])

const baseExtensions = [
  lineNumbers(),
  keymap.of([...defaultKeymap, indentWithTab]),
  bracketMatching(),
  syntaxHighlighting(tokenHighlightStyle, { fallback: true }),
  editorTheme
]

const sourceLanguageCompartment = new Compartment()
const sourceIndentCompartment = new Compartment()

const sourceState = EditorState.create({
  doc: '',
  extensions: [
    ...baseExtensions,
    sourceLanguageCompartment.of(langExtensions.auto),
    sourceIndentCompartment.of(indentUnit.of('    ')),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return
      }
      queueAutoTranslate()
    })
  ]
})

const sourceEditor = new EditorView({
  state: sourceState,
  parent: sourceEditorEl
})

const targetLanguageCompartment = new Compartment()
const targetIndentCompartment = new Compartment()

const targetState = EditorState.create({
  doc: '',
  extensions: [
    ...baseExtensions,
    EditorView.editable.of(false),
    targetLanguageCompartment.of(getLanguageExtension(targetLangSelect.value).extension),
    targetIndentCompartment.of(indentUnit.of(indentSizeForLanguage(targetLangSelect.value)))
  ]
})

const targetEditor = new EditorView({
  state: targetState,
  parent: targetEditorEl
})

const reconfigureSourceEditor = () => {
  const selected = sourceLangSelect.value
  const { extension, supported } = getLanguageExtension(selected)
  setHighlightBadgeState(sourceHighlightBadge, sourceLangSelect, supported || selected === 'auto')

  sourceEditor.dispatch({
    effects: [
      sourceLanguageCompartment.reconfigure(extension),
      sourceIndentCompartment.reconfigure(indentUnit.of(indentSizeForLanguage(selected)))
    ]
  })
}

const reconfigureTargetEditor = () => {
  const selected = targetLangSelect.value
  const { extension, supported } = getLanguageExtension(selected)
  setHighlightBadgeState(targetHighlightBadge, targetLangSelect, supported)

  targetEditor.dispatch({
    effects: [
      targetLanguageCompartment.reconfigure(extension),
      targetIndentCompartment.reconfigure(indentUnit.of(indentSizeForLanguage(selected)))
    ]
  })
}

const setTargetText = (text) => {
  targetEditor.dispatch({
    changes: { from: 0, to: targetEditor.state.doc.length, insert: text }
  })
}

const getSourceText = () => sourceEditor.state.doc.toString()

const getTargetText = () => targetEditor.state.doc.toString()

const translate = async () => {
  const requestId = ++translateRequestId
  const code = getSourceText().trim()

  const sourceLang = getEffectiveLanguageValue(sourceLangSelect)
  const targetLang = getEffectiveLanguageValue(targetLangSelect)

  if (sourceLangSelect.value === 'custom' && sourceLang === 'custom') {
    showFeedback('Enter a source custom language name.', 'warning')
    return
  }

  if (targetLangSelect.value === 'custom' && targetLang === 'custom') {
    showFeedback('Enter a target custom language name.', 'warning')
    return
  }

  if (!code) {
    setTargetText('')
    setTranslatingState(false)
    showFeedback('', 'info', 0)
    return
  }

  if (activeAbortController) {
    activeAbortController.abort()
  }

  activeAbortController = new AbortController()
  let didTimeout = false
  const timeoutId = setTimeout(() => {
    didTimeout = true
    activeAbortController.abort()
  }, 60000)

  setTranslatingState(true)
  showFeedback('Translating your code...', 'info', 0)

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sourceLang,
        targetLang,
        code
      }),
      signal: activeAbortController.signal
    })

    const contentType = response.headers.get('content-type') || ''
    const isJson = contentType.includes('application/json')
    const data = isJson ? await response.json() : { error: await response.text() }

    if (!response.ok) {
      const statusMessageMap = {
        400: data.error || 'Invalid translation request.',
        401: 'Authentication failed for the selected provider.',
        403: 'Permission denied by the selected provider.',
        404: 'Translation endpoint was not found.',
        429: 'Rate limit reached. Please wait and try again.',
        500: data.error || 'Server error during translation.'
      }
      const fallbackMessage = data.error || `Translation failed (${response.status}).`
      throw new Error(statusMessageMap[response.status] || fallbackMessage)
    }

    setTargetText(data.translatedCode || '')
    showFeedback('Translation complete.', 'success', 1800)
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (didTimeout) {
        showFeedback('Translation timed out. Please try again.', 'error')
      }
      return
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    showFeedback(message, 'error')
  } finally {
    clearTimeout(timeoutId)
    if (requestId === translateRequestId) {
      setTranslatingState(false)
    }
  }
}

const queueAutoTranslate = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    translate()
  }, 900)
}

sourceLangSelect.addEventListener('change', () => {
  syncCustomLanguageInput(sourceLangSelect)
  reconfigureSourceEditor()
  queueAutoTranslate()
})

targetLangSelect.addEventListener('change', () => {
  syncCustomLanguageInput(targetLangSelect)
  reconfigureTargetEditor()
  queueAutoTranslate()
})

sourceCustomLangInput.addEventListener('input', () => {
  if (sourceLangSelect.value === 'custom') {
    setHighlightBadgeState(sourceHighlightBadge, sourceLangSelect, false)
    queueAutoTranslate()
  }
})

targetCustomLangInput.addEventListener('input', () => {
  if (targetLangSelect.value === 'custom') {
    setHighlightBadgeState(targetHighlightBadge, targetLangSelect, false)
    queueAutoTranslate()
  }
})

translateBtn.addEventListener('click', () => {
  translate()
})

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') {
    return
  }

  const activeElement = document.activeElement
  const isRelevantFocus =
    activeElement === sourceCustomLangInput ||
    activeElement === targetCustomLangInput ||
    activeElement === sourceLangSelect ||
    activeElement === targetLangSelect ||
    sourceEditorEl.contains(activeElement) ||
    targetEditorEl.contains(activeElement) ||
    activeElement === document.body

  if (!isRelevantFocus) {
    return
  }

  event.preventDefault()
  translate()
})

copyBtn.addEventListener('click', async () => {
  const text = getTargetText()
  if (!text.trim()) {
    copyBtn.classList.remove('copied')
    showFeedback('Nothing to copy yet.', 'warning', 2200)
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    copyBtn.classList.add('copied')
    copyBtn.setAttribute('title', 'Copied')
    copyBtn.setAttribute('aria-label', 'Copied translated code')
    setTimeout(() => {
      copyBtn.classList.remove('copied')
      copyBtn.setAttribute('title', 'Copy translated code')
      copyBtn.setAttribute('aria-label', 'Copy translated code')
    }, 1200)
    showFeedback('Copied translated code.', 'success', 1800)
  } catch {
    copyBtn.classList.remove('copied')
    showFeedback('Clipboard write failed.', 'error', 2600)
  }
})

reconfigureSourceEditor()
reconfigureTargetEditor()
syncCustomLanguageInput(sourceLangSelect)
syncCustomLanguageInput(targetLangSelect)
