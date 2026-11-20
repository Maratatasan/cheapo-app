import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Text, View } from 'react-native';
import { expect, fn } from 'storybook/test';

import { HomeConnectionActions } from '../component/home-connection-actions';
import { ui } from '../component/results/theme';

const meta = {
  title: 'Screens/Home connection actions',
  component: HomeConnectionActions,
  render: args => <View style={[ui.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: 428 }]}>
    <Text accessibilityRole="header" style={ui.title}>Cheapo</Text>
    <HomeConnectionActions {...args} />
  </View>,
} satisfies Meta<typeof HomeConnectionActions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const IPhoneSharedShopping: Story = {
  args: { onCheapoAccess: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.queryByRole('button', { name: 'ChatGPT' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Cheapo access' }));
    await expect(args.onCheapoAccess).toHaveBeenCalledOnce();
  },
};

export const AndroidField: Story = {
  args: { onCheapoAccess: fn(), onChatGPT: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'ChatGPT' }));
    await expect(args.onChatGPT).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Cheapo access' }));
    await expect(args.onCheapoAccess).toHaveBeenCalledOnce();
  },
};

export const IPhoneSharedWithChatGPT: Story = {
  ...AndroidField,
  args: { onCheapoAccess: fn(), onChatGPT: fn() },
};
