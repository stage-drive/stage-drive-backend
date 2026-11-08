import {
  addDays,
  isoWeekday,
  localDate,
  startOfLocalDay,
  zonedTimeToUtc,
} from './zoned-time';

const KYIV = 'Europe/Kyiv';
const NEW_YORK = 'America/New_York';

describe('zonedTimeToUtc', () => {
  it.each([
    [
      'Kyiv winter (UTC+2)',
      '2026-11-16',
      9 * 60,
      KYIV,
      '2026-11-16T07:00:00.000Z',
    ],
    [
      'Kyiv summer (UTC+3)',
      '2027-06-14',
      9 * 60,
      KYIV,
      '2027-06-14T06:00:00.000Z',
    ],
    [
      'midnight that ends the day',
      '2026-11-16',
      1440,
      KYIV,
      '2026-11-16T22:00:00.000Z',
    ],
    [
      'New York winter (UTC-5)',
      '2026-12-01',
      9 * 60,
      NEW_YORK,
      '2026-12-01T14:00:00.000Z',
    ],
    ['UTC', '2026-11-16', 13 * 60 + 30, 'UTC', '2026-11-16T13:30:00.000Z'],
  ])('%s', (_, date, minute, zone, expected) => {
    expect(zonedTimeToUtc(date, minute, zone)?.toISOString()).toBe(expected);
  });

  describe('Kyiv spring-forward on 2027-03-28 (03:00 → 04:00)', () => {
    it('keeps the hour before the gap in winter time', () => {
      expect(
        zonedTimeToUtc('2027-03-28', 2 * 60 + 30, KYIV)?.toISOString(),
      ).toBe('2027-03-28T00:30:00.000Z');
    });

    it('returns null for a local time inside the gap', () => {
      expect(zonedTimeToUtc('2027-03-28', 3 * 60 + 30, KYIV)).toBeNull();
    });

    it('keeps the hour after the gap in summer time', () => {
      expect(
        zonedTimeToUtc('2027-03-28', 4 * 60 + 30, KYIV)?.toISOString(),
      ).toBe('2027-03-28T01:30:00.000Z');
    });

    it('gives a day 23 hours long', () => {
      const start = zonedTimeToUtc('2027-03-28', 0, KYIV);
      const end = zonedTimeToUtc('2027-03-28', 1440, KYIV);
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    });
  });

  describe('Kyiv fall-back on 2026-10-25 (04:00 → 03:00)', () => {
    it('resolves the repeated hour to one real instant', () => {
      const instant = zonedTimeToUtc('2026-10-25', 3 * 60 + 30, KYIV);
      expect(localDate(instant, KYIV)).toBe('2026-10-25');
      expect([
        '2026-10-25T00:30:00.000Z',
        '2026-10-25T01:30:00.000Z',
      ]).toContain(instant.toISOString());
    });

    it('gives a day 25 hours long', () => {
      const start = zonedTimeToUtc('2026-10-25', 0, KYIV);
      const end = zonedTimeToUtc('2026-10-25', 1440, KYIV);
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
    });

    it('puts working hours after the switch in winter time', () => {
      expect(zonedTimeToUtc('2026-10-25', 9 * 60, KYIV)?.toISOString()).toBe(
        '2026-10-25T07:00:00.000Z',
      );
    });
  });

  it('returns null inside the New York spring-forward gap', () => {
    expect(zonedTimeToUtc('2027-03-14', 2 * 60 + 30, NEW_YORK)).toBeNull();
  });
});

describe('startOfLocalDay', () => {
  it('is local midnight in the zone', () => {
    expect(startOfLocalDay('2026-11-16', KYIV).toISOString()).toBe(
      '2026-11-15T22:00:00.000Z',
    );
  });

  it('moves forward past a skipped midnight instead of failing', () => {
    // Чилі: 2026-09-06 о 00:00 годинник переводять на 01:00.
    const start = startOfLocalDay('2026-09-06', 'America/Santiago');
    expect(localDate(start, 'America/Santiago')).toBe('2026-09-06');
  });
});

describe('localDate', () => {
  it('uses the zone, not UTC', () => {
    expect(localDate(new Date('2026-11-15T22:30:00Z'), KYIV)).toBe(
      '2026-11-16',
    );
    expect(localDate(new Date('2026-11-15T22:30:00Z'), 'UTC')).toBe(
      '2026-11-15',
    );
  });
});

describe('addDays', () => {
  it.each([
    ['2026-11-16', 1, '2026-11-17'],
    ['2026-11-30', 1, '2026-12-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-11-16', -16, '2026-10-31'],
    ['2026-10-24', 1, '2026-10-25'],
  ])('%s + %d → %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe('isoWeekday', () => {
  it.each([
    ['2026-11-16', 1],
    ['2026-11-18', 3],
    ['2026-11-21', 6],
    ['2026-11-22', 7],
    ['2028-02-29', 2],
  ])('%s → %d', (date, expected) => {
    expect(isoWeekday(date)).toBe(expected);
  });
});
