const BIDI_CONTROL_LABELS = new Map<number, string>([
  [0x061c, "ALM"],
  [0x200e, "LRM"],
  [0x200f, "RLM"],
  [0x202a, "LRE"],
  [0x202b, "RLE"],
  [0x202c, "PDF"],
  [0x202d, "LRO"],
  [0x202e, "RLO"],
  [0x2066, "LRI"],
  [0x2067, "RLI"],
  [0x2068, "FSI"],
  [0x2069, "PDI"],
  [0x206a, "ISS"],
  [0x206b, "ASS"],
  [0x206c, "IAFS"],
  [0x206d, "AAFS"],
  [0x206e, "NADS"],
  [0x206f, "NODS"],
]);

export function sanitizeDisplayText(value: string): string {
  let result = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    const label = BIDI_CONTROL_LABELS.get(codePoint);
    result += label ? `[${label}]` : char;
  }
  return result;
}

export function containsBidiControl(value: string): boolean {
  for (const char of value) {
    if (BIDI_CONTROL_LABELS.has(char.codePointAt(0)!)) return true;
  }
  return false;
}
