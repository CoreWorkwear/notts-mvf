// PostgREST returns a to-one embed as an OBJECT, but a to-many as an ARRAY.
// A one-to-one (e.g. fixtures→results, where results.fixture_id is the PK) comes
// back as an object; some relationships still arrive as a single-element array.
// firstRow normalises both to "the row or null" so callers never have to guess.
export function firstRow(embed) {
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed ?? null
}
