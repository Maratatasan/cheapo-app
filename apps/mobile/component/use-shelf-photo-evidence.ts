import type { Product } from '@cheapo/domain';
import type { PhotoPriceSource } from '@/data/photo-price-source';
import { classifyShelfPrice, type PriceEvidenceSnapshot } from '@/data/shelf-price-evidence';
import { useSelectedPhotoText } from './use-selected-photo-text';

export function useShelfPhotoEvidence(source: PhotoPriceSource | undefined, product: Product | undefined) {
  const photoText = useSelectedPhotoText(source?.selected);
  const separateOriginal = source?.original !== source?.selected ? source?.original : undefined;
  const originalText = useSelectedPhotoText(product ? separateOriginal : undefined);
  if (!photoText || (product && separateOriginal && !originalText)) return { photoText };

  const snapshots: PriceEvidenceSnapshot[] = [];
  if (originalText?.result.status === 'found') snapshots.push({ source: 'original', blocks: originalText.result.evidence.blocks });
  if (photoText.result.status === 'found') snapshots.push({ source: separateOriginal ? 'crop' : 'original', blocks: photoText.result.evidence.blocks });
  return { photoText, shelfEvidence: classifyShelfPrice(product, snapshots) };
}
