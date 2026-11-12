import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, within } from 'storybook/test';
import { CozyComparisonPreview } from './previews/cozy-comparison-preview';

const meta = {
  title: 'Design previews/Cozy comparison',
  component: CozyComparisonPreview,
  parameters: { layout: 'fullscreen' },
  args: { theme: 'sage' },
} satisfies Meta<typeof CozyComparisonPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

const checkInteractions: NonNullable<Story['play']> = async ({ canvas, userEvent }) => {
  const offers = within(canvas.getByRole('list', { name: 'Saved offers' }));
  await expect(offers.getAllByRole('listitem')).toHaveLength(6);
  const edit = canvas.getByRole('button', { name: 'Edit Maris Piper potatoes · 2 kg at Tandem Centre Lidl' });
  await userEvent.click(edit);
  await expect(canvas.getByLabelText('Unit price (optional)')).toHaveValue('0.124');
  await expect(canvas.getByLabelText('Unit (for example kg or litre)')).toHaveValue('100g');
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
  const variety = canvas.getByRole('checkbox', { name: 'Same variety' });
  await userEvent.click(variety);
  await expect(variety).toBeChecked();
  await expect(canvas.queryByText('Tandem Centre Lidl')).not.toBeInTheDocument();
  await userEvent.click(variety);
  variety.blur();
  window.scrollTo(0, 0);
};

export const SageAndLinen: Story = {
  name: 'Sage & Linen', parameters: { componentLibraryFrame: false }, play: checkInteractions,
};
export const BerryAndBakery: Story = { name: 'Berry & Bakery', args: { theme: 'berry' }, play: checkInteractions };
export const TerracottaAndPantry: Story = { name: 'Terracotta & Pantry', args: { theme: 'terracotta' }, play: checkInteractions };

export const MarketComparison: Story = {
  name: 'Market Green · Compare prices', args: { theme: 'market' }, parameters: { componentLibraryFrame: false },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Lowest unit price', { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Scan Label' }));
    await expect(canvas.getByRole('heading', { name: 'Review scan' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Back to comparison' }));
    window.scrollTo(0, 0);
  },
};
