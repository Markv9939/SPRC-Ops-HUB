import { auth, db } from '../firebase'
import {
  GoogleAuthProvider,
  browserSessionPersistence,
  setPersistence,
  signInWithPopup,
  signOut
} from 'firebase/auth'
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore'
import { getScopedSessionUser } from './accessGrantService'

export const COMPANY_EMAIL_DOMAIN = 'scottsdaleprovidence.com'
export const FIRST_ADMIN_USER_ID = 'admin_owner'
export const FIRST_ADMIN_EMAIL = 'mark@scottsdaleprovidence.com'

function trim(value) {
  return String(value || '').trim()
}

export function normalizeEmail(value) {
  return trim(value).toLowerCase()
}

export function getEmailDomain(email) {
  const normalized = normalizeEmail(email)
  const parts = normalized.split('@')
  return parts.length === 2 ? parts[1] : ''
}

export function isCompanyEmail(email) {
  return getEmailDomain(email) === COMPANY_EMAIL_DOMAIN
}

function hasCompleteExternalApproval(link) {
  return link?.emailType === 'external'
    && link?.externalGoogleAllowed === true
    && trim(link?.externalReason)
    && trim(link?.externalApprovedByUserId)
    && trim(link?.externalApprovedByName)
    && !!link?.externalApprovedAt
}

function validateEmailLink(emailLink, normalizedEmail) {
  if (!emailLink?.active) {
    throw new Error('This Google email is not approved for Ops Hub.')
  }
  if (normalizeEmail(emailLink.email) !== normalizedEmail) {
    throw new Error('Email approval record does not match this Google account.')
  }
  if (emailLink.emailType === 'company') {
    if (!isCompanyEmail(normalizedEmail) || emailLink.externalGoogleAllowed === true) {
      throw new Error('Company email approval is not valid.')
    }
    return
  }
  if (!hasCompleteExternalApproval(emailLink)) {
    throw new Error('External Google email approval is incomplete.')
  }
}

async function buildSessionFromUserId(userId, authUser, email) {
  const userSnap = await getDoc(doc(db, 'users', userId))
  if (!userSnap.exists()) throw new Error('Approved profile was not found.')

  const userData = userSnap.data()
  if (userData.active === false || userData.deleted === true) {
    throw new Error('This Ops Hub profile is inactive.')
  }

  const scopedSessionUser = await getScopedSessionUser(userId, userData)
  return {
    ...scopedSessionUser,
    authUid: authUser.uid,
    authEmail: email,
    email,
    authProvider: 'google',
    authScopeEnforced: true
  }
}

async function resolveExistingMapping(authUser, normalizedEmail) {
  const mappingSnap = await getDoc(doc(db, 'usersByAuthUid', authUser.uid))
  if (!mappingSnap.exists()) return null

  const mapping = mappingSnap.data()
  if (normalizeEmail(mapping.email) !== normalizedEmail) {
    throw new Error('This browser is linked to a different approved Google email. Sign out and use the approved account.')
  }
  return buildSessionFromUserId(mapping.userId, authUser, normalizedEmail)
}

export async function resolveCurrentAuthSession() {
  const authUser = auth.currentUser
  if (!authUser?.uid) return null
  const normalizedEmail = normalizeEmail(authUser.email)
  if (!normalizedEmail || authUser.emailVerified !== true) return null
  return resolveExistingMapping(authUser, normalizedEmail)
}

async function linkApprovedEmail(authUser, normalizedEmail) {
  const emailDomain = getEmailDomain(normalizedEmail)
  const mappingRef = doc(db, 'usersByAuthUid', authUser.uid)
  const emailLinkRef = doc(db, 'userEmailLinks', normalizedEmail)
  const firstAdminRef = doc(db, 'users', FIRST_ADMIN_USER_ID)

  return runTransaction(db, async (transaction) => {
    const existingMapping = await transaction.get(mappingRef)
    if (existingMapping.exists()) {
      const mapping = existingMapping.data()
      if (normalizeEmail(mapping.email) !== normalizedEmail) {
        throw new Error('This Google account is already linked to a different Ops Hub profile.')
      }
      return mapping.userId
    }

    const emailLinkSnap = await transaction.get(emailLinkRef)
    let emailLink = emailLinkSnap.exists() ? emailLinkSnap.data() : null
    let userId = emailLink?.userId || ''

    if (!emailLink && normalizedEmail === FIRST_ADMIN_EMAIL) {
      const firstAdminSnap = await transaction.get(firstAdminRef)
      if (!firstAdminSnap.exists()) throw new Error('First admin profile is missing.')
      const firstAdmin = firstAdminSnap.data()
      if (firstAdmin.active === false || firstAdmin.role !== 'admin') {
        throw new Error('First admin profile is not active admin.')
      }
      userId = FIRST_ADMIN_USER_ID
      emailLink = {
        userId,
        email: normalizedEmail,
        emailDomain,
        emailType: 'company',
        externalGoogleAllowed: false,
        active: true
      }
      transaction.set(emailLinkRef, {
        ...emailLink,
        linkedAuthUid: authUser.uid,
        linkedAt: serverTimestamp(),
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    } else {
      validateEmailLink(emailLink, normalizedEmail)
      if (emailLink.linkedAuthUid && emailLink.linkedAuthUid !== authUser.uid) {
        throw new Error('This approved email is already linked to another Google sign-in.')
      }
      userId = emailLink.userId
      transaction.update(emailLinkRef, {
        linkedAuthUid: authUser.uid,
        linkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        version: Number(emailLink.version || 1) + 1
      })
    }

    transaction.set(mappingRef, {
      userId,
      email: normalizedEmail,
      emailDomain,
      linkedAt: serverTimestamp(),
      linkedBy: normalizedEmail === FIRST_ADMIN_EMAIL ? 'self_first_login' : 'self_first_login',
      version: 1
    })

    return userId
  })
}

export async function signInWithApprovedGoogle() {
  await setPersistence(auth, browserSessionPersistence)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  const credential = await signInWithPopup(auth, provider)
  const authUser = credential.user
  const normalizedEmail = normalizeEmail(authUser?.email)

  if (!authUser?.uid || !normalizedEmail) {
    await signOut(auth)
    throw new Error('Google did not return a usable email address.')
  }
  if (authUser.emailVerified !== true) {
    await signOut(auth)
    throw new Error('Google email must be verified before Ops Hub can allow access.')
  }

  const existingSession = await resolveExistingMapping(authUser, normalizedEmail)
  if (existingSession) return existingSession

  const userId = await linkApprovedEmail(authUser, normalizedEmail)
  return buildSessionFromUserId(userId, authUser, normalizedEmail)
}
