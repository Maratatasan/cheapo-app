import { Button, View } from 'react-native';

import { ui } from './results/theme';

export function HomeConnectionActions({ onChatGPT, onCheapoAccess }: {
  onChatGPT?: () => void;
  onCheapoAccess?: () => void;
}) {
  return <View style={ui.row}>
    {onChatGPT ? <Button title="ChatGPT" onPress={onChatGPT} /> : null}
    {onCheapoAccess ? <Button title="Cheapo access" onPress={onCheapoAccess} /> : null}
  </View>;
}
