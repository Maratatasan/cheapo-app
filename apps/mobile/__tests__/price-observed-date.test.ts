import { observedDay, originalPhotoDate, suggestedObservedDay, timestampForObservedDay, validObservedDay } from '@/data/price-observed-date';

test('preserves the original day without guessing a missing timezone', () => {
  expect(originalPhotoDate('2020:11:18 15:03:23', undefined, '911', '2020-11-20')).toEqual({ takenOn: '2020-11-18' });
  expect(originalPhotoDate('2020:11:18 15:03:23', '+00:00', '911', '2020-11-20')).toEqual({
    takenOn: '2020-11-18', takenAt: '2020-11-18T15:03:23.911Z',
  });
});

test.each(['2020:11:21 13:00:00', '2020:11:31 13:00:00', '2020:11:18 24:00:00', '2020-11-18', null])(
  'ignores unusable original date %s', value => {
    expect(originalPhotoDate(value, '+00:00', undefined, '2020-11-20')).toBeUndefined();
  },
);

test('keeps a pre-midnight capture on its original calendar day in price history', () => {
  const photo = originalPhotoDate('2020:11:18 23:30:00', '-08:00', undefined, '2020-11-20');
  expect(photo).toEqual({ takenOn: '2020-11-18', takenAt: '2020-11-19T07:30:00.000Z' });
  expect(observedDay(timestampForObservedDay(photo!.takenOn, photo!.takenAt!)!)).toBe('2020-11-18');
  expect(timestampForObservedDay('2020-11-19', photo!.takenAt!)).toBe(photo!.takenAt);
});

test('uses the local calendar for fallback and blocks invalid or future entries', () => {
  expect(suggestedObservedDay(undefined, new Date(2020, 10, 20, 23, 45).toISOString())).toBe('2020-11-20');
  expect(validObservedDay('2020-11-21', '2020-11-20')).toBe(false);
  expect(timestampForObservedDay('2020-02-30', '2020-11-20T12:00:00.000Z')).toBeUndefined();
});
