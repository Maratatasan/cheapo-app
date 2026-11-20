import type { Product } from '@cheapo/domain';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';

import { checkProductIdentity, type AddProductLookup, type ProductIdentityCheck } from '@/data/add-product-lookup';
import type { ProductCandidate } from '@/data/cheapo-shopping-reads';
import type { DraftShop, LocalPhotoDraft } from '@/data/local-photo';
import { applyPhotoSuggestion, emptyReview, reviewComplete, type ManualReview } from '@/data/photo-review';
import { dateLabel, priceLabel, type PriceValues } from '@/data/observation';
import { fieldPhotoAnalysisEnabled } from '@/lib/direct-auth/phone-session';
import type { PhotoShopCountry } from '@/lib/direct-auth/shop-country';
import { CameraActionButton } from './camera-actions';
import { DirectPhotoAnalysis, DirectProductIdentityAnalysis } from './direct-photo-analysis';
import { PhotoReview, type ReviewSuggestion } from './photo-review';
import { useShelfPhotoEvidence } from './use-shelf-photo-evidence';
import { color, radius, spacing, ui } from './results/theme';

type Choice = { kind: 'reuse'; product: Product } | { kind: 'add' };
type Check = ProductIdentityCheck | { kind: 'entry' | 'checking' };
type LastPrice = Pick<PriceValues, 'price' | 'currency'> & { capturedOn: string };

export type ProductPriceSubmission = {
  shop: DraftShop;
  review: ManualReview;
  photo?: LocalPhotoDraft;
  barcode?: string;
  choice?: Choice;
};

export type AddProductPriceReviewProps = {
  shop?: DraftShop;
  shopCountry?: PhotoShopCountry;
  initialReview?: Partial<ManualReview>;
  initialBarcode?: string;
  photo?: LocalPhotoDraft;
  lookup: AddProductLookup;
  loadLatestPrice?: (product: Product, shop: DraftShop, signal: AbortSignal) => Promise<LastPrice | null | undefined>;
  onChooseShop: () => void;
  onCompare: (candidate: ProductCandidate) => void;
  onPickPhoto?: () => void;
  onScanBarcode?: (read: (barcode: string) => void) => void;
  onSubmit: (value: ProductPriceSubmission) => Promise<'queued' | 'draft'>;
  onCancel: () => void;
};

const identityFields = new Set<keyof ManualReview>(['productName', 'productType', 'brand', 'variety', 'packSize']);

