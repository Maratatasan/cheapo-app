import { Directory, File } from 'expo-file-system';

import { plannedPriceEvidenceRoles, type PricePhotoIntent } from './cheapo-price-photo-transfer';
import type { LocalPhotoDraft } from './local-photo';
import type { PriceAppendReceipt } from './price-append-queue';

const sourcePattern = /^[A-Za-z0-9_-]{1,128}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const maxBytes = 32 * 1024 * 1024;
const maxDimension = 16_384;

type EvidenceSource = { record: LocalPhotoDraft; receipt: PriceAppendReceipt };

function positiveInteger(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= limit;
}

function validatePlan({ record, receipt }: EvidenceSource, value: unknown): PricePhotoIntent[] {
  const roles = plannedPriceEvidenceRoles(record, receipt);
  if (!Array.isArray(value) || value.length !== roles.length) throw Error('Unreadable price evidence plan.');
  return roles.map((role, index) => {
    const item = value[index] as Partial<PricePhotoIntent> | null;
    const asset = role === 'original' ? record.original : record.selected;
    if (!item || typeof item !== 'object' || item.role !== role || item.sourceId !== record.id
      || item.observationId !== receipt.id || item.uri !== asset.uri || item.width !== asset.width || item.height !== asset.height
      || !positiveInteger(item.width, maxDimension) || !positiveInteger(item.height, maxDimension)
      || typeof item.sha256 !== 'string' || !digestPattern.test(item.sha256) || !positiveInteger(item.byteCount, maxBytes)) {
      throw Error('Unreadable price evidence plan.');
    }
    return {
      sourceId: record.id, observationId: receipt.id, role, uri: asset.uri,
      width: item.width, height: item.height, sha256: item.sha256, byteCount: item.byteCount,
    };
  });
}

export function createPriceEvidenceStore(directory: Directory, commit: (file: File, body: string) => Promise<void>) {
  function planFile({ record, receipt }: EvidenceSource) {
    if (!sourcePattern.test(record.id) || receipt.sourceId !== record.id) throw Error('The price evidence identity changed.');
    return new File(directory, `${record.id}.evidence.json`);
  }

  function availableFile(intent: PricePhotoIntent) {
    return new File(directory, `${intent.sourceId}.${intent.role}.evidence-available.json`);
  }

  function availableBody({ observationId, role, sha256, byteCount }: PricePhotoIntent) {
    return JSON.stringify({ observationId, role, sha256, byteCount });
  }

  async function load(source: EvidenceSource) {
    const file = planFile(source);
    if (!file.exists) return null;
    const intents = validatePlan(source, JSON.parse(await file.text()));
    const pending: PricePhotoIntent[] = [];
    for (const intent of intents) {
      const available = availableFile(intent);
      if (!available.exists) pending.push(intent);
      else if (await available.text() !== availableBody(intent)) throw Error('Unreadable price evidence acknowledgement.');
    }
    return pending;
  }

  return {
    load,
    async save(source: EvidenceSource, intents: readonly PricePhotoIntent[]) {
      await commit(planFile(source), JSON.stringify(validatePlan(source, intents)));
    },
    async acknowledge(source: EvidenceSource, intent: PricePhotoIntent) {
      const file = planFile(source);
      const planned = validatePlan(source, JSON.parse(await file.text())).find(item => item.role === intent.role);
      if (!planned || availableBody(planned) !== availableBody(intent)) throw Error('The verified photo does not match the saved plan.');
      await commit(availableFile(planned), availableBody(planned));
    },
  };
}
