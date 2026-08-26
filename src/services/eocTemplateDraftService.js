import { collection, deleteDoc, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeEocTemplateDefinition } from '../utils/eocTemplateModel'

function cleanId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160)
}

export function createEocTemplateDraftId(user, templateId = '') {
  const owner = cleanId(user?.authUid || user?.id || 'user')
  const target = cleanId(templateId)
  if (target) return `draft_${owner}_${target}`
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  return `draft_${owner}_${suffix}`
}

export function watchEocTemplateDrafts(user, onData, onError) {
  const authUid = String(user?.authUid || '').trim()
  if (!authUid) {
    onData([])
    return () => {}
  }
  return onSnapshot(
    query(collection(db, 'eocTemplateDrafts'), where('ownerAuthUid', '==', authUid)),
    snapshot => onData(snapshot.docs.map(draftDoc => ({ id: draftDoc.id, ...draftDoc.data() }))),
    onError
  )
}

export async function saveEocTemplateDraft({ draftId, user, template, targetTemplateId = '', cloneMeta = null }) {
  const normalizedDraftId = cleanId(draftId)
  const ownerAuthUid = String(user?.authUid || '').trim()
  const ownerUserId = String(user?.id || '').trim()
  if (!normalizedDraftId || !ownerAuthUid || !ownerUserId) throw new Error('A signed-in staff profile is required to save drafts.')

  const draftRef = doc(db, 'eocTemplateDrafts', normalizedDraftId)
  const draftTemplate = normalizeEocTemplateDefinition(template, { includeIncomplete: true })
  await runTransaction(db, async (transaction) => {
    const existingSnap = await transaction.get(draftRef)
    const shared = {
      ownerAuthUid,
      ownerUserId,
      ownerName: String(user?.name || '').trim(),
      targetTemplateId: cleanId(targetTemplateId) || null,
      cloneMeta: cloneMeta ? {
        clonedFromTemplateId: cleanId(cloneMeta.clonedFromTemplateId) || null,
        clonedFromTemplateName: String(cloneMeta.clonedFromTemplateName || '').trim().slice(0, 160),
        clonedFromVersion: Number(cloneMeta.clonedFromVersion || 0) || null
      } : null,
      template: draftTemplate,
      templateName: draftTemplate.name || 'Untitled template',
      eocType: draftTemplate.eocType,
      updatedAt: serverTimestamp(),
      version: Number(existingSnap.data()?.version || 0) + 1
    }
    if (existingSnap.exists()) transaction.update(draftRef, shared)
    else transaction.set(draftRef, { ...shared, createdAt: serverTimestamp() })
  })
}

export async function deleteEocTemplateDraft(draftId) {
  const normalizedDraftId = cleanId(draftId)
  if (!normalizedDraftId) return
  await deleteDoc(doc(db, 'eocTemplateDrafts', normalizedDraftId))
}
