import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CalendarClock,
  ChevronLeft,
  ClipboardCheck,
  Copy,
  Eye,
  FilePlus2,
  GripVertical,
  Image,
  Hash,
  ListChecks,
  Plus,
  Redo2,
  Save,
  Settings2,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import {
  EOC_QUESTION_TYPES,
  EOC_QUESTION_TYPE_OPTIONS,
  createEmptyEocTemplateQuestion,
  createEmptyEocTemplateSection,
  createEocTrackingId,
  normalizeEocTemplateDefinition,
  normalizeEocTemplateSections,
  validateEocTemplateDefinition
} from '../utils/eocTemplateModel'
import { showConfirmDialog } from '../utils/dialogs'

const TYPE_ICONS = {
  [EOC_QUESTION_TYPES.PASS_ISSUE]: ListChecks,
  [EOC_QUESTION_TYPES.SHORT_TEXT]: Type,
  [EOC_QUESTION_TYPES.MULTIPLE_CHOICE]: ListChecks,
  [EOC_QUESTION_TYPES.NUMBER]: Hash,
  [EOC_QUESTION_TYPES.PHOTO]: Image,
  [EOC_QUESTION_TYPES.DATE_TIME]: CalendarClock
}

function newTemplate() {
  return {
    schemaVersion: 3,
    organizationId: 'sprc',
    name: '',
    eocType: 'house',
    status: 'active',
    sections: [createEmptyEocTemplateSection(1)]
  }
}

function buildInitialForm(initialTemplate) {
  if (!initialTemplate || (!initialTemplate.id && !initialTemplate.name && !initialTemplate.items?.length && !initialTemplate.sections?.length)) {
    return newTemplate()
  }
  const normalized = normalizeEocTemplateDefinition(initialTemplate, { includeIncomplete: true })
  return {
    ...normalized,
    sections: normalized.sections.length > 0 ? normalized.sections : [createEmptyEocTemplateSection(1)]
  }
}

function selectedRecord(form, selection) {
  const section = form.sections.find(item => item.id === selection?.sectionId) || null
  if (!section) return { section: null, question: null }
  const question = selection?.questionId
    ? section.questions.find(item => item.id === selection.questionId) || null
    : null
  return { section, question }
}

function resequenceSections(sections) {
  return sections.map((section, sectionIndex) => ({
    ...section,
    order: sectionIndex + 1,
    questions: section.questions.map((question, questionIndex) => ({ ...question, order: questionIndex + 1 }))
  }))
}

function copySection(section, existingTrackingIds = new Set()) {
  return {
    ...section,
    id: createEocTrackingId('section'),
    sourceSectionId: section.sourceSectionId || section.id,
    questions: section.questions.map((question, index) => {
      const trackingId = existingTrackingIds.has(question.trackingId)
        ? createEocTrackingId('question')
        : question.trackingId
      existingTrackingIds.add(trackingId)
      return { ...question, id: trackingId, trackingId, order: index + 1 }
    })
  }
}

