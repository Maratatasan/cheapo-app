import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect } from 'storybook/test';
import { AiDraftCard } from '../component/results/ai-draft-card';
const meta = {title:'Cards/AI draft card',component:AiDraftCard,tags:['autodocs'],args:{draft:{product:'Rooster potatoes',brand:'Albert Bartlett',packSize:'2 kg',price:2.5,currency:'GBP',unit_price:{amount:1.25,unit:'kg'},uncertainty:'Offline example: review the photo and confirm the shop.'}}} satisfies Meta<typeof AiDraftCard>;
export default meta;
type Story = StoryObj<Meta<typeof AiDraftCard>>;
export const ReviewDraft:Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Albert Bartlett · 2 kg')).toBeVisible();
  },
};
export const UnknownValues:Story = {args:{draft:{product:null,packSize:null,price:null,currency:null,unit_price:null,uncertainty:'The label is unclear.'}}};
