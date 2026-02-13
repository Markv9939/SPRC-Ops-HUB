export function getStatus(dueDate) {
  if (!dueDate) return 'none'
  const dateValue = dueDate.toDate ? dueDate.toDate() : new Date(dueDate)
  if (isNaN(dateValue)) return 'none'

  const now = new Date()
  const diff = dateValue.getTime() - now.getTime()
  const days = diff / (1000 * 60 * 60 * 24)
  if (days < 0) return 'overdue'
  if (days <= 30) return 'upcoming'
  return 'current'
}
