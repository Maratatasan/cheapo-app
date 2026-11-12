import { StyleSheet } from "react-native";
export const color = {
  ink: "#183D32",
  green: "#196747",
  mint: "#E7F1E8",
  cream: "#F7F7F0",
  muted: "#66746B",
  line: "#DDE4D9",
  amber: "#FFF0CE",
  warningInk: "#8C5E16",
  white: "#FFFFFF",
};
// A small scale shared by app components and their browser stories.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 24 } as const;
export const radius = { control: 16, card: 22, pill: 30 } as const;
export const typography = {
  caption: 12,
  body: 14,
  label: 16,
  card: 18,
  section: 20,
  price: 26,
  title: 34,
} as const;
export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.cream },
  content: {
    width: "100%",
    maxWidth: 740,
    alignSelf: "center",
    padding: 22,
    gap: 18,
    paddingBottom: 40,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: color.green,
  },
  title: {
    fontSize: typography.title,
    lineHeight: 39,
    fontWeight: "800",
    color: color.ink,
    letterSpacing: -1,
  },
  body: { fontSize: typography.body, lineHeight: 21, color: color.muted },
  small: { fontSize: typography.caption, lineHeight: 18, color: color.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pill: {
    borderRadius: radius.pill,
    backgroundColor: color.mint,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { color: color.green, fontSize: 11, fontWeight: "800" },
  button: {
    paddingVertical: 13,
    paddingHorizontal: 19,
    borderRadius: 28,
    backgroundColor: color.green,
    alignItems: "center",
    minHeight: 46,
  },
  buttonText: { fontSize: typography.body, fontWeight: "700", color: "#FFF" },
  card: {
    padding: 19,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: "#FFF",
    gap: 12,
  },
});
