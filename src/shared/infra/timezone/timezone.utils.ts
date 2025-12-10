export function isValidTimeZone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return true
    } catch {
        return false
    }
}

export function hasExplicitTimezoneInfo(input?: string | null): boolean {
    if (!input) return false
    const trimmed = input.trim()
    return /([zZ])$/.test(trimmed) || /([+-]\d{2}:?\d{2})$/.test(trimmed)
}

export function convertTenantLocalDateToUTC(date: Date, timeZone: string): Date {
    const utcDate = new Date(
        Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds()
        )
    )

    const offsetMinutes = getTimeZoneOffsetMinutes(utcDate, timeZone)

    return new Date(utcDate.getTime() - offsetMinutes * 60 * 1000)
}

interface DateTimeComponents {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
    millisecond: number
}

function parseDateTimeComponents(input: string): DateTimeComponents | null {
    const trimmed = input.trim()

    if (!trimmed) {
        return null
    }

    const sanitized = trimmed.replace(/\s+/g, 'T')
    const [datePart, timePartRaw] = sanitized.split('T')

    if (!datePart) {
        return null
    }

    const dateMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/)

    if (!dateMatch) {
        return null
    }

    const [, yearStr, monthStr, dayStr] = dateMatch
    const year = Number(yearStr)
    const month = Number(monthStr)
    const day = Number(dayStr)

    if ([year, month, day].some((value) => Number.isNaN(value))) {
        return null
    }

    let hour = 0
    let minute = 0
    let second = 0
    let millisecond = 0

    if (timePartRaw) {
        const timePart = timePartRaw.trim()
        const timeMatch = timePart.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\.(\d{1,6}))?$/)

        if (!timeMatch) {
            return null
        }

        hour = Number(timeMatch[1])
        minute = timeMatch[2] ? Number(timeMatch[2]) : 0
        second = timeMatch[3] ? Number(timeMatch[3]) : 0

        const fractional = timeMatch[4]
        if (fractional) {
            const normalizedFraction = fractional.slice(0, 3).padEnd(3, '0')
            millisecond = Number(normalizedFraction)
        }

        if ([hour, minute, second, millisecond].some((value) => Number.isNaN(value))) {
            return null
        }
    }

    return { year, month, day, hour, minute, second, millisecond }
}

export function normalizeDateWithTimezone(
    date: Date,
    options: { timeZone?: string | null; originalInput?: string | null }
): Date {
    const { timeZone = null, originalInput = null } = options

    if (!timeZone) {
        return date
    }

    if (originalInput && hasExplicitTimezoneInfo(originalInput)) {
        const explicitDate = new Date(originalInput)
        if (!Number.isNaN(explicitDate.getTime())) {
            return explicitDate
        }
    }

    if (originalInput) {
        const components = parseDateTimeComponents(originalInput)

        if (components) {
            const { year, month, day, hour, minute, second, millisecond } = components
            const utcCandidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond))
            const offsetMinutes = getTimeZoneOffsetMinutes(utcCandidate, timeZone)
            return new Date(utcCandidate.getTime() - offsetMinutes * 60 * 1000)
        }
    }

    return date
}

export function isFutureDateWithTimezone(
    date: Date | null | undefined,
    options: { timeZone?: string | null; scheduledTimeInput?: string | null; referenceDate?: Date } = {}
): boolean {
    if (!date) {
        return true
    }

    const { timeZone = null, scheduledTimeInput = null, referenceDate } = options
    const now = referenceDate ?? new Date()

    if (scheduledTimeInput && hasExplicitTimezoneInfo(scheduledTimeInput)) {
        const explicitDate = new Date(scheduledTimeInput)
        if (!Number.isNaN(explicitDate.getTime())) {
            return explicitDate.getTime() > now.getTime()
        }
    }

    if (!timeZone) {
        return date.getTime() > now.getTime()
    }

    const normalizedDate = normalizeDateWithTimezone(date, {
        timeZone,
        originalInput: scheduledTimeInput,
    })

    return normalizedDate.getTime() > now.getTime()
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })

    const parts = dtf.formatToParts(date)
    const partValues = parts.reduce<Record<string, number>>((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = parseInt(part.value, 10)
        }
        return acc
    }, {})

    const asUTC = Date.UTC(
        partValues.year,
        partValues.month - 1,
        partValues.day,
        partValues.hour,
        partValues.minute,
        partValues.second,
        date.getUTCMilliseconds()
    )

    return (asUTC - date.getTime()) / (60 * 1000)
}
