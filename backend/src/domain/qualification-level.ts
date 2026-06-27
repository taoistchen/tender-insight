const levelRank = new Map<string, number>([
  ["不分等级", 0],
  ["三级", 1],
  ["叁级", 1],
  ["二级", 2],
  ["贰级", 2],
  ["一级", 3],
  ["壹级", 3],
  ["特级", 4],
  ["丙级", 1],
  ["乙级", 2],
  ["甲级", 3]
]);

export function normalizeQualificationLevel(level: string): string {
  return level.trim().replace(/及以上|以上|资质/g, "");
}

export function compareQualificationLevel(actual: string, required: string): number {
  const actualLevel = normalizeQualificationLevel(actual);
  const requiredLevel = normalizeQualificationLevel(required);
  const actualRank = levelRank.get(actualLevel);
  const requiredRank = levelRank.get(requiredLevel);

  if (actualRank === undefined || requiredRank === undefined) {
    return actualLevel === requiredLevel ? 0 : Number.NEGATIVE_INFINITY;
  }

  return actualRank - requiredRank;
}

export function levelSatisfies(actual: string, required: string): boolean {
  return compareQualificationLevel(actual, required) >= 0;
}
