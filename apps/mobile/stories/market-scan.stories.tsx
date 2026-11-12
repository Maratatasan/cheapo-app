import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fireEvent } from 'storybook/test';
import { MarketScanPreview } from './previews/market-scan-preview';

const meta = {
  title: 'Design previews/Market Green', component: MarketScanPreview,
  parameters: { layout: 'fullscreen', componentLibraryFrame: false },
} satisfies Meta<typeof MarketScanPreview>;
export default meta;

export const ReviewLabel: StoryObj<typeof meta> = {
  play: async ({ canvas, userEvent }) => {
    const pack = canvas.getByLabelText('Pack size');
    await fireEvent.change(pack, { target: { value: '0 g' } });
    await expect(canvas.getByRole('button', { name: 'Save Price' })).toBeDisabled();
    await fireEvent.change(pack, { target: { value: '500 g' } });
    await expect(canvas.getByLabelText('Computed unit price')).toHaveTextContent('£5.00 / kg');
    const total = canvas.getByLabelText('Total price (£)');
    await fireEvent.change(total, { target: { value: '3.00' } });
    await expect(canvas.getByLabelText('Computed unit price')).toHaveTextContent('£6.00 / kg');
    const save = canvas.getByRole('button', { name: 'Save Price' });
    await userEvent.click(save);
    await expect(canvas.getByText('Saved in this preview.')).toBeVisible();
    await fireEvent.change(pack, { target: { value: '2 kg' } });
    await fireEvent.change(total, { target: { value: '2.50' } });
    save.blur();
    window.scrollTo(0, 0);
  },
};
