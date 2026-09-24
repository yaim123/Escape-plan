export function matchesCondition(condition, event) {
  return condition.blockId === event.blockId && (condition.event || 'complete') === event.type && (!condition.member || Number(condition.member) === event.member) && (!condition.role || condition.role === event.role);
}
export function isUnlocked(unlock, events) {
  if (!unlock?.conditions?.length) return true;
  const matches = unlock.conditions.map(c => events.some(e => matchesCondition(c, e)));
  if (unlock.mode === 'OR') return matches.some(Boolean);
  if (unlock.mode === 'N') return matches.filter(Boolean).length >= Math.max(1, Number(unlock.count) || 1);
  return matches.every(Boolean);
}
export function assignedMembers(block, members, blockIndex = 0) {
  const a = block.assignment;
  if (a.mode === 'member') return members.filter(m => m.member === Number(a.member));
  if (a.mode === 'role') return members.filter(m => m.role === a.role);
  if (a.mode === 'auto') return members.length ? [members[blockIndex % members.length]] : [];
  return members;
}
export function isComplete(block, events, members, blockIndex = 0) {
  const validMembers = new Set(members.map(m => m.member));
  const completed = new Set(events.filter(e => e.type === 'complete' && e.blockId === block.id && validMembers.has(e.member)).map(e => e.member));
  const mode = block.completion.mode;
  if (mode === 'n') return completed.size >= Math.max(1, Number(block.completion.count));
  if (mode === 'member') return completed.has(Number(block.completion.member));
  const required = mode === 'role' ? members.filter(m => m.role === block.completion.role) : mode === 'assigned' ? assignedMembers(block, members, blockIndex) : members;
  if (mode === 'any') return members.some(m => completed.has(m.member));
  return required.length > 0 && required.every(m => completed.has(m.member));
}
