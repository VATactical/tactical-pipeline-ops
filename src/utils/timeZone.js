function datePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return { year: values.year, month: values.month, day: values.day }
}

function zonedMidnightToDate({ year, month, day }, timeZone) {
  const desired = Date.UTC(year, month - 1, day)
  let instant = desired

  for (let pass = 0; pass < 4; pass += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const adjustment = desired - shown
    instant += adjustment
    if (adjustment === 0) break
  }

  return new Date(instant)
}

export function getCalendarDayWindow(referenceDate, timeZone) {
  const currentDay = datePartsInTimeZone(referenceDate, timeZone)
  const nextDayDate = new Date(Date.UTC(currentDay.year, currentDay.month - 1, currentDay.day + 1))
  const nextDay = {
    year: nextDayDate.getUTCFullYear(),
    month: nextDayDate.getUTCMonth() + 1,
    day: nextDayDate.getUTCDate(),
  }
  const start = zonedMidnightToDate(currentDay, timeZone)
  const endExclusive = zonedMidnightToDate(nextDay, timeZone)

  return {
    reportDate: `${currentDay.year}-${String(currentDay.month).padStart(2, '0')}-${String(currentDay.day).padStart(2, '0')}`,
    start,
    end: new Date(endExclusive.getTime() - 1),
  }
}
