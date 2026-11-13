import { File, Paths } from 'expo-file-system';

import { loadSavedPriceRecord, saveLocalPhoto, saveManualPrice, type PhotoAsset } from './local-photo';
import { loadSavedShops, saveShop } from './local-shops';
import { emptyReview } from './photo-review';

// A two-pixel JPEG for the synthetic shopping records.
const fixtureJpeg = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9yKKKK6AP/9k=';
const fixtures = [
  { id: 'reference', shop: 'A', price: '2.40', unitPrice: '1.20', unit: 'kg', variety: 'Red', brand: 'Fixture Brand A' },
  { id: 'variety', shop: 'B', price: '2.00', unitPrice: '0.90', unit: 'kg', variety: 'Red', brand: 'Fixture Brand B' },
  { id: 'brand', shop: 'C', price: '2.00', unitPrice: '0.10', unit: '100g', variety: 'White', brand: 'Fixture Brand A' },
  { id: 'unknown', shop: 'D', price: '0.50', unitPrice: '0.20', unit: 'bag', variety: '', brand: '' },
  { id: 'draft', shop: 'A', price: '', unitPrice: '', unit: '', variety: '', brand: '' },
];

export async function seedIosShoppingFixtures() {
  const original = new File(Paths.cache, 'ios-shopping-fixture.jpg');
  await original.write(fixtureJpeg, { encoding: 'base64' });
  const photo: PhotoAsset = { uri: original.uri, width: 2, height: 2, mimeType: 'image/jpeg' };
  const existing = await loadSavedShops();
  for (const suffix of ['A', 'B', 'C', 'D']) {
    const id = `ios-fixture-shop-${suffix}`;
    if (!existing.shops.some(shop => shop.id === id)) {
      await saveShop({ id, nickname: `Test shop ${suffix}` });
    }
  }
  for (const { id: fixtureId, shop, price, unitPrice, unit, variety, brand } of fixtures) {
    const id = `ios-fixture-${fixtureId}`;
    if (await loadSavedPriceRecord(id)) continue;
    const displayName = `Test shop ${shop}`;
    const record = {
      id,
      capturedAt: '2026-11-13T12:00:00.000Z',
      shop: { id: `ios-fixture-shop-${shop}`, displayName },
      review: {
        ...emptyReview(displayName),
        productName: fixtureId === 'draft' ? 'Fixture unfinished record' : 'Fixture Potatoes',
        productType: 'Potatoes',
        price, unitPrice, unit, variety, brand,
      },
    };
    if (fixtureId === 'brand') {
      await saveManualPrice({ ...record, productId: 'ios-fixture-potatoes' });
    } else {
      await saveLocalPhoto({ ...record, original: photo, selected: photo });
    }
  }
}
