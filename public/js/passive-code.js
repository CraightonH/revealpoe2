// Pure ES module — official Path of Exile 2 passive-tree share codec (format v7).
// Importable by both the browser and node. Reverse-engineered from the three golden
// fixtures in test/fixtures/passive-tree-codes.json (the oracle); see the format map
// in the comments below and docs §F.

/**
 * Decode URL-safe base64 (with `-`/`_`, optional padding) to bytes.
 * Works in the browser (atob) and node (Buffer).
 * @param {string} str
 * @returns {Uint8Array}
 */
export function b64ToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === 'function'
    ? atob(pad)
    : Buffer.from(pad, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Format v7 byte layout (big-endian throughout)
//
//   Header (8 bytes):
//     version    uint32   (= 7)
//     class      uint8    (= 10 for the captured Mercenary fixtures)
//     ascendancy uint8    (0 = none, 1 = first ascendancy, ...)
//     count      uint16   total allocated node records across all sections
//                         (main + weaponSet + ascNodes); a validation hint.
//
//   Main section — repeated until the separator stops being a main separator:
//     hash   uint16        passive node hash (validates against the tree artifact)
//     sep    uint16        0x0000 = plain record (4 bytes total)
//                          0x0002 = tagged record; a 2-byte group/proxy tag word
//                                   follows (6 bytes total). The tag is metadata
//                                   (observed 0x3a4f / 0x66b9 / 0xdebe) and is not
//                                   needed to recover the allocation, but must be
//                                   preserved for byte-exact re-encode (Task 11).
//     The main section ends at the first record whose sep is neither 0x0000 nor
//     0x0002 — that record is the first trailing (sub-section) record.
//
//   Trailing sub-section — weapon-set then ascendancy records, each:
//     hash    uint16
//     0x00    uint8        constant
//     ssType  uint8        sub-section type: 0x01 = ascendancy-section record,
//                          0x03 = weapon-set-section record
//     subType uint8        within-section selector: for weapon-set records
//                          0x02 = set I, 0x03 = set II; for ascendancy records 0x01
//     If ssType == 0x03, a 2-byte tag word follows (same group/proxy tag as the
//     tagged main records). In the fixtures only the first weapon-set record carries
//     ssType 0x03 + tag; subsequent weapon-set records use ssType 0x01 with subType
//     0x02/0x03. ascendancy records use ssType 0x01 + subType 0x01.
//
// Classification used here: a trailing record is an ascendancy node iff its subType
// is 0x01; otherwise (subType 0x02/0x03) it is a weapon-set node.
// ---------------------------------------------------------------------------

/**
 * Decode a v7 passive-tree share code.
 *
 * The documented summary fields (`nodes`, `weaponSet`, `ascNodes`) are enough to
 * render an allocation, but NOT enough to re-encode the exact bytes: the per-record
 * tag words (which "any Attribute" choice the player made) and weapon-set subType
 * (set I vs II) are user-choice state that cannot be reconstructed from a bare hash.
 * To make `encode(decode(code))` byte-exact, `decode` also returns full per-record
 * detail under `records` (aligned with the documented arrays). `encode` reads that;
 * the documented fields stay stable so existing decode tests pass unchanged.
 *
 * @param {string} codeStr URL-safe base64 share code
 * @returns {{version:number, charClass:number, ascendancy:number,
 *            nodes:number[], weaponSet:number[], ascNodes:number[],
 *            records:{
 *              main:{hash:number, tag:number|null}[],
 *              trailing:{hash:number, ssType:number, subType:number, tag:number|null}[]
 *            }}}
 */
export function decode(codeStr) {
  const b = b64ToBytes(codeStr);
  if (b.length < 8) throw new Error('share code too short');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;

  const version = dv.getUint32(o); o += 4;
  const charClass = b[o++];
  const ascendancy = b[o++];
  o += 2; // count field — not needed to decode; consume it. Recomputed on encode.

  const nodes = [];
  const weaponSet = [];
  const ascNodes = [];
  const mainRecords = [];     // {hash, tag} in stream order
  const trailingRecords = []; // {hash, ssType, subType, tag} in stream order

  // Main section.
  while (o + 4 <= b.length) {
    const sep = dv.getUint16(o + 2);
    if (sep === 0x0000) {
      const hash = dv.getUint16(o);
      nodes.push(hash);
      mainRecords.push({ hash, tag: null });
      o += 4;
    } else if (sep === 0x0002) {
      const hash = dv.getUint16(o);
      const tag = dv.getUint16(o + 4);
      nodes.push(hash);
      mainRecords.push({ hash, tag });
      o += 6; // hash + sep + tag word
    } else {
      break; // first trailing record
    }
  }

  // Trailing sub-section (weapon-set + ascendancy records).
  while (o + 5 <= b.length) {
    const hash = dv.getUint16(o); o += 2;
    o += 1;                 // constant 0x00
    const ssType = b[o++];  // 0x01 or 0x03
    const subType = b[o++]; // 0x01 (asc) | 0x02/0x03 (weapon set)
    let tag = null;
    if (ssType === 0x03) { tag = dv.getUint16(o); o += 2; }
    trailingRecords.push({ hash, ssType, subType, tag });
    if (subType === 0x01) ascNodes.push(hash);
    else weaponSet.push(hash);
  }

  return {
    version, charClass, ascendancy, nodes, weaponSet, ascNodes,
    records: { main: mainRecords, trailing: trailingRecords },
  };
}

/**
 * Encode bytes to URL-safe base64 (`-`/`_`, no padding) — the inverse of
 * {@link b64ToBytes}. Works in the browser (btoa) and node (Buffer).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToB64(bytes) {
  let b64;
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    b64 = btoa(bin);
  } else {
    b64 = Buffer.from(bytes).toString('base64');
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encode a decoded state back into a v7 share code, byte-for-byte identical to the
 * original. Mirrors {@link decode}: header, then main records (plain or tagged), then
 * trailing weapon-set + ascendancy records. Reads the per-record `records` detail so
 * tags and weapon-set subTypes (non-derivable user choices) are reproduced exactly.
 * @param {ReturnType<typeof decode>} state
 * @returns {string} URL-safe base64 share code
 */
export function encode(state) {
  const main = state.records.main;
  const trailing = state.records.trailing;

  // Size the buffer: header (8) + main records + trailing records.
  let len = 8;
  for (const r of main) len += r.tag === null ? 4 : 6;
  for (const r of trailing) len += r.ssType === 0x03 ? 7 : 5;

  const b = new Uint8Array(len);
  const dv = new DataView(b.buffer);
  let o = 0;

  // Header. count = total records across all sections (main + trailing).
  dv.setUint32(o, state.version); o += 4;
  b[o++] = state.charClass;
  b[o++] = state.ascendancy;
  dv.setUint16(o, main.length + trailing.length); o += 2;

  // Main section.
  for (const r of main) {
    dv.setUint16(o, r.hash); o += 2;
    if (r.tag === null) {
      dv.setUint16(o, 0x0000); o += 2;
    } else {
      dv.setUint16(o, 0x0002); o += 2;
      dv.setUint16(o, r.tag); o += 2;
    }
  }

  // Trailing sub-section.
  for (const r of trailing) {
    dv.setUint16(o, r.hash); o += 2;
    b[o++] = 0x00;
    b[o++] = r.ssType;
    b[o++] = r.subType;
    if (r.ssType === 0x03) { dv.setUint16(o, r.tag); o += 2; }
  }

  return bytesToB64(b);
}
