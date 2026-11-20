import { loadEnrolledShoppingBackup } from '../lib/enrolled-shopping-backup';

const mockOwner = {
  origin: 'https://shopping.example',
  householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa',
  shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878',
};
const mockLastVerifiedOwner = jest.fn();
const mockPriceBackup = jest.fn();
const mockMutationBackup = jest.fn();
let mockProtectedWork = false;

jest.mock('../lib/cheapo-access/device', () => ({
  cheapoAccess: { lastVerifiedOwner: () => mockLastVerifiedOwner() },
}));
jest.mock('../data/price-append-queue', () => ({
  openPriceAppendQueue: () => ({ backup: mockPriceBackup }),
  priceQueueRoot: () => ({ exists: mockProtectedWork }),
}));
jest.mock('../data/shopping-mutation-queue', () => ({
  openShoppingMutationQueue: () => ({ backup: mockMutationBackup }),
  shoppingMutationRoot: () => ({ exists: mockProtectedWork }),
}));

function mockCorrection(base: object, waitFor: string[] = []) {
  mockMutationBackup.mockImplementation(async capture => capture({
    files: [{ name: 'edit-rice.intent.json', bytes: new Uint8Array() }],
    entries: [{ intent: { operationId: 'edit-rice', action: { kind: 'price', base }, waitFor } }],
    recovery: [],
  }));
}

beforeEach(() => {
  mockProtectedWork = false;
  mockLastVerifiedOwner.mockReset().mockResolvedValue(mockOwner);
  mockPriceBackup.mockReset().mockResolvedValue({ entries: [], productPriceDrafts: [], recovery: [], files: [] });
  mockCorrection({ kind: 'append', sourceId: 'local-rice' });
});

test('checks captured append and mutation references before creating the recovery archive', async () => {
  await expect(loadEnrolledShoppingBackup()).rejects.toThrow('work missing');
  mockPriceBackup.mockResolvedValue({ entries: [{ record: { id: 'local-rice' } }], productPriceDrafts: [], recovery: [], files: [] });
  const backup = await loadEnrolledShoppingBackup();
  expect(backup?.records).toEqual([{ id: 'local-rice' }]);
  expect(backup?.files.map(file => file.path)).toEqual(['recovery/mutations/edit-rice.intent.json']);
  mockCorrection({ kind: 'append', sourceId: 'local-rice' }, ['missing-predecessor']);
  await expect(loadEnrolledShoppingBackup()).rejects.toThrow('work missing');
});

test('fails clearly if queued evidence is unreadable, the enrollment changes, or its owner is missing', async () => {
  mockPriceBackup.mockResolvedValue({ entries: [], productPriceDrafts: [], files: [], recovery: [{ sourceId: 'local-rice', reason: 'unreadable' }] });
  await expect(loadEnrolledShoppingBackup()).rejects.toThrow('evidence could not be read');
  mockPriceBackup.mockResolvedValue({ entries: [{ record: { id: 'local-rice' } }], productPriceDrafts: [], recovery: [], files: [] });
  const backup = await loadEnrolledShoppingBackup();
  mockLastVerifiedOwner.mockResolvedValue({ ...mockOwner, shopperId: '64db4ca7-3962-4a16-8fee-782f26fd13b4' });
  await expect(backup?.assertCurrentOwner()).rejects.toThrow('Cheapo access changed');

  mockLastVerifiedOwner.mockResolvedValue(null);
  await expect(loadEnrolledShoppingBackup()).resolves.toBeNull();
  mockProtectedWork = true;
  await expect(loadEnrolledShoppingBackup()).rejects.toThrow('Restore the Cheapo access');
});

test('rejects a different selected owner before opening any protected queues', async () => {
  const other = { ...mockOwner, shopperId: '64db4ca7-2366-4a16-8fee-782f26fd13b4' };
  mockLastVerifiedOwner.mockResolvedValue(other);
  mockPriceBackup.mockClear();
  mockMutationBackup.mockClear();
  await expect(loadEnrolledShoppingBackup(mockOwner)).rejects.toThrow('Cheapo access changed');
  expect(mockPriceBackup).not.toHaveBeenCalled();
  expect(mockMutationBackup).not.toHaveBeenCalled();
});

test('includes uncommitted product-price evidence in recovery without treating it as a queued append', async () => {
  const source = { id: 'local-rice', original: { uri: 'file:///documents/price-photos/local-rice-original.jpg' } };
  mockPriceBackup.mockResolvedValue({ entries: [], productPriceDrafts: [{ record: source }], recovery: [], files: [
    { name: 'local-rice.product-price-draft.json', bytes: new Uint8Array() },
  ] });
  await expect(loadEnrolledShoppingBackup()).rejects.toThrow('work missing');
  mockMutationBackup.mockImplementation(async capture => capture({ entries: [], recovery: [], files: [] }));
  const backup = await loadEnrolledShoppingBackup();
  expect(backup?.records).toEqual([source]);
  expect(backup?.files.map(file => file.path)).toEqual(['recovery/prices/local-rice.product-price-draft.json']);
});
