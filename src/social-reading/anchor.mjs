export const normalizeText = (value) => value.replace(/\s+/g, " ").trim();

export function validSelector(text, selector) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector))
    return false;
  const { start, end, quote } = selector;
  if (
    Object.keys(selector).length !== 3 ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    typeof quote !== "string"
  )
    return false;
  const split = (i) =>
    i > 0 &&
    i < text.length &&
    /[\uD800-\uDBFF]/.test(text[i - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[i]);
  return !split(start) && !split(end) && text.slice(start, end) === quote;
}

export function matchesAnchor(candidate, expected) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return false;
  const { selector, ...block } = candidate;
  const keys = Object.keys(expected);
  return (
    Object.keys(block).length === keys.length &&
    keys.every((k) => block[k] === expected[k]) &&
    (!Object.hasOwn(candidate, "selector") ||
      validSelector(expected.quote, selector))
  );
}
