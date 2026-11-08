/**
 * Перетворення між моментом (Date, UTC) і місцевим часом автошколи
 * (Organization.timezone) без сторонніх бібліотек: лише Intl.
 *
 * Місцева дата — рядок YYYY-MM-DD, місцевий час — хвилина від півночі
 * (540 = 09:00, 1440 = північ наступного дня).
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Форматер на кожен пояс створюється один раз: конструктор Intl дорогий. */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Місцеві дата й час моменту як «UTC-мілісекунди настінного годинника». */
function wallClockMs(instant: number, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
}

/** Зсув поясу від UTC у хвилинах у момент instant: Київ узимку — 120. */
function offsetMinutes(instant: number, timeZone: string): number {
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  return Math.round(
    (wallClockMs(wholeSecond, timeZone) - wholeSecond) / MINUTE_MS,
  );
}

function parseLocalDate(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Місцевий час → момент. Два проходи: зсув у «наївному» моменті, потім зсув
 * у знайденому кандидаті — цього досить для будь-якого одного переходу.
 * exists = false, коли такого місцевого часу немає (перехід на літній час);
 * тоді instant — момент одразу після розриву, як у Temporal 'compatible'.
 * Неоднозначний час при переході на зимовий дає один із двох моментів (для
 * поясів зі сходу від UTC, як Київ, — пізніший).
 */
function resolveLocalTime(
  date: string,
  minute: number,
  timeZone: string,
): { instant: Date; exists: boolean } {
  const wall = parseLocalDate(date) + minute * MINUTE_MS;
  const first = offsetMinutes(wall, timeZone);
  const second = offsetMinutes(wall - first * MINUTE_MS, timeZone);
  const candidate = wall - second * MINUTE_MS;
  if (offsetMinutes(candidate, timeZone) === second) {
    return { instant: new Date(candidate), exists: true };
  }
  return {
    instant: new Date(wall - Math.min(first, second) * MINUTE_MS),
    exists: false,
  };
}

/** Місцева дата у форматі YYYY-MM-DD (en-CA). */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Момент місцевого часу date + minute у поясі timeZone. null, якщо такого
 * часу немає (перехід на літній час): слот на цей час не створюється.
 */
export function zonedTimeToUtc(
  date: string,
  minute: number,
  timeZone: string,
): Date | null {
  const resolved = resolveLocalTime(date, minute, timeZone);
  return resolved.exists ? resolved.instant : null;
}

/**
 * Початок місцевого дня. Якщо північ пропущено переходом на літній час
 * (буває в деяких поясах), — перший момент цього дня.
 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  return resolveLocalTime(date, 0, timeZone).instant;
}

/** Місцева дата через days днів. Календарна арифметика, без поясу. */
export function addDays(date: string, days: number): string {
  return new Date(parseLocalDate(date) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** День тижня місцевої дати за ISO: 1 — понеділок, 7 — неділя. Без поясу. */
export function isoWeekday(date: string): number {
  const day = new Date(parseLocalDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}
