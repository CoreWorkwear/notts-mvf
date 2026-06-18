// Pure helpers for competition squad registration (§2). The cap is enforced for
// real in the DB (a BEFORE-INSERT guard); these keep the UI honest.

export function squadFull({ count, enabled, limit }) {
  return !!(enabled && limit != null && count >= limit)
}

// Can another player still be registered?
export function canRegister(state) {
  return !squadFull(state)
}

// "14 / 16 registered" when capped, "14 registered" when unlimited.
export function squadCountLabel({ count, enabled, limit }) {
  return enabled && limit != null ? `${count} / ${limit} registered` : `${count} registered`
}
