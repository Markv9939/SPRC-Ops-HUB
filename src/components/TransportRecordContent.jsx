import { createElement, useEffect, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Clock3, FileText, MapPin, TriangleAlert, Users } from 'lucide-react'
import {
  formatDcPaperworkStatus,
  formatTransportRecordDate,
  formatTransportRecordTime,
  getTransportDurationLabel,
  getTransportStatusBadgeClass,
  getTransportTimeline,
  hasCompleteTransportInformation,
  isActiveTransportRecord,
  isCompletedTransportRecord,
  normalizeTransportRecordStatus
} from '../utils/transportRecord'

function ValueList({ values, renderValue }) {
  const items = Array.isArray(values) ? values.filter(Boolean) : []
  if (items.length === 0) return <div className="transport-record-missing">Not recorded</div>
  return (
    <ul className="transport-record-list">
      {items.map((item, index) => (
        <li key={`${String(item?.name || item?.address || item)}-${index}`}>
          {renderValue ? renderValue(item, index) : String(item)}
        </li>
      ))}
    </ul>
  )
}

function RecordSection({ icon, title, children, className = '' }) {
  return (
    <section className={`transport-record-section ${className}`}>
      <h3>{createElement(icon, { size: 19, 'aria-hidden': true })}{title}</h3>
      {children}
    </section>
  )
}

function TransportRecordContent({ transport, compact = false }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!isActiveTransportRecord(transport)) return undefined
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [transport])

  const status = normalizeTransportRecordStatus(transport?.status) || 'unknown'
  const timeline = getTransportTimeline(transport)
  const complete = hasCompleteTransportInformation(transport)
  const completed = isCompletedTransportRecord(transport)
  const destinations = Array.isArray(transport?.destinations) && transport.destinations.length > 0
    ? transport.destinations
    : Array.isArray(transport?.stops)
      ? transport.stops.map(stop => ({
          name: stop?.destinationName || stop?.name || '',
          address: stop?.destinationAddress || stop?.address || ''
        })).filter(destination => destination.name || destination.address)
      : []

  return (
    <div className={`transport-record-content ${compact ? 'transport-record-content-compact' : ''}`}>
      <div className="transport-record-hero">
        <div>
          <div className="transport-record-title-row">
            <h2>{completed ? 'Completed Transport' : 'Transport Record'}</h2>
            <span className={getTransportStatusBadgeClass(status)}>{status}</span>
          </div>
          <div className="transport-record-id">Transport #{String(transport?.id || '').slice(-8) || 'Not recorded'}</div>
        </div>
      </div>

      <div className="transport-record-summary">
        <div><span>Date</span><strong>{formatTransportRecordDate(transport?.departedAt, { long: true })}</strong></div>
        <div><span>Driver</span><strong>{transport?.createdByName || 'Not recorded'}</strong></div>
        <div><span>Location</span><strong>{transport?.site || 'Not recorded'}</strong></div>
        <div><span>Departed</span><strong>{formatTransportRecordTime(transport?.departedAt)}</strong></div>
        <div><span>Returned</span><strong>{formatTransportRecordTime(transport?.returnedAt || transport?.closedAt)}</strong></div>
        <div><span>Duration</span><strong>{getTransportDurationLabel(transport, nowMs)}</strong></div>
      </div>

      <div className="transport-record-grid">
        <div className="transport-record-column">
          <RecordSection icon={Users} title="People transported">
            <ValueList values={transport?.clients} />
          </RecordSection>

          <RecordSection icon={MapPin} title="Trip details">
            <div className="transport-record-subsection">
              <h4>Destination</h4>
              <ValueList
                values={destinations}
                renderValue={destination => (
                  <>
                    {destination?.name && <strong>{destination.name}</strong>}
                    {destination?.address && <span>{destination.address}</span>}
                    {!destination?.name && !destination?.address && <span>Not recorded</span>}
                  </>
                )}
              />
            </div>
            <div className="transport-record-subsection">
              <h4>Reason</h4>
              <ValueList values={transport?.reasons} />
            </div>
          </RecordSection>

          <RecordSection icon={FileText} title="Notes">
            <div className={transport?.notes ? 'transport-record-notes' : 'transport-record-missing'}>
              {transport?.notes || 'Not recorded'}
            </div>
          </RecordSection>
        </div>

        <div className="transport-record-column">
          <RecordSection icon={ClipboardCheck} title="Completion checks">
            <div className="transport-record-check">
              {transport?.dcPaperworkStatus
                ? <CheckCircle2 size={18} aria-hidden="true" />
                : <TriangleAlert size={18} aria-hidden="true" />}
              <span>DC paperwork: {formatDcPaperworkStatus(transport?.dcPaperworkStatus)}</span>
            </div>
            {transport?.dcPaperworkStatus === 'other' && (
              <div className={transport?.dcPaperworkOtherNote ? 'transport-record-check-note' : 'transport-record-missing'}>
                {transport?.dcPaperworkOtherNote || 'Not recorded'}
              </div>
            )}
            <div className={`transport-record-check ${complete ? '' : 'transport-record-check-warning'}`}>
              {complete
                ? <CheckCircle2 size={18} aria-hidden="true" />
                : <TriangleAlert size={18} aria-hidden="true" />}
              <span>{complete ? 'All required information recorded' : 'Information incomplete'}</span>
            </div>
          </RecordSection>

          <RecordSection icon={Clock3} title="Transport timeline" className="transport-record-timeline-section">
            {timeline.length === 0 ? (
              <div className="transport-record-missing">No timeline events recorded</div>
            ) : (
              <ol className="transport-record-timeline">
                {timeline.map(event => (
                  <li key={event.key}>
                    <div className="transport-record-timeline-marker" aria-hidden="true" />
                    <div className="transport-record-timeline-copy">
                      <strong>{event.label}</strong>
                      {event.detail && <span>{event.detail}</span>}
                    </div>
                    <time>{formatTransportRecordTime(event.date)}</time>
                  </li>
                ))}
              </ol>
            )}
          </RecordSection>
        </div>
      </div>
    </div>
  )
}

export default TransportRecordContent
