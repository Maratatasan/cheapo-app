import type { Observation } from "../data/observation";
import { sampleObservations } from "../data/sample-observations";
/** Fictional fixtures only. Imported by stories, never by reusable components. */
export const milk = sampleObservations[1];
export const loyaltyMilk = sampleObservations[2];
export const unclear = sampleObservations[3];
export const potatoes: Observation = {
  ...milk,
  id: "potatoes",
  product: "White potatoes",
  brand: "Example own label",
  pack: "2 kg bag",
  price: 2.5,
  unit_price: { amount: 1.25, unit: "kg" },
};
export const longName: Observation = {
  ...potatoes,
  shop: "Example neighbourhood supermarket and food hall",
  area: "Wimbledon · example branch beside the town centre, exact location unverified",
  product:
    "Organic British baby potatoes with a very long descriptive product name",
  brand: "Example growers collective",
  pack: "Family sharing bag · quantity not confirmed",
  unit_price: null,
  condition:
    "Example loyalty offer: membership required; applies only to selected pack sizes while the promotion runs.",
  note: "Pack quantity and offer eligibility need checking.",
};
export const observations = sampleObservations;
