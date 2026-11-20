import {
  priceHistoryDetail, priceHistoryPage, priceHistoryQuery, priceObservationId, type PriceHistoryQuery,
} from '@cheapo/domain/price-history';

const collectionPath = '/v1/me/price-observations';

export function historyPagePath(query: PriceHistoryQuery) {
  const parsed = priceHistoryQuery.safeParse(query);
  if (!parsed.success) throw Error('Invalid Cheapo price history filter.');
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(parsed.data)) {
    if (value !== undefined) parameters.set(name, String(value));
  }
  const queryString = parameters.toString();
  return queryString ? `${collectionPath}?${queryString}` : collectionPath;
}

export function historyObservationPath(id: string) {
  if (!priceObservationId.safeParse(id).success) throw Error('Invalid Cheapo price ID.');
  return `${collectionPath}/${id}`;
}

export function decodeHistoryPage(raw: unknown) {
  const parsed = priceHistoryPage.safeParse(raw);
  if (!parsed.success) throw Error('Cheapo returned unreadable price history.');
  return parsed.data;
}

export function decodeHistoryObservation(raw: unknown, id: string) {
  const parsed = priceHistoryDetail.safeParse(raw);
  if (!parsed.success || parsed.data.observation.id !== id) throw Error('Cheapo returned an unreadable price.');
  return parsed.data;
}
