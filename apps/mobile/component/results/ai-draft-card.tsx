import { observationFromDraft, type AiPriceDraft } from '@/data/ai-observation';
import { ObservationCard } from './observation-card';
export function AiDraftCard({draft}:{draft:AiPriceDraft}) {
  return <ObservationCard item={observationFromDraft(draft)} />;
}
