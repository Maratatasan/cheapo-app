import { Pressable, ScrollView, Text, View } from 'react-native';

import { ui } from '@/component/results/theme';
import type { ShopCandidate } from '@/data/cheapo-shopping-reads';
import type { ShopCandidateSearch } from '@/data/shop-repository';

export function ShopBranchConfirmation({ result, busy, error, onUse, onCreate, onBack }: {
  result: ShopCandidateSearch;
  busy?: boolean;
  error?: string;
  onUse: (candidate: ShopCandidate) => void;
  onCreate: () => void;
  onBack: () => void;
}) {
  return (
    <ScrollView style={ui.page} contentContainerStyle={ui.content}>
      <Text accessibilityRole="header" style={ui.title}>Confirm shop branch</Text>
      {result.status === 'unavailable' ? (
        <Text style={ui.body}>Shared shops could not be checked. Confirm this is a new branch before saving it.</Text>
      ) : result.status === 'needs-details' ? (
        <Text style={ui.body}>Enter a shop name or address to check for an existing branch.</Text>
      ) : result.shops.length ? (
        <Text style={ui.body}>Choose the same branch if it is listed. Your nickname stays private to your household.</Text>
      ) : <Text style={ui.body}>No matching branches were found.</Text>}
      {error ? <Text accessibilityRole="alert" style={ui.body}>{error}</Text> : null}
      {result.shops.map(candidate => (
        <Pressable key={candidate.id} accessibilityRole="button" disabled={busy}
          accessibilityLabel={`Use ${[candidate.name, candidate.address].filter(Boolean).join(', ')}`}
          onPress={() => onUse(candidate)} style={ui.card}>
          {candidate.name ? <Text style={ui.body}>{candidate.name}</Text> : null}
          {candidate.address ? <Text style={ui.small}>{candidate.address}</Text> : null}
        </Pressable>
      ))}
      <View style={ui.row}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onCreate} style={ui.button}>
          <Text style={ui.buttonText}>{busy ? 'Saving shop…' : 'Add as a new shop'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onBack} style={ui.card}>
          <Text style={ui.body}>Back to details</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
