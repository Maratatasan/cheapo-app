export function importedEvidenceKey(householdId: string, shopperId: string, sha256: string): string {
  return 'shopping-import/' + householdId + '/' + shopperId + '/' + sha256 + '.jpg';
}

export function newEvidenceKey(householdId: string, observationId: string, role: string, sha256: string): string {
  return 'price-evidence/' + householdId + '/' + observationId + '/' + role + '/' + sha256 + '.jpg';
}