function EocTemplateEditorDrawer({
  isOpen,
  isMobile = false,
  initialTemplate,
  isEditing = false,
  canManageTemplates = false,
  isOffline = false,
  sectionLibrary = [],
  onSaveSection,
  onDraftChange,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(() => buildInitialForm(initialTemplate))
  const [selection, setSelection] = useState(null)
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [viewMode, setViewMode] = useState('build')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [draftState, setDraftState] = useState('idle')
  const [mobilePane, setMobilePane] = useState('canvas')
  const [questionDrag, setQuestionDrag] = useState(null)
  const questionDragRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const next = buildInitialForm(initialTemplate)
    setForm(next)
    setSelection(next.sections[0] ? { sectionId: next.sections[0].id, questionId: null } : null)
    setHistory([])
    setFuture([])
    setViewMode('build')
    setError('')
    setWorking(false)
    setDirty(false)
    setDraftState('idle')
    setMobilePane('canvas')
    setQuestionDrag(null)
    questionDragRef.current = null
  }, [initialTemplate, isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    document.body.classList.add('eoc-builder-open')
    window.scrollTo({ left: 0, top: window.scrollY })
    return () => {
      document.body.classList.remove('eoc-builder-open')
      document.body.classList.remove('eoc-question-dragging')
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !dirty || isOffline || !onDraftChange) return undefined
    let cancelled = false
    setDraftState('saving')
    const timer = window.setTimeout(async () => {
      try {
        await onDraftChange(form)
        if (!cancelled) setDraftState('saved')
      } catch (draftError) {
        console.error('Error saving EOC template draft:', draftError)
        if (!cancelled) setDraftState('error')
      }
    }, 900)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dirty, form, isOffline, isOpen, onDraftChange])

  const selected = useMemo(() => selectedRecord(form, selection), [form, selection])
  const disabled = !canManageTemplates || isOffline || working
  const questionCount = useMemo(
    () => form.sections.reduce((count, section) => count + section.questions.length, 0),
    [form.sections]
  )

  if (!isOpen) return null

  const commit = (updater, nextSelection = selection) => {
    setHistory(previous => [...previous.slice(-19), form])
    setFuture([])
    setForm((previous) => {
      const next = updater(previous)
      return { ...next, sections: resequenceSections(next.sections) }
    })
    setSelection(nextSelection)
    setDirty(true)
    setError('')
  }

  const undo = () => {
    if (history.length === 0) return
    const previous = history[history.length - 1]
    setFuture(items => [form, ...items].slice(0, 20))
    setHistory(items => items.slice(0, -1))
    setForm(previous)
    setSelection(previous.sections[0] ? { sectionId: previous.sections[0].id, questionId: null } : null)
    setDirty(true)
  }

  const redo = () => {
    if (future.length === 0) return
    const next = future[0]
    setHistory(items => [...items.slice(-19), form])
    setFuture(items => items.slice(1))
    setForm(next)
    setSelection(next.sections[0] ? { sectionId: next.sections[0].id, questionId: null } : null)
    setDirty(true)
  }

  const closeEditor = async () => {
    if (dirty) {
      const confirmed = await showConfirmDialog('Close this template? Changes that have not been published will be lost.', {
        title: 'Close Template Builder',
        tone: 'warning',
        confirmText: 'Close'
      })
      if (!confirmed) return
    }
    onClose()
  }

  const addBlankSection = () => {
    const section = createEmptyEocTemplateSection(form.sections.length + 1)
    commit(previous => ({ ...previous, sections: [...previous.sections, section] }), { sectionId: section.id, questionId: null })
    if (isMobile) setMobilePane('settings')
  }

  const addSavedSection = (librarySection) => {
    const normalized = normalizeEocTemplateSections([librarySection], { includeIncomplete: true })[0]
    if (!normalized) return
    const existingIds = new Set(form.sections.flatMap(section => section.questions.map(question => question.trackingId)))
    const section = copySection({
      ...normalized,
      sourceSectionId: librarySection.id,
      sourceSectionVersionId: librarySection.publishedVersionId || null
    }, existingIds)
    commit(previous => ({ ...previous, sections: [...previous.sections, section] }), { sectionId: section.id, questionId: null })
    if (isMobile) setMobilePane('settings')
  }

  const addQuestion = (questionType) => {
    const targetSection = selected.section || form.sections[0]
    if (!targetSection) return
    const question = createEmptyEocTemplateQuestion(targetSection.questions.length + 1, questionType)
    commit(previous => ({
      ...previous,
      sections: previous.sections.map(section => section.id === targetSection.id
        ? { ...section, questions: [...section.questions, question] }
        : section)
    }), { sectionId: targetSection.id, questionId: question.id })
    if (isMobile) setMobilePane('settings')
  }

  const updateSection = updates => commit(previous => ({
    ...previous,
    sections: previous.sections.map(section => section.id === selected.section?.id ? { ...section, ...updates } : section)
  }))

  const updateQuestion = updates => commit(previous => ({
    ...previous,
    sections: previous.sections.map(section => section.id === selected.section?.id
      ? {
          ...section,
          questions: section.questions.map(question => question.id === selected.question?.id
            ? { ...question, ...updates }
            : question)
        }
      : section)
  }))

  const moveSection = (sectionId, direction) => {
    const index = form.sections.findIndex(section => section.id === sectionId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= form.sections.length) return
    commit(previous => {
      const sections = [...previous.sections]
      ;[sections[index], sections[target]] = [sections[target], sections[index]]
      return { ...previous, sections }
    })
  }

  const moveQuestion = (sectionId, questionId, direction) => {
    const section = form.sections.find(item => item.id === sectionId)
    const index = section?.questions.findIndex(question => question.id === questionId) ?? -1
    const target = index + direction
    if (!section || index < 0 || target < 0 || target >= section.questions.length) return
    commit(previous => ({
      ...previous,
      sections: previous.sections.map(item => {
        if (item.id !== sectionId) return item
        const questions = [...item.questions]
        ;[questions[index], questions[target]] = [questions[target], questions[index]]
        return { ...item, questions }
      })
    }))
  }

  const moveQuestionTo = (sectionId, questionId, targetQuestionId, placement) => {
    if (questionId === targetQuestionId) return
    const section = form.sections.find(item => item.id === sectionId)
    const sourceIndex = section?.questions.findIndex(question => question.id === questionId) ?? -1
    if (!section || sourceIndex < 0) return
    const questions = section.questions.filter(question => question.id !== questionId)
    const targetIndex = questions.findIndex(question => question.id === targetQuestionId)
    if (targetIndex < 0) return
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex
    questions.splice(insertIndex, 0, section.questions[sourceIndex])
    if (questions.every((question, index) => question.id === section.questions[index]?.id)) return
    commit(previous => ({
      ...previous,
      sections: previous.sections.map(item => item.id === sectionId ? { ...item, questions } : item)
    }))
  }

  const clearQuestionDrag = () => {
    questionDragRef.current = null
    setQuestionDrag(null)
    document.body.classList.remove('eoc-question-dragging')
  }

  const startQuestionDrag = (event, sectionId, questionId) => {
    if (disabled || event.pointerType === 'mouse') return
    event.stopPropagation()
    questionDragRef.current = {
      pointerId: event.pointerId,
      sectionId,
      questionId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overQuestionId: questionId,
      placement: 'before'
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const dragQuestion = (event) => {
    const drag = questionDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return

    event.preventDefault()
    if (!drag.active) document.body.classList.add('eoc-question-dragging')

    const canvas = event.currentTarget.closest('.eoc-builder-canvas')
    if (canvas) {
      const canvasRect = canvas.getBoundingClientRect()
      if (event.clientY < canvasRect.top + 48) canvas.scrollBy({ top: -18 })
      if (event.clientY > canvasRect.bottom - 48) canvas.scrollBy({ top: 18 })
    }

    const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest('.eoc-builder-question-row')
    const sameSection = targetRow?.dataset.sectionId === drag.sectionId
    const overQuestionId = sameSection ? targetRow.dataset.questionId : drag.overQuestionId
    const targetRect = sameSection ? targetRow.getBoundingClientRect() : null
    const placement = targetRect && event.clientY > targetRect.top + (targetRect.height / 2) ? 'after' : 'before'
    const next = { ...drag, active: true, overQuestionId, placement }
    questionDragRef.current = next
    setQuestionDrag(next)
  }

  const finishQuestionDrag = (event, shouldMove = true) => {
    const drag = questionDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (drag.active) event.preventDefault()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    clearQuestionDrag()
    if (shouldMove && drag.active && drag.overQuestionId) {
      moveQuestionTo(drag.sectionId, drag.questionId, drag.overQuestionId, drag.placement)
    }
  }

  const startDesktopQuestionDrag = (event, sectionId, questionId) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', questionId)
    const next = {
      sectionId,
      questionId,
      active: true,
      overQuestionId: questionId,
      placement: 'before'
    }
    questionDragRef.current = next
    setQuestionDrag(next)
    document.body.classList.add('eoc-question-dragging')
  }

  const dragQuestionOver = (event, sectionId, questionId) => {
    const drag = questionDragRef.current
    if (!drag?.active || drag.sectionId !== sectionId || drag.questionId === questionId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const targetRect = event.currentTarget.getBoundingClientRect()
    const placement = event.clientY > targetRect.top + (targetRect.height / 2) ? 'after' : 'before'
    if (drag.overQuestionId === questionId && drag.placement === placement) return
    const next = { ...drag, overQuestionId: questionId, placement }
    questionDragRef.current = next
    setQuestionDrag(next)
  }

  const trackDesktopQuestionDrag = (event) => {
    const drag = questionDragRef.current
    if (!drag?.active || (event.clientX === 0 && event.clientY === 0)) return
    const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest('.eoc-builder-question-row')
    if (!targetRow || targetRow.dataset.sectionId !== drag.sectionId || targetRow.dataset.questionId === drag.questionId) return
    const targetRect = targetRow.getBoundingClientRect()
    const placement = event.clientY > targetRect.top + (targetRect.height / 2) ? 'after' : 'before'
    if (drag.overQuestionId === targetRow.dataset.questionId && drag.placement === placement) return
    const next = { ...drag, overQuestionId: targetRow.dataset.questionId, placement }
    questionDragRef.current = next
    setQuestionDrag(next)
  }

  const dropQuestion = (event) => {
    const drag = questionDragRef.current
    if (!drag?.active) return
    event.preventDefault()
    event.stopPropagation()
    clearQuestionDrag()
    if (drag.overQuestionId) {
      moveQuestionTo(drag.sectionId, drag.questionId, drag.overQuestionId, drag.placement)
    }
  }

  const finishDesktopQuestionDrag = (event) => {
    trackDesktopQuestionDrag(event)
    const drag = questionDragRef.current
    clearQuestionDrag()
    if (drag?.active && drag.overQuestionId) {
      moveQuestionTo(drag.sectionId, drag.questionId, drag.overQuestionId, drag.placement)
    }
  }

  const duplicateSection = (section) => {
    const existingIds = new Set(form.sections.flatMap(item => item.questions.map(question => question.trackingId)))
    const duplicate = copySection(section, existingIds)
    commit(previous => ({ ...previous, sections: [...previous.sections, duplicate] }), { sectionId: duplicate.id, questionId: null })
  }

  const duplicateQuestion = (section, question) => {
    const duplicate = {
      ...question,
      id: createEocTrackingId('question'),
      trackingId: createEocTrackingId('question'),
      label: `${question.label} (Copy)`
    }
    duplicate.id = duplicate.trackingId
    commit(previous => ({
      ...previous,
      sections: previous.sections.map(item => item.id === section.id
        ? { ...item, questions: [...item.questions, duplicate] }
        : item)
    }), { sectionId: section.id, questionId: duplicate.id })
  }

  const removeSection = (sectionId) => {
    if (form.sections.length === 1) {
      setError('A template needs at least one section.')
      return
    }
    commit(previous => ({ ...previous, sections: previous.sections.filter(section => section.id !== sectionId) }), null)
  }

  const removeQuestion = (sectionId, questionId) => {
    const section = form.sections.find(item => item.id === sectionId)
    if (section?.questions.length === 1) {
      setError('A section needs at least one question.')
      return
    }
    commit(previous => ({
      ...previous,
      sections: previous.sections.map(item => item.id === sectionId
        ? { ...item, questions: item.questions.filter(question => question.id !== questionId) }
        : item)
    }), { sectionId, questionId: null })
  }

  const publish = async (assignNow) => {
    const validation = validateEocTemplateDefinition(form)
    if (!validation.valid) {
      setError(validation.errors[0])
      setViewMode('build')
      return
    }
    setWorking(true)
    setError('')
    try {
      await onSave(validation.template, { assignNow })
      setDirty(false)
    } catch (saveError) {
      setError(saveError?.message || 'Template could not be published.')
    } finally {
      setWorking(false)
    }
  }

  return createPortal((
    <div className="eoc-builder-overlay" role="presentation" onClick={closeEditor}>
      <div className={`eoc-builder-shell${isMobile ? ' is-mobile' : ''}`} role="dialog" aria-modal="true" aria-label="EOC template builder" onClick={event => event.stopPropagation()}>
        <header className="eoc-builder-header">
          <button type="button" className="eoc-builder-icon-button" onClick={closeEditor} title="Close builder" aria-label="Close builder"><ChevronLeft size={20} /></button>
          <div className="eoc-builder-title">
            <input
              value={form.name}
              onChange={event => commit(previous => ({ ...previous, name: event.target.value }))}
              placeholder="Template name"
              aria-label="Template name"
              disabled={disabled}
            />
            <span>{form.sections.length} sections | {questionCount} questions{draftState === 'saving' ? ' | Saving draft...' : draftState === 'saved' ? ' | Draft saved' : draftState === 'error' ? ' | Draft save failed' : dirty ? ' | Draft changes' : ''}</span>
          </div>
          <div className="eoc-builder-mode" aria-label="Builder mode">
            <button type="button" className={viewMode === 'build' ? 'is-active' : ''} onClick={() => setViewMode('build')}><Settings2 size={16} /> Build</button>
            <button type="button" className={viewMode === 'preview' ? 'is-active' : ''} onClick={() => setViewMode('preview')}><Eye size={16} /> Preview</button>
          </div>
          <div className="eoc-builder-header-actions">
            <button type="button" className="eoc-builder-icon-button" onClick={undo} disabled={history.length === 0 || disabled} title="Undo" aria-label="Undo"><Undo2 size={18} /></button>
            <button type="button" className="eoc-builder-icon-button" onClick={redo} disabled={future.length === 0 || disabled} title="Redo" aria-label="Redo"><Redo2 size={18} /></button>
            <button type="button" className="eoc-builder-secondary" onClick={() => publish(false)} disabled={disabled}><Save size={17} /> Publish</button>
            <button type="button" className="eoc-builder-primary" onClick={() => publish(true)} disabled={disabled}><Check size={17} /><span className="eoc-builder-primary-label-wide">Publish & Assign</span><span className="eoc-builder-primary-label-short">Publish</span></button>
          </div>
        </header>

        {isOffline && <div className="eoc-builder-banner">Reconnect to edit or publish templates.</div>}
        {error && <div className="eoc-builder-error" role="alert">{error}</div>}
        {isMobile && viewMode === 'build' && (
          <div className="eoc-builder-mobile-panes" aria-label="Builder panels">
            <button type="button" className={mobilePane === 'library' ? 'is-active' : ''} onClick={() => setMobilePane('library')}>Add</button>
            <button type="button" className={mobilePane === 'canvas' ? 'is-active' : ''} onClick={() => setMobilePane('canvas')}>Template</button>
            <button type="button" className={mobilePane === 'settings' ? 'is-active' : ''} onClick={() => setMobilePane('settings')}>Settings</button>
          </div>
        )}

        {viewMode === 'preview' ? (
          <main className="eoc-builder-preview">
            <div className="eoc-builder-preview-device">
              <div className="eoc-builder-preview-heading"><ClipboardCheck size={22} /><div><span>Staff preview</span><h2>{form.name || 'Untitled template'}</h2></div></div>
              {form.sections.filter(section => section.active !== false).map(section => (
                <section key={section.id}>
                  <h3>{section.title || 'Untitled section'}</h3>
                  {section.description && <p>{section.description}</p>}
                  {section.questions.filter(question => question.active !== false).map((question, index) => (
                    <div className="eoc-builder-preview-question" key={question.id}>
                      <strong>{index + 1}. {question.label || 'Untitled question'}{question.required !== false ? ' *' : ''}</strong>
                      <span>{EOC_QUESTION_TYPE_OPTIONS.find(option => option.value === question.questionType)?.label}</span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </main>
        ) : (
          <div className={`eoc-builder-grid mobile-pane-${mobilePane}`}>
            <aside className="eoc-builder-library">
              <div className="eoc-builder-pane-heading"><span>Saved sections</span><button type="button" onClick={addBlankSection} disabled={disabled} title="Add blank section" aria-label="Add blank section"><Plus size={17} /></button></div>
              <button type="button" className="eoc-builder-library-item is-blank" onClick={addBlankSection} disabled={disabled}><FilePlus2 size={18} /><span><strong>Blank section</strong><small>Start with one question</small></span></button>
              {sectionLibrary.filter(section => section.status !== 'archived').map(section => (
                <button type="button" className="eoc-builder-library-item" key={section.id} onClick={() => addSavedSection(section)} disabled={disabled}>
                  <ListChecks size={18} /><span><strong>{section.title || section.name}</strong><small>{section.questionCount || section.questions?.length || 0} questions</small></span><Plus size={16} />
                </button>
              ))}
              <div className="eoc-builder-pane-heading is-questions"><span>Question types</span></div>
              <div className="eoc-builder-question-types">
                {EOC_QUESTION_TYPE_OPTIONS.map(option => {
                  const Icon = TYPE_ICONS[option.value]
                  return <button type="button" key={option.value} onClick={() => addQuestion(option.value)} disabled={disabled}><Icon size={17} /><span>{option.label}</span></button>
                })}
              </div>
            </aside>

            <main className="eoc-builder-canvas">
              <div className="eoc-builder-template-meta">
                <label>Template type<select value={form.eocType} onChange={event => commit(previous => ({ ...previous, eocType: event.target.value }))} disabled={disabled || isEditing}><option value="house">House</option><option value="van">Van</option></select></label>
                <span>Changes publish as a new version. Existing EOCs keep their current version.</span>
              </div>
              {form.sections.map((section, sectionIndex) => (
                <section className={`eoc-builder-section${selected.section?.id === section.id && !selected.question ? ' is-selected' : ''}`} key={section.id}>
                  <header onClick={() => { setSelection({ sectionId: section.id, questionId: null }); if (isMobile) setMobilePane('settings') }}>
                    <div><span>Section {sectionIndex + 1}</span><h3>{section.title || 'Untitled section'}</h3></div>
                    <div className="eoc-builder-row-actions">
                      <button type="button" onClick={event => { event.stopPropagation(); moveSection(section.id, -1) }} disabled={disabled || sectionIndex === 0} title="Move section up" aria-label="Move section up"><ArrowUp size={16} /></button>
                      <button type="button" onClick={event => { event.stopPropagation(); moveSection(section.id, 1) }} disabled={disabled || sectionIndex === form.sections.length - 1} title="Move section down" aria-label="Move section down"><ArrowDown size={16} /></button>
                      <button type="button" onClick={event => { event.stopPropagation(); duplicateSection(section) }} disabled={disabled} title="Duplicate section" aria-label="Duplicate section"><Copy size={16} /></button>
                      <button type="button" onClick={event => { event.stopPropagation(); removeSection(section.id) }} disabled={disabled} title="Remove section" aria-label="Remove section"><Trash2 size={16} /></button>
                    </div>
                  </header>
                  <div className="eoc-builder-section-questions">
                    {section.questions.map((question, questionIndex) => {
                      const Icon = TYPE_ICONS[question.questionType] || ListChecks
                      return (
                        <div
                          className={`eoc-builder-question-row${selected.question?.id === question.id ? ' is-selected' : ''}${questionDrag?.questionId === question.id ? ' is-dragging' : ''}${questionDrag?.overQuestionId === question.id && questionDrag.questionId !== question.id ? ` is-drop-${questionDrag.placement}` : ''}`}
                          key={question.id}
                          role="button"
                          tabIndex={0}
                          data-section-id={section.id}
                          data-question-id={question.id}
                          onClick={() => { setSelection({ sectionId: section.id, questionId: question.id }); if (isMobile) setMobilePane('settings') }}
                          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelection({ sectionId: section.id, questionId: question.id }); if (isMobile) setMobilePane('settings') } }}
                          onDragOver={event => dragQuestionOver(event, section.id, question.id)}
                          onDrop={dropQuestion}
                        >
                          <button
                            type="button"
                            className="eoc-builder-drag-handle"
                            draggable={!disabled}
                            onClick={event => event.stopPropagation()}
                            onDragStart={event => startDesktopQuestionDrag(event, section.id, question.id)}
                            onDrag={trackDesktopQuestionDrag}
                            onDragEnd={finishDesktopQuestionDrag}
                            onPointerDown={event => startQuestionDrag(event, section.id, question.id)}
                            onPointerMove={dragQuestion}
                            onPointerUp={event => finishQuestionDrag(event)}
                            onPointerCancel={event => finishQuestionDrag(event, false)}
                            disabled={disabled}
                            title="Drag to reorder question"
                            aria-label={`Drag to reorder question ${questionIndex + 1}`}
                          >
                            <GripVertical size={17} />
                          </button>
                          <span className="eoc-builder-question-number">{questionIndex + 1}</span><Icon size={17} /><span className="eoc-builder-question-copy"><strong>{question.label || 'Untitled question'}</strong><small>{EOC_QUESTION_TYPE_OPTIONS.find(option => option.value === question.questionType)?.label}{question.required === false ? ' | Optional' : ''}</small></span>
                          <span className="eoc-builder-row-actions">
                            <button type="button" onClick={event => { event.stopPropagation(); moveQuestion(section.id, question.id, -1) }} disabled={disabled || questionIndex === 0} title="Move question up" aria-label="Move question up"><ArrowUp size={15} /></button>
                            <button type="button" onClick={event => { event.stopPropagation(); moveQuestion(section.id, question.id, 1) }} disabled={disabled || questionIndex === section.questions.length - 1} title="Move question down" aria-label="Move question down"><ArrowDown size={15} /></button>
                            <button type="button" onClick={event => { event.stopPropagation(); duplicateQuestion(section, question) }} disabled={disabled} title="Duplicate question" aria-label="Duplicate question"><Copy size={15} /></button>
                            <button type="button" onClick={event => { event.stopPropagation(); removeQuestion(section.id, question.id) }} disabled={disabled} title="Remove question" aria-label="Remove question"><Trash2 size={15} /></button>
                          </span>
                        </div>
                      )
                    })}
                    <button type="button" className="eoc-builder-add-question" onClick={() => { setSelection({ sectionId: section.id, questionId: null }); addQuestion(EOC_QUESTION_TYPES.PASS_ISSUE) }} disabled={disabled}><Plus size={16} /> Add question</button>
                  </div>
                </section>
              ))}
              <button type="button" className="eoc-builder-add-section" onClick={addBlankSection} disabled={disabled}><Plus size={18} /> Add section</button>
            </main>

            <aside className="eoc-builder-settings">
              <div className="eoc-builder-pane-heading"><span>{selected.question ? 'Question settings' : selected.section ? 'Section settings' : 'Template settings'}</span></div>
              {selected.question ? (
                <div className="eoc-builder-settings-form">
                  <label>Question<textarea rows={3} value={selected.question.label} onChange={event => updateQuestion({ label: event.target.value })} disabled={disabled} /></label>
                  <label>Answer type<select value={selected.question.questionType} onChange={event => updateQuestion({ questionType: event.target.value, options: event.target.value === EOC_QUESTION_TYPES.MULTIPLE_CHOICE ? selected.question.options : [], requiresPhotoOnIssue: false })} disabled={disabled}>{EOC_QUESTION_TYPE_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
                  {selected.question.questionType === EOC_QUESTION_TYPES.MULTIPLE_CHOICE && <label>Choices<textarea rows={5} value={(selected.question.options || []).join('\n')} onChange={event => updateQuestion({ options: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} placeholder="One choice per line" disabled={disabled} /></label>}
                  <label>Staff help text<textarea rows={3} value={selected.question.helpText || ''} onChange={event => updateQuestion({ helpText: event.target.value })} placeholder="Optional instructions" disabled={disabled} /></label>
                  <label className="eoc-builder-check"><input type="checkbox" checked={selected.question.required !== false} onChange={event => updateQuestion({ required: event.target.checked })} disabled={disabled} /> Required</label>
                  {selected.question.questionType === EOC_QUESTION_TYPES.PASS_ISSUE && <label className="eoc-builder-check"><input type="checkbox" checked={selected.question.requiresPhotoOnIssue === true} onChange={event => updateQuestion({ requiresPhotoOnIssue: event.target.checked })} disabled={disabled} /> Require photo when an issue is reported</label>}
                  <label className="eoc-builder-check"><input type="checkbox" checked={selected.question.active !== false} onChange={event => updateQuestion({ active: event.target.checked })} disabled={disabled} /> Active</label>
                </div>
              ) : selected.section ? (
                <div className="eoc-builder-settings-form">
                  <label>Section name<input value={selected.section.title} onChange={event => updateSection({ title: event.target.value })} disabled={disabled} /></label>
                  <label>Staff introduction<textarea rows={4} value={selected.section.description || ''} onChange={event => updateSection({ description: event.target.value })} placeholder="Optional section guidance" disabled={disabled} /></label>
                  <label className="eoc-builder-check"><input type="checkbox" checked={selected.section.active !== false} onChange={event => updateSection({ active: event.target.checked })} disabled={disabled} /> Active</label>
                  {onSaveSection && <button type="button" className="eoc-builder-settings-action" onClick={() => onSaveSection(selected.section, form.eocType)} disabled={disabled}><Save size={16} /> Save to section library</button>}
                </div>
              ) : (
                <div className="eoc-builder-empty-settings"><Settings2 size={24} /><p>Select a section or question to edit it.</p></div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  ), document.body)
}

export default EocTemplateEditorDrawer
