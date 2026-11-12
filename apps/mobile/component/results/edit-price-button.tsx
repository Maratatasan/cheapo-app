import { Pressable, StyleSheet, Text } from 'react-native';
import { color, radius, spacing, typography } from './theme';

export function EditPriceButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.text}>Edit</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 48,
    paddingHorizontal: spacing.sm, borderRadius: radius.control, backgroundColor: color.mint,
  },
  text: { color: color.green, fontSize: typography.body, fontWeight: '700' },
});
