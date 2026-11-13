import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { BarcodeEditor, BarcodeResultActions, type BarcodeEditorProps } from '../component/barcode-editor';

const meta = {
  title: 'Screens/Barcode editor', component: BarcodeEditor,
  args: { current: '00012345678905', productName: 'Example basmati rice', manual: false,
    onScan: fn(), onManual: fn(), onChange: fn(), onSave: fn(), onCancel: fn() },
  decorators: [Story => <View style={{ width: '100%', height: 560 }}><SafeAreaProvider
    initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 560 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
    <Story />
  </SafeAreaProvider></View>],
} satisfies Meta<typeof BarcodeEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Initial: Story = {};
export const Manual: Story = { args: { manual: true, proposed: '04006381333931' } };
export const ScannedProposal: Story = { args: { proposed: '04006381333931' } };
export const Invalid: Story = { args: { manual: true, proposed: '00012345678904', error: 'Enter a valid product barcode.' } };
export const ConflictingProduct: Story = { args: { ...Manual.args, error: 'This barcode belongs to Example brown rice.' } };
export const SaveFailure: Story = { args: { ...Manual.args, error: 'Could not save the barcode. Try again.' } };

function ResultExample(props: BarcodeEditorProps) {
  const [mode, setMode] = useState<'lookup' | 'edit'>();
  return mode ? <BarcodeEditor {...props} productName={mode === 'edit' ? props.productName : undefined}
    onCancel={() => setMode(undefined)} /> :
    <BarcodeResultActions barcode={props.current} onEdit={() => setMode('edit')} onLookup={() => setMode('lookup')} />;
}

export const ResultActions: Story = {
  render: args => <ResultExample {...args} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Correct lookup code' }));
    await expect(canvas.getByRole('button', { name: 'Look up barcode' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Edit barcode' }));
    await expect(canvas.getByText('Example basmati rice')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save barcode' })).toBeDisabled();
  },
};
