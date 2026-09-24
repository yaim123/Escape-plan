export function normalize(value, options = {}) {
  let s = String(value).normalize('NFKC');
  if (options.trim) s = s.trim();
  if (options.spaces) s = s.replace(/\s/g, '');
  if (options.case) s = s.toLocaleLowerCase();
  if (options.punctuation) s = s.replace(/[\p{P}\p{S}]/gu, '');
  return s;
}
export function checkAnswer(block, input) {
  const { questionType: type, answers = [] } = block;
  if (['approval', 'condition'].includes(type)) return false;
  if (type === 'switch') return input === true;
  if (type === 'number') return String(input).trim() !== '' && Number.isFinite(Number(input)) && answers.some(a => a.trim() !== '' && Number(a) === Number(input));
  if (['multi', 'order', 'match'].includes(type)) {
    if (!Array.isArray(input) || input.length !== answers.length || !answers.length) return false;
    return type === 'multi' ? new Set(input).size === input.length && input.every(a => answers.includes(a)) : answers.every((a, i) => a === input[i]);
  }
  return answers.length > 0 && answers.some(a => normalize(a, block.normalization) === normalize(input, block.normalization));
}
