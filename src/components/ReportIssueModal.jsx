import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { VANS } from '../data/eocConstants'
import useEocIssueFeatures from '../hooks/useEocIssueFeatures'
import useScopedIssues from '../hooks/useScopedIssues'
import { ISSUE_TYPES } from '../utils/issueModel'
import { APP_FEEDBACK_TYPE } from '../utils/appFeedbackModel'
import AppModal from './AppModal'
import IssuePhotoPicker from './IssuePhotoPicker'

const REPORT_CHOICES = Object.freeze([
  ...ISSUE_TYPES.filter(type => type.value !== 'other'),
  { value: APP_FEEDBACK_TYPE, label: 'App bug or suggestion', feedback: true },
  ...ISSUE_TYPES.filter(type => type.value === 'other')
])

function clean(value) {
  return String(value || '').trim()
}

export default function ReportIssueModal({
  isOpen,
  onClose,
  user,
  assignment,
  locationIds = [],
  inIssueScope,
  isOffline = false,
  onSubmitIssue,
  onSubmitFeedback,
  onNavigateToIssues
}) {
  const [stage, setStage] = useState('form')
  const [form, setForm] = useState({ issueType: ISSUE_TYPES[0].value, description: '', vanId: '' })
  const [photos, setPhotos] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { enabledForLocation } = useEocIssueFeatures()
  const { issues } = useScopedIssues({
    user,
    inEocScope: inIssueScope,
    inIssueScope,
    issueLocationIds: locationIds,
    enabled: isOpen && locationIds.length > 0
  })

  const assignedVanIds = useMemo(() => [...new Set([
    ...(Array.isArray(assignment?.vanIds) ? assignment.vanIds : []),
    ...(Array.isArray(user?.vanIds) ? user.vanIds : []),
    assignment?.vanId,
    user?.vanId
  ].map(clean).filter(Boolean))], [assignment, user])
  const primaryLocationId = assignment?.locationId || locationIds[0] || user?.locationId || ''
  const isFeedback = form.issueType === APP_FEEDBACK_TYPE
  const isVan = form.issueType === 'van_vehicle'
  const selectedVanId = clean(form.vanId || (assignedVanIds.length === 1 ? assignedVanIds[0] : ''))
  const photosEnabled = !isFeedback && enabledForLocation('photos', primaryLocationId)

  useEffect(() => {
    if (!isOpen) return
    setForm({ issueType: ISSUE_TYPES[0].value, description: '', vanId: assignedVanIds.length === 1 ? assignedVanIds[0] : '' })
    setPhotos([])
    setError('')
    setSubmitting(false)
    setStage('form')
  }, [assignedVanIds, isOpen])

  const submit = async event => {
    event?.preventDefault()
    const description = clean(form.description)
    if (!description) {
      setError(isFeedback ? 'Describe the bug or suggestion before submitting.' : 'Describe the issue before submitting.')
      return
    }
    if (isVan && !selectedVanId) {
      setError('Choose the van for this issue.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (isFeedback) {
        await onSubmitFeedback?.({ description, assignment })
      } else {
        await onSubmitIssue?.({ issueType: form.issueType, description, vanId: isVan ? selectedVanId : '', assignment, photos })
      }
      onClose?.()
    } catch (submitError) {
      setError(submitError?.message || 'The report could not be submitted. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => {
    if (!submitting) onClose?.()
  }

  return (
    <AppModal
      isOpen={isOpen}
      title="Report Issue"
      tone="warning"
      maxWidth="520px"
      footer={stage === 'existing' ? (
        <>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-finish" onClick={() => setStage('form')}>Continue report</button>
        </>
      ) : (
        <>
          <button type="button" className="btn" onClick={close} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-finish" onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting...' : (isFeedback ? 'Submit feedback' : 'Submit Issue')}
          </button>
        </>
      )}
    >
      <form onSubmit={submit} className="shared-report-form location-report-modal">
        <label htmlFor="shared-report-type">Issue type</label>
        <select
          id="shared-report-type"
          className="input"
          value={form.issueType}
          onChange={event => {
            const issueType = event.target.value
            setError('')
            setPhotos([])
            setForm(previous => ({
              ...previous,
              issueType,
              vanId: issueType === 'van_vehicle' && assignedVanIds.length === 1 ? assignedVanIds[0] : ''
            }))
          }}
          disabled={submitting}
        >
          {REPORT_CHOICES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>

        {!isFeedback && issues.length > 0 && stage === 'form' && (
          <div className="shared-report-existing-note">
            <strong>{issues.length} active issue{issues.length === 1 ? '' : 's'} at this location</strong>
            <button type="button" onClick={() => setStage('existing')}>Check before reporting</button>
          </div>
        )}

        {!isFeedback && stage === 'existing' && (
          <div className="quick-issue-existing">
            <p>Review active issues before creating a duplicate report.</p>
            <div className="quick-issue-existing-list">
              {issues.slice(0, 4).map(issue => (
                <div className="quick-issue-existing-row" key={issue.id}>
                  <strong>{issue.label || 'Issue'}</strong>
                  <span>{issue.description || 'No details provided.'}</span>
                </div>
              ))}
            </div>
            <div className="shared-report-existing-actions">
              <button type="button" onClick={() => setStage('form')}>Continue report</button>
              {onNavigateToIssues && (
                <button type="button" onClick={() => { close(); onNavigateToIssues() }}>
                  View all issues <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {stage === 'form' && (
          <>
            {isVan && assignedVanIds.length > 1 && (
              <>
                <label htmlFor="shared-report-van">Van</label>
                <select id="shared-report-van" className="input" value={form.vanId} onChange={event => setForm(previous => ({ ...previous, vanId: event.target.value }))}>
                  <option value="">Choose van</option>
                  {assignedVanIds.map(vanId => <option key={vanId} value={vanId}>{VANS.find(van => van.id === vanId)?.label || vanId}</option>)}
                </select>
              </>
            )}
            {form.issueType === 'safety_concern' && (
              <div className="location-report-safety-warning" role="alert">
                If anyone is in immediate danger, follow emergency procedures and contact a supervisor before submitting this report.
              </div>
            )}
            {isFeedback && (
              <div className="app-feedback-privacy-note" role="note">
                Do not include client names, medical information, or other private client details. Technical page and device details are attached automatically. Screenshots are not collected.
              </div>
            )}
            <label htmlFor="shared-report-description">{isFeedback ? 'Bug or suggestion' : 'Describe the issue'}</label>
            <textarea
              id="shared-report-description"
              rows={5}
              value={form.description}
              onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
              placeholder={isFeedback ? 'What happened, what did you expect, or what would make the app work better?' : 'Include any details staff or supervisors should know.'}
              disabled={submitting}
            />
            {photosEnabled && <IssuePhotoPicker value={photos} onChange={setPhotos} disabled={submitting} />}
            {isOffline && <div className="location-report-warning">Offline: this {isFeedback ? 'feedback' : 'report'} will send when internet returns.</div>}
            {error && <div className="location-report-error">{error}</div>}
          </>
        )}
      </form>
    </AppModal>
  )
}
