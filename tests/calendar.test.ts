import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCalendar, calendarWeeks } from '../src/renderer/src/analytics/calendar'

test('heatmap distinguishes out-of-query dates, reported zero and future instead of inventing an annual zero history', () => {
  const c = buildCalendar([{day:'2026-10-28',activeMs:0},{day:'2026-10-29',activeMs:60000}],52,'2026-10-29')
  const days = c.columns.flatMap(c => c.days)
  assert.equal(days.find(d => d.day === '2026-10-28')?.state,'recorded')
  assert.equal(days.find(d => d.day === '2026-10-27')?.state,'outside')
  assert.equal(days.find(d => d.day === '2026-10-30')?.state,'future')
  assert.equal(c.total,60000)
  assert.equal(c.max,60000)
})
test('heatmap totals and intensity refer only to visible weeks; short query spans use the actual calendar columns', () => {
  const data = [{day:'2025-01-01',activeMs:9999999},{day:'2026-10-28',activeMs:1000},{day:'2026-10-29',activeMs:2000}]
  const c = buildCalendar(data,1,'2026-10-29')
  assert.equal(c.total,3000);assert.equal(c.max,2000)
  assert.equal(calendarWeeks(data.slice(1)),1)
  assert.equal(calendarWeeks([{day:'2026-10-25'},{day:'2026-10-29'}]),2)
  assert.equal(calendarWeeks(data),53)
})
test('calendar date arithmetic remains contiguous across leap day and DST boundaries', () => {
  const c=buildCalendar([{day:'2024-02-29',activeMs:5}],2,'2024-03-03')
  assert.equal(c.columns.flatMap(c=>c.days).filter(d=>d.day==='2024-02-29').length,1)
  const dst=buildCalendar([{day:'2026-11-01',activeMs:10},{day:'2026-11-02',activeMs:20}],2,'2026-11-02')
  assert.equal(dst.columns.length,2);assert.equal(dst.total,30)
  const days=dst.columns.flatMap(c=>c.days.map(d=>d.day));assert.equal(new Set(days).size,14)
})
