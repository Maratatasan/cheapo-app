/// <reference types="vite/client" />

import { useState } from 'react';
import { priceLabel } from '../../data/observation';
import { scanUnitPrice } from './market-scan-calculation';
import './cozy-comparison-preview.css';

export const previewPhoto = import.meta.env.DEV ? import.meta.env.VITE_COMPARISON_SAMPLE_PHOTO : undefined;
const fields = [
  ['name', 'Product name', 'Albert Bartlett Rooster Potatoes'],
  ['brand', 'Brand', 'Albert Bartlett'], ['variety', 'Variety', 'Rooster'],
  ['productType', 'Product type', 'Fresh potatoes'], ['pack', 'Pack size', '2 kg'], ['price', 'Total price (£)', '2.50'],
] as const;
export type ScanDraft = Record<(typeof fields)[number][0], string>;
const sample = Object.fromEntries(fields.map(([key, , value]) => [key, value])) as ScanDraft;
type ScanProps = { onSave?: (draft: ScanDraft, unit: NonNullable<ReturnType<typeof scanUnitPrice>>) => void; onBack?: () => void };

export function MarketScanPreview({ onSave, onBack }: ScanProps) {
  const [draft, setDraft] = useState(sample);
  const [saved, setSaved] = useState(false);
  const unit = scanUnitPrice(draft.price, draft.pack);
  const valid = !!unit && !!draft.name.trim() && !!draft.productType.trim();
  return (
    <main className="cozy-compare market-review" data-theme="market">
      <header className="cozy-header"><span>Cheapo</span><h1>Review scan</h1></header>
      <p className="market-sample">Sample AI draft · check the details against the label</p>
      {previewPhoto ? <img className="market-label-photo" src={previewPhoto} alt="Cropped shelf label for the sample potatoes" />
        : <div className="market-label-photo cozy-photo-empty">Sample label photo unavailable</div>}
      <form className="market-fields" onSubmit={event => {
        event.preventDefault();
        if (!unit || !valid) return;
        onSave?.(draft, unit);
        setSaved(true);
      }}>
        {fields.map(([key, label]) => (
          <label key={key} className={key === 'name' || key === 'productType' ? 'market-wide' : undefined}>
            {label}
            <input value={draft[key]} inputMode={key === 'price' ? 'decimal' : undefined}
              maxLength={key === 'name' ? 200 : 100} onChange={event => {
                setDraft(current => ({ ...current, [key]: event.target.value })); setSaved(false);
              }} />
          </label>
        ))}
        <div className="market-unit market-wide">
          <span>Unit price</span>
          <output aria-label="Computed unit price">{unit ? `${priceLabel({ price: unit.amount, currency: 'GBP' })} / ${unit.unit}` : 'Unavailable'}</output>
          <small>{unit ? 'Calculated from total price and pack size' : 'Enter a positive price and a pack size such as 500 g or 1 litre.'}</small>
        </div>
        <button type="submit" className="market-save market-wide" disabled={!valid || saved}>{saved ? 'Price saved' : 'Save Price'}</button>
        {saved ? <p role="status" className="market-wide">Saved in this preview.</p> : null}
        {onBack ? <button type="button" className="cozy-edit market-wide" onClick={onBack}>{saved ? 'View comparison' : 'Back to comparison'}</button> : null}
      </form>
    </main>
  );
}
