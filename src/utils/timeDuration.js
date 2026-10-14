export function formatHoursAndMinutes(decimalHours) {
  const totalMinutes = Math.max(0, Math.round(Number(decimalHours || 0) * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours && minutes) return `${hours} h ${minutes} min`
  if (hours) return `${hours} h`
  return `${minutes} min`
}

export function normalizeHoursAndMinutes(hoursValue, minutesValue) {
  const hours = Number(hoursValue) || 0
  const minutes = Number(minutesValue)
  if (!Number.isInteger(minutes) || minutes < 60) return null
  const totalMinutes = hours * 60 + minutes
  return { hours: String(Math.floor(totalMinutes / 60)), minutes: String(totalMinutes % 60) }
}
