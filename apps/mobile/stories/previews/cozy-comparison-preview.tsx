import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PhotoReview } from '../../component/photo-review';
import { comparePrices, normalizedUnitPrice, type ComparisonFilters, type ComparisonPrice } from '../../data/comparison-prices';
import { dateLabel, priceLabel } from '../../data/observation';
import { emptyReview, type ManualReview } from '../../data/photo-review';
import { MarketScanPreview, previewPhoto as photo } from './market-scan-preview';

export type CozyTheme = 'sage' | 'berry' | 'terracotta' | 'market';
type Offer = ComparisonPrice & { shop: string; name: string; capturedOn: string; pack?: string };

const base = { productType: 'Fresh potatoes', variety: 'Rooster', brand: 'Albert Bartlett', currency: 'GBP', capturedOn: '2026-11-12' };
const selected: Offer = {
  ...base, id: 'selected', name: 'Albert Bartlett Rooster Potatoes', shop: 'Reference shop',
  price: 2.5, unit_price: { amount: 1.25, unit: 'kg' },
};
const sampleOffers: Offer[] = [
  { ...base, id: 'tandem', name: 'Maris Piper potatoes · 2 kg', variety: 'Maris Piper', shop: 'Tandem Centre Lidl', price: 2.48, unit_price: { amount: 0.124, unit: '100g' } },
  { ...base, id: 'aldi', name: 'Rooster potatoes · 2 kg', brand: 'Orchard Farm', shop: 'Colliers Wood Aldi', price: 2.54, unit_price: { amount: 1.27, unit: 'kg' } },
  { ...base, id: 'sutton-lidl', name: 'Maris Piper potatoes · 2 kg', variety: 'Maris Piper', brand: 'Orchard Farm', shop: 'Sutton Lidl', price: 2.62, unit_price: { amount: 1.31, unit: 'kg' } },
  { ...base, id: 'colliers-sainsburys', name: 'Albert Bartlett Rooster · 2 kg', shop: 'Colliers Wood Sainsbury’s', price: 2.7, unit_price: { amount: 1.35, unit: 'kg' } },
  { ...base, id: 'morden-sainsburys', name: 'Albert Bartlett Rooster · 1 kg', shop: 'Morden Sainsbury’s', price: 1.42, unit_price: { amount: 1.42, unit: 'kg' } },
  { ...base, id: 'sutton-sainsburys', name: 'Albert Bartlett Rooster · 2 kg', shop: 'Sutton Sainsbury’s', price: 2.94, unit_price: { amount: 1.47, unit: 'kg' } },
];
const filtersList = [
  { key: 'sameVariety', label: 'Same variety' },
  { key: 'sameBrand', label: 'Same brand' },
] as const;

function Prices({ offer, unitPrice }: { offer: Offer; unitPrice?: ComparisonPrice['unit_price'] }) {
  return (
    <div className="cozy-prices">
      {unitPrice ? (
        <div className="cozy-unit-price">{priceLabel({ price: unitPrice.amount, currency: offer.currency })} <span>/ {unitPrice.unit}</span></div>
      ) : <div className="cozy-pack">Unit price unavailable</div>}
      <div className="cozy-pack">{priceLabel(offer)} pack price</div>
    </div>
  );
}

function EditButton({ offer, onEdit }: { offer: Offer; onEdit: () => void }) {
  return <button type="button" className="cozy-edit" onClick={onEdit} aria-label={`Edit ${offer.name} at ${offer.shop}`}>Edit</button>;
}

