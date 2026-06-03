import {
  getDebriefSectionLabel,
  groupDebriefItemsForReadView
} from '../services/shiftDebriefService'

function isFlaggedNote(item) {
  const note = String(item?.note || '')
  const letters = note.replace(/[^a-z]/gi, '')
  const uppercaseLetters = note.replace(/[^A-Z]/g, '')
  return item?.section === 'urgent_time_sensitive_task'
    || (letters.length >= 12 && uppercaseLetters.length / letters.length >= 0.75)
}

function NoteText({ item, showSectionLabel = false }) {
  const flagged = isFlaggedNote(item)
  return (
    <div style={styles.noteRow}>
      <span style={styles.noteDash}>-</span>
      <div style={{ ...styles.noteContent, ...(flagged ? styles.flaggedNote : {}) }}>
        {showSectionLabel && (
          <div style={styles.generalNoteLabel}>{getDebriefSectionLabel(item.section)}</div>
        )}
        <div>{item.note}</div>
      </div>
    </div>
  )
}

function SectionBlock({ section }) {
  return (
    <section style={styles.sectionBlock}>
      <div style={styles.sectionHeader}>{section.label}</div>
      <div style={styles.sectionBody}>
        {section.clients.map((client, index) => (
          <div
            key={client.key}
            style={{
              ...styles.clientRow,
              ...(index === section.clients.length - 1 ? styles.lastClientRow : {})
            }}
          >
            <div style={styles.clientNameRow}>
              <span style={styles.clientDot} />
              <span>{client.label}</span>
            </div>
            <div style={styles.notesList}>
              {client.notes.map(note => (
                <NoteText key={note.id || `${client.key}-${note.createdAtIso}`} item={note} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function GeneralBlock({ notes }) {
  return (
    <section style={styles.sectionBlock}>
      <div style={{ ...styles.sectionHeader, ...styles.generalHeader }}>General Handoff Notes</div>
      <div style={styles.generalBody}>
        {notes.map(note => (
          <NoteText key={note.id || note.createdAtIso} item={note} showSectionLabel />
        ))}
      </div>
    </section>
  )
}

export default function DebriefGroupedReadView({ items, emptyText = 'No notes submitted.' }) {
  const { sections, generalNotes } = groupDebriefItemsForReadView(items)
  const hasNotes = sections.length > 0 || generalNotes.length > 0

  if (!hasNotes) {
    return <div style={styles.emptyText}>{emptyText}</div>
  }

  return (
    <div style={styles.readView}>
      {sections.map(section => (
        <SectionBlock key={section.key} section={section} />
      ))}
      {generalNotes.length > 0 && <GeneralBlock notes={generalNotes} />}
    </div>
  )
}

const styles = {
  readView: {
    width: '100%',
    maxWidth: '720px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px'
  },
  sectionBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    border: '1px solid rgba(17,47,82,0.10)',
    overflow: 'hidden'
  },
  sectionHeader: {
    backgroundColor: '#112F52',
    color: '#FFFFFF',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  generalHeader: {
    backgroundColor: '#3D5A80'
  },
  sectionBody: {
    backgroundColor: '#FFFFFF'
  },
  clientRow: {
    padding: '14px 18px 15px',
    borderBottom: '1px solid #F0EBE3'
  },
  lastClientRow: {
    borderBottom: 'none'
  },
  clientNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#112F52',
    fontSize: '14px',
    fontWeight: 800,
    marginBottom: '7px'
  },
  clientDot: {
    width: '6px',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: '#2F7D57',
    flex: '0 0 6px'
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    paddingLeft: '14px'
  },
  noteRow: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: '7px',
    alignItems: 'start',
    fontSize: '14px',
    lineHeight: 1.55,
    color: '#333333'
  },
  noteDash: {
    color: '#999999'
  },
  noteContent: {
    minWidth: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  },
  flaggedNote: {
    color: '#C0392B',
    fontWeight: 700
  },
  generalBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px 18px 16px'
  },
  generalNoteLabel: {
    marginBottom: '2px',
    fontSize: '11px',
    lineHeight: 1.35,
    fontWeight: 800,
    color: '#556677',
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  emptyText: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    padding: '10px 0'
  }
}
