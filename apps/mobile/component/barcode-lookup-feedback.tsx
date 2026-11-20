import { DisplayState } from './results/display-state';

export function BarcodeLookupFeedback({ state, enrolled, detail, onAdd }: {
  state: 'loading' | 'missing' | 'error';
  enrolled: boolean;
  detail?: string;
  onAdd?: () => void;
}) {
  if (state === 'loading') return <DisplayState kind="loading" title="Looking up barcode"
    description={enrolled ? 'Checking the shared catalog.' : 'Checking products saved on this phone.'} />;
  if (state === 'missing') return <DisplayState kind="empty" title="Product not found"
    description={enrolled ? 'This barcode is not in the shared catalog.' : 'This barcode is not in your saved products.'}
    actionLabel="Add product" onAction={onAdd} />;
  return <DisplayState kind="error" title="Couldn’t look up barcode" description={detail ?? 'Try scanning again.'} />;
}
