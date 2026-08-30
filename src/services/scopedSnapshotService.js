import { onSnapshot } from 'firebase/firestore'

export function subscribeMergedQueryRows(queryList, onRows, options = {}) {
  const queries = Array.isArray(queryList) ? queryList.filter(Boolean) : []
  if (queries.length === 0) {
    onRows([])
    return () => {}
  }

  const rowsByQuery = new Map()
  const publish = () => {
    const rowsById = new Map()
    rowsByQuery.forEach(rows => rows.forEach(row => rowsById.set(row.id, row)))
    const rows = [...rowsById.values()]
    if (typeof options.sort === 'function') rows.sort(options.sort)
    onRows(rows)
  }

  const unsubscribers = queries.map((queryRef, index) => onSnapshot(
    queryRef,
    (snapshot) => {
      rowsByQuery.set(index, snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
      publish()
    },
    options.onError
  ))

  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
