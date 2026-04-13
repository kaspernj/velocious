// @ts-check

import {nextCronFireDate, parseCronExpression} from "../../src/background-jobs/cron-expression.js"

describe("Background jobs - cron expression", () => {
  it("parses a basic 5-field expression", () => {
    const parsed = parseCronExpression("0 9 * * 1-5")

    expect(parsed.minute.has(0)).toBeTrue()
    expect(parsed.minute.size).toEqual(1)
    expect(parsed.hour.has(9)).toBeTrue()
    expect(parsed.dayOfWeek.has(1)).toBeTrue()
    expect(parsed.dayOfWeek.has(5)).toBeTrue()
    expect(parsed.dayOfWeek.size).toEqual(5)
    expect(parsed.dayOfMonthRestricted).toBeFalse()
    expect(parsed.dayOfWeekRestricted).toBeTrue()
  })

  it("expands @hourly to 0 * * * *", () => {
    const parsed = parseCronExpression("@hourly")

    expect(parsed.minute.size).toEqual(1)
    expect(parsed.hour.size).toEqual(24)
    expect(parsed.dayOfMonthRestricted).toBeFalse()
    expect(parsed.dayOfWeekRestricted).toBeFalse()
  })

  it("expands @daily, @midnight, @weekly, @monthly, @yearly, @annually", () => {
    expect(parseCronExpression("@daily").hour.size).toEqual(1)
    expect(parseCronExpression("@midnight").hour.has(0)).toBeTrue()
    expect(parseCronExpression("@weekly").dayOfWeek.has(0)).toBeTrue()
    expect(parseCronExpression("@monthly").dayOfMonth.has(1)).toBeTrue()
    expect(parseCronExpression("@yearly").month.has(1)).toBeTrue()
    expect(parseCronExpression("@annually").month.has(1)).toBeTrue()
  })

  it("supports steps, ranges, and lists", () => {
    const parsed = parseCronExpression("*/15 0,12 1-7 * *")

    expect([...parsed.minute].sort((leftMinute, rightMinute) => leftMinute - rightMinute)).toEqual([0, 15, 30, 45])
    expect([...parsed.hour].sort((leftHour, rightHour) => leftHour - rightHour)).toEqual([0, 12])
    expect([...parsed.dayOfMonth].sort((leftDay, rightDay) => leftDay - rightDay)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("supports month and weekday names case-insensitively", () => {
    const parsed = parseCronExpression("0 12 * JAN-MAR mon,wed,FRI")

    expect(parsed.month.size).toEqual(3)
    expect(parsed.month.has(1)).toBeTrue()
    expect(parsed.month.has(3)).toBeTrue()
    expect(parsed.dayOfWeek.has(1)).toBeTrue()
    expect(parsed.dayOfWeek.has(3)).toBeTrue()
    expect(parsed.dayOfWeek.has(5)).toBeTrue()
  })

  it("treats Sunday as both 0 and 7", () => {
    expect(parseCronExpression("0 0 * * 7").dayOfWeek.has(0)).toBeTrue()
    expect(parseCronExpression("0 0 * * 0").dayOfWeek.has(0)).toBeTrue()
  })

  it("supports day-of-week ranges that span Sunday-as-7 (Fri-Sun)", () => {
    const parsed = parseCronExpression("0 0 * * 5-7")

    // 5=Fri, 6=Sat, 7→Sun normalizes to 0.
    expect(parsed.dayOfWeek.has(5)).toBeTrue()
    expect(parsed.dayOfWeek.has(6)).toBeTrue()
    expect(parsed.dayOfWeek.has(0)).toBeTrue()
    expect(parsed.dayOfWeek.has(7)).toBeFalse()
    expect(parsed.dayOfWeek.size).toEqual(3)
  })

  it("rejects expressions with the wrong field count", () => {
    expect(() => parseCronExpression("* * * *")).toThrow(/expected 5 fields/)
    expect(() => parseCronExpression("* * * * * *")).toThrow(/expected 5 fields/)
  })

  it("rejects out-of-range values", () => {
    expect(() => parseCronExpression("60 * * * *")).toThrow(/out of range/)
    expect(() => parseCronExpression("* 24 * * *")).toThrow(/out of range/)
  })

  it("computes the next fire after a given reference Date for hourly", () => {
    const parsed = parseCronExpression("0 * * * *")
    const reference = new Date(2026, 0, 1, 9, 30, 12)
    const next = nextCronFireDate(parsed, reference)

    expect(next.getFullYear()).toEqual(2026)
    expect(next.getMonth()).toEqual(0)
    expect(next.getDate()).toEqual(1)
    expect(next.getHours()).toEqual(10)
    expect(next.getMinutes()).toEqual(0)
  })

  it("rolls forward across day/month boundaries for daily", () => {
    const parsed = parseCronExpression("0 9 * * *")
    const reference = new Date(2026, 0, 1, 23, 59, 30)
    const next = nextCronFireDate(parsed, reference)

    expect(next.getDate()).toEqual(2)
    expect(next.getHours()).toEqual(9)
    expect(next.getMinutes()).toEqual(0)
  })

  it("OR-combines day-of-month and day-of-week when both are restricted (POSIX semantics)", () => {
    // Fires on the 1st OR on Sunday.
    const parsed = parseCronExpression("0 0 1 * 0")
    // 2026-01-04 is a Sunday.
    const sundayMatch = nextCronFireDate(parsed, new Date(2026, 0, 3, 12, 0, 0))

    expect(sundayMatch.getDate()).toEqual(4)
    expect(sundayMatch.getDay()).toEqual(0)

    // From 2026-01-05 (Monday), the next match is the 11th (Sunday)
    // — neither 1st of month nor Sunday until then.
    const nextSundayMatch = nextCronFireDate(parsed, new Date(2026, 0, 5, 0, 0, 0))

    expect(nextSundayMatch.getDate()).toEqual(11)
    expect(nextSundayMatch.getDay()).toEqual(0)
  })

  it("throws for expressions that can never match", () => {
    // Feb 31st never exists.
    const parsed = parseCronExpression("0 0 31 2 *")

    expect(() => nextCronFireDate(parsed, new Date(2026, 0, 1))).toThrow(/never matches/)
  })

  it("finds the next leap-year-only fire (Feb 29) even from a non-leap year", () => {
    const parsed = parseCronExpression("0 0 29 2 *")
    // 2026 is not a leap year; the next Feb 29 is 2028-02-29.
    const next = nextCronFireDate(parsed, new Date(2026, 2, 1, 0, 0, 0))

    expect(next.getFullYear()).toEqual(2028)
    expect(next.getMonth()).toEqual(1)
    expect(next.getDate()).toEqual(29)
    expect(next.getHours()).toEqual(0)
    expect(next.getMinutes()).toEqual(0)
  })
})
