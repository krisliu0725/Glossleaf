export interface CalendarDay { day: string; ms: number; state: 'recorded' | 'outside' | 'future' }
const DAY = 86400000
const stamp = (day: string): number => Date.parse(day + 'T00:00:00Z')
const key = (value: number): string => new Date(value).toISOString().slice(0, 10)
const monday = (value: number): number => value - ((new Date(value).getUTCDay() + 6) % 7) * DAY
/** Date-only arithmetic: input keys already belong to the selected IANA timezone. */
export function calendarWeeks(data: Array<{day:string}>): number {
  if (!data.length) return 1
  const days = data.map(r => stamp(r.day)).filter(Number.isFinite)
  return Math.min(53, Math.max(1, Math.round((monday(Math.max(...days)) - monday(Math.min(...days))) / DAY / 7) + 1))
}
export function buildCalendar(data: Array<{day:string;activeMs:number}>, weeks: number, today: string): {columns:Array<{days:CalendarDay[];total:number}>;total:number;max:number} {
  const values = new Map(data.map(r => [r.day, r.activeMs]))
  const end = stamp(today), start = monday(end) - (Math.max(1,weeks) - 1) * 7 * DAY
  const columns = Array.from({length:Math.max(1,weeks)}, (_,c) => {
    const days = Array.from({length:7}, (_,r):CalendarDay => {
      const value = start + (c * 7 + r) * DAY, day = key(value)
      const state = value > end ? 'future' : values.has(day) ? 'recorded' : 'outside'
      return {day,ms:state === 'recorded' ? Math.max(0,values.get(day) ?? 0) : 0,state}
    })
    return {days,total:days.reduce((n,d) => n+d.ms,0)}
  })
  return {columns,total:columns.reduce((n,c) => n+c.total,0),max:Math.max(0,...columns.flatMap(c => c.days.map(d => d.ms)))}
}