export function CozyComparisonPreview({ theme }: { theme: CozyTheme }) {
  const [reference, setReference] = useState(selected);
  const [offers, setOffers] = useState(sampleOffers);
  const [filters, setFilters] = useState<ComparisonFilters>({ sameVariety: false, sameBrand: false });
  const [editing, setEditing] = useState<{ offer: Offer; review: ManualReview }>();
  const [scanning, setScanning] = useState(false);
  const ranked = comparePrices(offers, reference, filters);
  const referenceUnit = normalizedUnitPrice(reference.unit_price);
  const market = theme === 'market';
  const priceFirst = theme === 'sage' || market;
  const cheapestId = market ? ranked.groups[0]?.entries[0]?.row.id : undefined;

  function startEdit(offer: Offer) {
    setEditing({ offer, review: {
      ...emptyReview(offer.shop), productName: offer.name, price: String(offer.price ?? ''), currency: offer.currency ?? '',
      unitPrice: String(offer.unit_price?.amount ?? ''), unit: offer.unit_price?.unit ?? '',
      productType: offer.productType, variety: offer.variety, brand: offer.brand,
    } });
  }

  function save() {
    if (!editing) return;
    const { offer, review } = editing;
    const updated: Offer = {
      ...offer, name: review.productName, price: Number(review.price), currency: review.currency,
      unit_price: review.unitPrice.trim() ? { amount: Number(review.unitPrice), unit: review.unit } : null,
      productType: review.productType, variety: review.variety, brand: review.brand,
    };
    if (offer.id === reference.id) setReference(updated);
    else setOffers(current => current.map(row => row.id === offer.id ? updated : row));
    setEditing(undefined);
  }

  if (scanning) {
    return <MarketScanPreview onBack={() => setScanning(false)} onSave={(draft, unitPrice) => setReference(current => ({
      ...current, name: draft.name.trim(), pack: draft.pack.trim(), price: Number(draft.price), unit_price: unitPrice,
      brand: draft.brand.trim(), variety: draft.variety.trim(), productType: draft.productType.trim(),
    }))} />;
  }

  if (editing) {
    return (
      <div className="cozy-editor">
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 680 }, insets: { top: 0, left: 0, bottom: 0, right: 0 } }}>
          <PhotoReview
            photo={photo && editing.offer.id === reference.id ? { uri: photo, width: 600, height: 600, mimeType: 'image/jpeg' } : undefined}
            review={editing.review} selectedShopName={editing.offer.shop} saved={false} busy={false}
            onReviewChange={review => setEditing({ ...editing, review })} onCancel={() => setEditing(undefined)} onSave={save}
          />
        </SafeAreaProvider>
      </div>
    );
  }

  return (
    <>
    <main className="cozy-compare" data-theme={theme}>
      <header className="cozy-header">
        <span>Cheapo</span>
        {priceFirst ? <h1>Compare prices</h1> : <span>Sample saved prices</span>}
      </header>
      <article className="cozy-reference">
        {photo ? <img className="cozy-photo" src={photo} alt="Rooster potatoes and shelf label" />
          : <div className="cozy-photo cozy-photo-empty">Photo unavailable</div>}
        <div className="cozy-reference-details">
          {priceFirst ? <h2>{reference.name}</h2> : <h1>{reference.name}</h1>}
          <p>{reference.shop} · {reference.pack ?? '2 kg bag'}</p>
          <div className="cozy-reference-prices">
            <Prices offer={reference} unitPrice={referenceUnit ?? reference.unit_price} />
            <EditButton offer={reference} onEdit={() => startEdit(reference)} />
          </div>
        </div>
      </article>
      <section className="cozy-results" aria-label="Shop price comparison">
        <h2>{priceFirst ? 'Saved offers' : 'Compare shop prices'}</h2>
        <div className="cozy-filters">
          {filtersList.map(({ key, label }) => (
            <label className="cozy-filter" key={key}>
              <input type="checkbox" checked={filters[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.checked }))} />
              <span className="cozy-check" aria-hidden="true" />{label}
            </label>
          ))}
        </div>
        {ranked.groups.length ? <p className="cozy-sort">Lowest unit price first</p> : null}
        {ranked.missing.length ? <p className="cozy-sort" role="status">Add {ranked.missing.join(' and ')} to the selected product to use this comparison.</p> : null}
        {!ranked.missing.length && !ranked.groups.length && !ranked.unranked.length ? <p className="cozy-sort" role="status">No matching saved prices</p> : null}
        <ul className="cozy-offers" aria-label="Saved offers">
          {[...ranked.groups.flatMap(group => group.entries), ...ranked.unranked.map(row => ({ row, unitPrice: null }))].map(({ row, unitPrice }) => {
            const cheapest = row.id === cheapestId;
            const prices = <div><Prices offer={row} unitPrice={unitPrice} />{cheapest ? <span className="market-cheapest">Lowest unit price</span> : null}</div>;
            const edit = <EditButton offer={row} onEdit={() => startEdit(row)} />;
            const date = <p className="cozy-date">Recorded {dateLabel(row.capturedOn)}</p>;
            const details = (
              <div className="cozy-offer-details">
                <h3>{row.shop}</h3>
                {priceFirst ? date : null}
                <p className="cozy-item">{row.name}</p>
                {priceFirst ? null : date}
              </div>
            );
            return (
              <li className="cozy-offer" key={row.id} data-cheapest={cheapest || undefined}>
                {priceFirst ? <>{prices}{details}{edit}</> : <>{details}<div className="cozy-offer-values">{prices}{edit}</div></>}
              </li>
            );
          })}
        </ul>
      </section>
      {market ? <button type="button" className="market-scan-cta" onClick={() => setScanning(true)}><span aria-hidden="true" /> Scan Label</button> : null}
    </main>
    {priceFirst ? <footer className="cozy-style-note">Style preview · sample prices</footer> : null}
    </>
  );
}
