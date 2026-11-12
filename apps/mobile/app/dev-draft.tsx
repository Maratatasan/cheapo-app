import { ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { AiDraftCard } from '@/component/results/ai-draft-card';
import { ui } from '@/component/results/theme';
/** Offline development fixture: renders the same adapter/card as the live response. */
export default function DevDraft() {
  if (!__DEV__) return null;
  return <ScrollView style={ui.page} contentContainerStyle={ui.content}>
    <Stack.Screen options={{title:'AI card · offline fixture'}} />
    <Text style={ui.eyebrow}>OFFLINE UI CHECK · NO AI REQUEST</Text>
    <AiDraftCard draft={{product:'Albert Bartlett Rooster Potatoes 2kg',price:2.5,currency:'GBP',unit_price:{amount:1.25,unit:'kg'},uncertainty:'Fixture: product and prices are visible; shop, date and offer conditions still need review.'}} />
  </ScrollView>;
}
