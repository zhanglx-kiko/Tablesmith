export interface DecodedText {
  text: string;
  encoding: string;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

/** UTF-16 without BOM: ASCII-heavy text has a zero byte in every other position. */
function sniffUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = Math.min(bytes.length, 4096) & ~1;
  if (sample < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) evenZeros += 1;
    if (bytes[i + 1] === 0) oddZeros += 1;
  }
  const pairs = sample / 2;
  if (oddZeros / pairs > 0.4 && evenZeros / pairs < 0.05) return 'utf-16le';
  if (evenZeros / pairs > 0.4 && oddZeros / pairs < 0.05) return 'utf-16be';
  return null;
}

/** Encoding named in `<?xml ... encoding="GBK"?>`, if the label is one TextDecoder knows. */
function declaredXmlEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const match = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  if (!match) return null;
  try {
    return new TextDecoder(match[1]).encoding;
  } catch {
    return null;
  }
}

/**
 * Decode text files the way users expect on Chinese Windows: BOM first, then strict
 * UTF-8, then UTF-16 without BOM, then the XML-declared encoding, then GB18030
 * (a superset of GBK / GB2312 used by Excel "CSV" exports).
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (startsWith(bytes, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  const utf16 = sniffUtf16(bytes);
  if (utf16) return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16 };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // not UTF-8, fall through
  }
  const declared = declaredXmlEncoding(bytes);
  if (declared && declared !== 'utf-8') {
    return { text: new TextDecoder(declared).decode(bytes), encoding: declared };
  }
  return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' };
}
