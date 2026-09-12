export type SearchResultType = 'order' | 'variant' | 'batch';
export type SearchMatchKind = 'exact' | 'prefix' | 'text';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  label: string;
  secondary: string | null;
  meta: string | null;
  match: SearchMatchKind;
}

export interface SearchCandidate extends SearchResult {
  identifiers: string[];
  text: string[];
}

const TYPE_HINTS: Record<string, SearchResultType> = {
  order: 'order',
  product: 'variant',
  sku: 'variant',
  batch: 'batch',
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOrderIntent(query: string): string {
  return normalize(query)
    .replace(/^#\s*/, '')
    .replace(/^order\s+/, '')
    .trim();
}

function queryParts(query: string): {
  term: string;
  hintedType: SearchResultType | null;
} {
  const normalized = normalize(query);
  const [first, ...rest] = normalized.split(/\s+/);
  const hintedType = TYPE_HINTS[first] ?? null;

  if (hintedType && rest.length > 0) {
    return {
      term: hintedType === 'order'
        ? normalizeOrderIntent(rest.join(' '))
        : rest.join(' ').trim(),
      hintedType,
    };
  }

  return {
    term: normalizeOrderIntent(normalized),
    hintedType,
  };
}

function classifyMatch(candidate: SearchCandidate, term: string): SearchMatchKind | null {
  const identifiers = candidate.identifiers.map(normalize).filter(Boolean);
  const text = candidate.text.map(normalize).filter(Boolean);

  if (identifiers.some((identifier) => identifier === term)) return 'exact';
  if (identifiers.some((identifier) => identifier.startsWith(term))) return 'prefix';
  if ([...identifiers, ...text].some((value) => value.includes(term))) return 'text';

  return null;
}

function matchWeight(match: SearchMatchKind): number {
  if (match === 'exact') return 0;
  if (match === 'prefix') return 1;
  return 2;
}

export function rankSearchResults(
  query: string,
  candidates: SearchCandidate[],
  limit = 6
): SearchResult[] {
  const { term, hintedType } = queryParts(query);
  if (term.length < 2) return [];

  return candidates
    .map((candidate) => {
      const match = classifyMatch(candidate, term);
      if (!match) return null;

      return {
        result: {
          type: candidate.type,
          id: candidate.id,
          label: candidate.label,
          secondary: candidate.secondary,
          meta: candidate.meta,
          match,
        },
        weight: matchWeight(match),
        typeBoost: hintedType === candidate.type ? 0 : 1,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      if (left.weight !== right.weight) return left.weight - right.weight;
      if (left.typeBoost !== right.typeBoost) return left.typeBoost - right.typeBoost;
      if (left.result.type !== right.result.type) return left.result.type.localeCompare(right.result.type);
      if (left.result.label !== right.result.label) return left.result.label.localeCompare(right.result.label);
      return left.result.id.localeCompare(right.result.id);
    })
    .slice(0, limit)
    .map(({ result }) => result);
}