export function AddProductPriceReview({ shop, shopCountry, initialReview, initialBarcode, photo, lookup, loadLatestPrice,
  onChooseShop, onCompare, onPickPhoto, onScanBarcode, onSubmit, onCancel }: AddProductPriceReviewProps) {
  const [review, setReview] = useState(() => ({ ...emptyReview(), ...initialReview }));
  const [barcode, setBarcode] = useState(initialBarcode ?? '');
  const [check, setCheck] = useState<Check>({ kind: 'entry' });
  const [choice, setChoice] = useState<Choice>();
  const [observedPackSize, setObservedPackSize] = useState<string>();
  const [priceSnapshot, setPriceSnapshot] = useState<{ productId: string; shopId: string; price: LastPrice | null }>();
  const [saveError, setSaveError] = useState<string>();
  const [savedStatus, setSavedStatus] = useState<string>();
  const [saving, setSaving] = useState(false);
  const search = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const edited = useRef(new Set<keyof ManualReview>());
  const known = choice?.kind === 'reuse' ? choice.product : undefined;
  const { photoText, shelfEvidence } = useShelfPhotoEvidence(choice ? photo : undefined, known);
  const shelfPrice = shelfEvidence?.kind === 'clear' && shop && !review.price.trim() && !observedPackSize &&
    !edited.current.has('price') && !edited.current.has('currency') && !edited.current.has('packSize') ? shelfEvidence.selling : undefined;
  const lastPrice = priceSnapshot?.productId === known?.id && priceSnapshot?.shopId === shop?.id ? priceSnapshot?.price : undefined;
  const packSize = known?.pack?.label ?? (known?.pack && `${known.pack.quantity} ${known.pack.unit}`);
  const shownReview = { ...review, ...(known ? {
    productName: known.name, productType: known.productType, brand: known.brand, variety: known.variety,
    packSize: observedPackSize ?? packSize ?? review.packSize,
  } : {}), ...(shelfPrice ? { price: (shelfPrice.minor / 100).toFixed(2), currency: shelfPrice.currency } : {}),
    shop: shop?.displayName ?? '' };
  const complete = Boolean(shop && reviewComplete(shownReview, shop.displayName));

  useEffect(() => {
    setCheck({ kind: 'entry' });
    setChoice(undefined);
    setObservedPackSize(undefined);
    return () => search.current?.abort();
  }, [lookup]);

  useEffect(() => {
    setPriceSnapshot(undefined);
    if (!known || !shop || !loadLatestPrice) return;
    const controller = new AbortController();
    void loadLatestPrice(known, shop, controller.signal).then(price => {
      if (!controller.signal.aborted && price !== undefined) setPriceSnapshot({ productId: known.id, shopId: shop.id, price });
    }).catch(() => {});
    return () => controller.abort();
  }, [known, shop, loadLatestPrice]);

  function resetIdentity() {
    search.current?.abort();
    setCheck({ kind: 'entry' });
    setChoice(undefined);
    setObservedPackSize(undefined);
    setSaveError(undefined);
  }

  function enterBarcode(value: string) {
    resetIdentity();
    setBarcode(value);
  }

  async function checkIdentity() {
    Keyboard.dismiss();
    search.current?.abort();
    const pending = new AbortController();
    search.current = pending;
    setChoice(undefined);
    setCheck({ kind: 'checking' });
    try {
      const result = await checkProductIdentity(lookup, review, barcode, pending.signal);
      if (!pending.signal.aborted) setCheck(result);
    } catch {
      if (!pending.signal.aborted) setCheck({ kind: 'unavailable' });
    }
  }

  async function submit(selected?: Choice) {
    if (!shop || !complete || submitting.current || savedStatus) return;
    if (selected?.kind === 'add' && check.kind === 'checked' && check.barcode && !review.productType?.trim()) return;
    submitting.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      const status = await onSubmit({ shop, review: shownReview, photo, barcode: check.kind === 'checked' || check.kind === 'unavailable'
        ? check.barcode : undefined, choice: selected });
      setSavedStatus(status === 'queued' ? 'Price saved on this phone · Waiting to sync' : 'Draft saved · Review in Pending sync');
    } catch {
      setSaveError('Could not save this review. Your details are still here. Try again.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const disabled = saving || Boolean(savedStatus);
  const needsProductType = check.kind === 'checked' && check.barcode && choice?.kind === 'add' && !review.productType?.trim();
  const blocked = !shop ? 'Choose the current shop before saving.' : needsProductType ? 'Enter the product type for this barcode.'
    : !choice ? 'Check the product before confirming its price.' : undefined;

  const renderReview = (controls?: ReactNode, suggestion?: ReviewSuggestion) => <PhotoReview addingProduct recordingPrice={Boolean(known)}
    photo={photo?.selected} review={shownReview} suggestion={suggestion}
    selectedShopName={shop?.displayName} saved={Boolean(savedStatus)} savedStatus={savedStatus} busy={saving}
    onReviewChange={(next, field) => {
      edited.current.add(field);
      if (known && field === 'packSize') { setObservedPackSize(next.packSize); return; }
      if (identityFields.has(field) && !known) resetIdentity();
      setReview(current => ({ ...current, [field]: next[field] }));
    }}
    onSave={() => { if (choice) void submit(choice); }} onCancel={onCancel} saveError={saveError} saveBlocked={blocked}>
    {!shop ? <CameraActionButton label="Choose current shop" disabled={disabled} onPress={onChooseShop} /> : null}
    {onPickPhoto ? <CameraActionButton label={photo ? 'Replace photo' : 'Choose photo'} disabled={disabled}
      onPress={onPickPhoto} /> : null}
    {controls}
    {choice ? <View style={ui.card}>
      {!known ? <Text style={ui.body}>Adding a new product</Text> : null}
      {known && [known.brand, known.variety, packSize].some(Boolean) ?
        <Text style={ui.body}>{[known.brand, known.variety, packSize].filter(Boolean).join(' · ')}</Text> : null}
      {lastPrice ? <Text style={ui.body}>Last recorded at {shop?.displayName} · {priceLabel(lastPrice)} · {dateLabel(lastPrice.capturedOn)}</Text> : null}
      {lastPrice === null ? <Text style={ui.body}>No price saved at {shop?.displayName}</Text> : null}
      {known ? <CameraActionButton label="Compare saved prices" disabled={disabled}
        onPress={() => onCompare({ kind: 'catalog', product: known })} /> : null}
      <CameraActionButton label="Change product" disabled={disabled} onPress={resetIdentity} />
    </View> : <View style={ui.card}>
      <Text style={ui.body}>Product barcode (optional)</Text>
      <TextInput accessibilityLabel="Product barcode (optional)" value={barcode} maxLength={14} keyboardType="number-pad"
        editable={!disabled} style={styles.barcode} onChangeText={enterBarcode} />
      {onScanBarcode ? <CameraActionButton label="Scan barcode" disabled={disabled} onPress={() => onScanBarcode(enterBarcode)} /> : null}
      <CameraActionButton label={check.kind === 'checking' ? 'Checking product…' : 'Check product'} busy={check.kind === 'checking'}
        disabled={disabled || (!barcode.trim() && !review.productName.trim())} onPress={() => { void checkIdentity(); }} />
      {check.kind === 'invalid' ? <Text accessibilityRole="alert" style={ui.body}>{check.message}</Text> : null}
      {check.kind === 'unavailable' ? <>
        <Text accessibilityRole="alert" style={ui.body}>Could not check the catalog. Retry or save a draft to review when connected.</Text>
        <CameraActionButton label="Save draft for review" disabled={disabled || !complete} onPress={() => { void submit(); }} />
      </> : null}
      {check.kind === 'checked' ? <>
        {check.candidates.length ? <Text accessibilityRole="header" style={ui.body}>{check.exact ? 'Matching saved product' : 'Possible matches'}</Text> : null}
        {!check.candidates.length && !check.truncated ? <Text style={ui.body}>No matching products found</Text> : null}
        {check.truncated ? <Text style={ui.body}>The search was limited. Refine the packaging details to check more precisely.</Text> : null}
        {check.candidates.map(candidate => candidate.kind === 'catalog' ? <CameraActionButton key={`product:${candidate.product.id}`}
          label={`Use ${candidate.product.name}`} disabled={disabled} onPress={() => setChoice({ kind: 'reuse', product: candidate.product })} /> :
          <CameraActionButton key={`price:${candidate.observationId}`} label={`Compare saved price for ${candidate.details.name}`}
            disabled={disabled} onPress={() => onCompare(candidate)} />)}
        {!check.exact && !check.truncated ? <CameraActionButton label="Add as new product" disabled={disabled}
          onPress={() => setChoice({ kind: 'add' })} /> : null}
      </> : null}
    </View>}
  </PhotoReview>;

  if (!photo || !fieldPhotoAnalysisEnabled) return renderReview();
  if (choice) return <DirectPhotoAnalysis key={photo.selected.uri} photo={photo.selected} photoText={photoText}
    shopCountry={shopCountry} noPriceFound={shelfEvidence?.kind === 'no-price'} busy={disabled}
    onApply={draft => {
      const keepPack = Boolean(packSize || edited.current.has('packSize'));
      const next = applyPhotoSuggestion(review, keepPack ? { ...draft, packSize: null } : draft, edited.current, true);
      if (!known && next.packSize !== review.packSize) resetIdentity();
      setReview(next);
    }}>
    {renderReview}
  </DirectPhotoAnalysis>;
  return renderReview(<DirectProductIdentityAnalysis key={photo.selected.uri} photo={photo.selected} busy={disabled || check.kind === 'checking'}
    onApply={identity => {
      setReview(current => applyPhotoSuggestion(current, { ...identity, price: null, currency: null, unit_price: null }, edited.current));
      resetIdentity();
    }} />);
}

const styles = StyleSheet.create({
  barcode: { borderColor: color.line, borderWidth: 1, borderRadius: radius.control, minHeight: 44,
    color: color.ink, paddingHorizontal: spacing.md },
});
