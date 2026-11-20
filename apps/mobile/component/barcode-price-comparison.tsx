import { Button, Text } from 'react-native';

import type { BarcodeSharedPriceHistory } from '@/data/barcode-shared-prices';
import type { DraftShop } from '@/data/local-photo';
import { CurrentShopPrice } from './results/current-shop-price';
import { ShopComparison, type ComparisonRow, type ShopComparisonProps } from './results/shop-comparison';
import { ui } from './results/theme';

export function BarcodePriceComparison({ comparison, currentShop, currentPrice, history, paging, onRecord, onMore }: {
  comparison: ShopComparisonProps;
  currentShop?: DraftShop;
  currentPrice?: Pick<ComparisonRow, 'price' | 'currency'> & { capturedOn: string };
  history?: Pick<BarcodeSharedPriceHistory, 'lastSyncedAt' | 'cached' | 'unavailable' | 'hasMore'>;
  paging?: boolean;
  onRecord: () => void;
  onMore: () => void;
}) {
  return <>
    {history?.lastSyncedAt ? <Text style={ui.small}>Last synced {new Date(history.lastSyncedAt).toLocaleString()}</Text> : null}
    {history?.cached ? <Text style={ui.small}>Showing cached shared prices</Text> : null}
    {history?.unavailable ? <Text style={ui.small}>Shared comparisons unavailable</Text> : null}
    {currentShop ? <CurrentShopPrice shop={currentShop.displayName} observation={currentPrice}
      noObservationText={history && (history.hasMore || history.unavailable) ? 'No price in the available history' : undefined}
      onRecord={onRecord} /> : null}
    <ShopComparison {...comparison} />
    {history?.hasMore ? <Button title="Load more saved prices" disabled={paging} onPress={onMore} /> : null}
  </>;
}
