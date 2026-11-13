import { Button, Text, View } from 'react-native';
import { dateLabel, priceLabel, type PriceValues } from '@/data/observation';
import { marketColor, typography, ui } from './theme';

export function CurrentShopPrice({ shop, observation, onRecord }: {
  shop: string;
  observation?: Pick<PriceValues, 'price' | 'currency'> & { capturedOn: string };
  onRecord: () => void;
}) {
  return (
    <View style={ui.card}>
      <Text accessibilityRole="header" style={{ color: marketColor.ink, fontSize: typography.card, fontWeight: '700' }}>{shop}</Text>
      {observation ? <>
        <Text style={ui.body}>{priceLabel(observation)} pack</Text>
        <Text style={ui.small}>Recorded {dateLabel(observation.capturedOn)}</Text>
      </> : <Text style={ui.body}>No price saved at this shop</Text>}
      <Button title={observation ? 'Update price' : 'Add price'} onPress={onRecord} />
    </View>
  );
}
