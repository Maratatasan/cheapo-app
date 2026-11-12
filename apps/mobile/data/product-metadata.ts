import type { Product } from '@cheapo/domain';

export type ProductMetadata = Pick<Product, 'productType' | 'variety' | 'brand'>;

export const productMetadataMaxLength = 100;
