import type { PhotoUploadDetails, VerifyPhotoObject } from './price-photo-upload.ts';
import { readShoppingMember, type ShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';

type Failure = { status: 'unauthenticated' | 'forbidden' | 'not_found' | 'operation_conflict' };
type VersionConflict = { status: 'version_conflict'; currentVersion: number };
type Available = { status: 'available'; version: number };
type Pending = { status: 'pending'; key: string };
type UploadPlan = PhotoUploadDetails & { operationId: string; expectedVersion: number };
type PhotoVersion = PhotoUploadDetails & { assetId: string; version: number };
type Intent = Omit<PhotoVersion, 'version'> & { productId: string; version: number | null; expectedVersion: number };

export type ProductPresentationPhotos = {
  read(digest: string, productId: string): Promise<Failure | { status: 'available'; photo: PhotoUploadDetails & { key: string; version: number } }>;
  prepare(digest: string, productId: string, plan: UploadPlan): Promise<Failure | VersionConflict | Available | Pending>;
  confirm(digest: string, productId: string, operationId: string): Promise<Failure | VersionConflict | Available | { status: 'pending' | 'mismatch' }>;
};

const assetColumns = 'asset_id::text AS "assetId", published_version AS version, sha256, byte_count AS "byteCount", width, height';
const actorScope = 'actor_household_id = $1::uuid AND actor_shopper_id = $2::uuid AND operation_id = $3';

function objectKey(assetId: string) {
  return `product-presentation/${assetId}.jpg`;
}

function actorValues(member: ShoppingMember, operationId: string) {
  return [member.household_id, member.shopper_id, operationId];
}

async function currentPhoto(query: ShoppingQuery, productId: string) {
  const { rows: [photo] } = await query<PhotoVersion>(`
    SELECT ${assetColumns} FROM cheapo.product_presentation_photo
    WHERE product_id = $1 AND published_version IS NOT NULL
    ORDER BY published_version DESC LIMIT 1
  `, [productId]);
  return photo;
}

async function readIntent(query: ShoppingQuery, actor: string[]) {
  const { rows: [intent] } = await query<Intent>(`
    SELECT ${assetColumns}, product_id AS "productId", expected_version AS "expectedVersion"
    FROM cheapo.product_presentation_photo WHERE ${actorScope}
  `, actor);
  return intent;
}

function matchesPlan(intent: Intent, productId: string, plan: UploadPlan) {
  return intent.productId === productId && intent.expectedVersion === plan.expectedVersion
    && intent.sha256 === plan.sha256 && intent.byteCount === plan.byteCount
    && intent.width === plan.width && intent.height === plan.height;
}

export function postgresProductPresentationPhotos(
  transaction: ShoppingTransaction, verify: VerifyPhotoObject,
): ProductPresentationPhotos {
  return {
    read: (digest, productId) => transaction(async query => {
      const member = await readShoppingMember(query, digest);
      if (!member) return { status: 'unauthenticated' };
      if (!member.active) return { status: 'forbidden' };
      const photo = await currentPhoto(query, productId);
      if (!photo) return { status: 'not_found' };
      const { assetId, ...metadata } = photo;
      return { status: 'available', photo: { ...metadata, key: objectKey(assetId) } };
    }),
    prepare: (digest, productId, plan) => transaction(async query => {
      const member = await readShoppingMember(query, digest);
      if (!member) return { status: 'unauthenticated' };
      if (!member.active) return { status: 'forbidden' };
      const actor = actorValues(member, plan.operationId);
      let intent = await readIntent(query, actor);
      if (intent && !matchesPlan(intent, productId, plan)) return { status: 'operation_conflict' };
      if (intent?.version != null) return { status: 'available', version: intent.version };
      const currentVersion = (await currentPhoto(query, productId))?.version ?? 0;
      if (currentVersion !== plan.expectedVersion) {
        const replay = await readIntent(query, actor);
        if (replay && !matchesPlan(replay, productId, plan)) return { status: 'operation_conflict' };
        return replay?.version != null ? { status: 'available', version: replay.version } : { status: 'version_conflict', currentVersion };
      }
      if (!intent) {
        await query(`
          INSERT INTO cheapo.product_presentation_photo
            (actor_household_id, actor_shopper_id, operation_id, product_id, expected_version, sha256, byte_count, width, height)
          SELECT $1::uuid, $2::uuid, $3, id, $5::int, $6, $7::int, $8::int, $9::int
          FROM cheapo.product WHERE id = $4
          ON CONFLICT (actor_household_id, actor_shopper_id, operation_id) DO NOTHING
        `, [...actor, productId, plan.expectedVersion, plan.sha256, plan.byteCount, plan.width, plan.height]);
        intent = await readIntent(query, actor);
      }
      if (!intent) return { status: 'not_found' };
      if (!matchesPlan(intent, productId, plan)) return { status: 'operation_conflict' };
      if (intent.version !== null) return { status: 'available', version: intent.version };
      return { status: 'pending', key: objectKey(intent.assetId) };
    }),
    confirm: (digest, productId, operationId) => {
      const deadline = AbortSignal.timeout(23_000);
      return transaction(async query => {
        const member = await readShoppingMember(query, digest);
        if (!member) return { status: 'unauthenticated' };
        if (!member.active) return { status: 'forbidden' };
        const actor = actorValues(member, operationId);
        const intent = await readIntent(query, actor);
        if (!intent || intent.productId !== productId) return { status: 'not_found' };
        if (intent.version !== null) return { status: 'available', version: intent.version };
        const versionBeforeCheck = (await currentPhoto(query, productId))?.version ?? 0;
        if (versionBeforeCheck !== intent.expectedVersion) {
          const replay = await readIntent(query, actor);
          return replay?.version != null ? { status: 'available', version: replay.version }
            : { status: 'version_conflict', currentVersion: versionBeforeCheck };
        }
        const { sha256, byteCount, width, height } = intent;
        const object = await verify(objectKey(intent.assetId), { sha256, byteCount, width, height },
          AbortSignal.any([deadline, AbortSignal.timeout(3_000)]));
        if (object !== 'verified') return { status: object === 'missing' ? 'pending' : 'mismatch' };

        // Keep the global publication lock out of the object check. Objects
        // are immutable, so both the intent and its verified bytes remain valid.
        await query('SELECT 1 FROM pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
          [`cheapo:product-presentation:${productId}`]);
        const replay = await readIntent(query, actor);
        if (replay?.version != null) return { status: 'available', version: replay.version };
        const currentVersion = (await currentPhoto(query, productId))?.version ?? 0;
        if (currentVersion !== intent.expectedVersion) return { status: 'version_conflict', currentVersion };
        const { rows: [published] } = await query<{ version: number }>(`UPDATE cheapo.product_presentation_photo
          SET published_version = $4::int, published_at = statement_timestamp()
          WHERE ${actorScope} AND published_version IS NULL RETURNING published_version AS version`,
        [...actor, currentVersion + 1]);
        if (!published) throw Error('The prepared product photo could not be published.');
        return { status: 'available', version: published.version };
      });
    },
  };
}
