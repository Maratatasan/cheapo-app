import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { AiDraftCard } from '../component/results/ai-draft-card';
const meta = {title:'Cards/AI draft card',component:AiDraftCard,tags:['autodocs'],args:{draft:{product:'Albert Bartlett Rooster Potatoes 2kg',price:2.5,currency:'GBP',unit_price:{amount:1.25,unit:'kg'},uncertainty:'Offline example: review the photo and confirm the shop.'}}} satisfies Meta<typeof AiDraftCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ReviewDraft:Story = {};
export const UnknownValues:Story = {args:{draft:{product:null,price:null,currency:null,unit_price:null,uncertainty:'The label is unclear.'}}};
