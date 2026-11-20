import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Text, View } from 'react-native';
import { expect, fn } from 'storybook/test';

import { ChatGPTSignInActions } from '../component/chatgpt-sign-in-actions';
import { ui } from '../component/results/theme';

const meta = {
  title: 'Screens/ChatGPT sign-in',
  component: ChatGPTSignInActions,
  args: {
    showChromeOption: true,
    onSignIn: fn(),
    onContinue: fn(),
    onCancel: fn(),
    state: { message: 'Not signed in on this phone.', busy: false, awaitingContinue: false,
      signedIn: false, savedLogin: false, planAllowed: false },
  },
  render: args => <View style={[ui.content, { maxWidth: 440, backgroundColor: ui.page.backgroundColor }]}>
    <Text style={ui.title}>Connect ChatGPT</Text>
    <ChatGPTSignInActions {...args} />
  </View>,
} satisfies Meta<typeof ChatGPTSignInActions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const IPhone: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in using Chrome' }));
    await expect(args.onSignIn).toHaveBeenCalledWith('chrome');
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in with ChatGPT on this phone' }));
    await expect(args.onSignIn).toHaveBeenCalledWith('default');
  },
};

export const ChromeUnavailable: Story = { args: {
  state: { ...meta.args.state, message: 'Chrome could not open. Install or update Chrome, then try again.' },
} };

export const ContinueSignIn: Story = {
  args: { state: { ...meta.args.state, busy: true, awaitingContinue: true,
    message: 'Browser sign-in received. Return to Cheapo and tap Continue to finish sign-in.' } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: 'Sign in using Chrome' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Continue sign-in' }));
    await expect(args.onContinue).toHaveBeenCalledOnce();
  },
};
