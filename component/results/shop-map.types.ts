import { Observation } from "@/data/observation";
export type ShopMapProps = {
  observations: Observation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};
