// public/js/build-code.js
// Pure ES module — Build Planner share codec. A build GROUP (parent + ordered
// labeled variant siblings) → canonical JSON → deflate → base64url with a
// leading codec-version char. Dual-environment via the Web CompressionStream API
// (global in Node >= 20 and evergreen browsers); format 'deflate' deliberately —
// 'deflate-raw' is missing from some Node 20.x.
//
// v2 (2026-07-24) packs a whole group so a leveling guide travels as ONE URL;
// deflate absorbs the heavy inter-variant redundancy (8 heavy variants ≈ 1.5 KB).
// v1 codes were single builds and MUST stay decodable forever.
import { b64ToBytes, bytesToB64 } from './passive-code.js';
import { validateBuild } from './build-store.js';

const CODEC_VERSION = '2';
const LEGACY_VERSIONS = new Set(['1']);

export class CodecError extends Error {
  /** @param {'bad-version'|'corrupt'|'invalid-build'} code */
  constructor(code, message) {
    super(message);
    this.name = 'CodecError';
    this.code = code;
  }
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Local-only fields never travel; everything else (incl. unknown future
// fields) passes through so old sites can share to newer ones.
function canonical(build) {
  const { id, createdAt, updatedAt, ...rest } = build;
  return rest;
}

function checked(build, where) {
  const { ok, errors } = validateBuild(build);
  if (!ok) throw new CodecError('invalid-build', `${where} failed validation: ${errors.join('; ')}`);
  return build;
}

/**
 * Group → version-prefixed base64url deflate of its canonical JSON. The payload
 * keys are single letters ('p'arent / 'v'ariants / 'l'abel / 'b'uild) because
 * they repeat once per variant inside the compressed stream.
 * @param {{parent: object, variants?: {label: string, build: object}[]}} group
 * @returns {Promise<string>}
 */
export async function encodeGroup({ parent, variants = [] }) {
  const payload = {
    p: canonical(parent),
    v: variants.map(({ label, build }) => ({ l: label, b: canonical(build) })),
  };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)),
    new CompressionStream('deflate'));
  return CODEC_VERSION + bytesToB64(packed);
}

async function inflate(str) {
  try {
    const bytes = await pipe(b64ToBytes(str.slice(1)), new DecompressionStream('deflate'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CodecError('corrupt', 'build code is not valid compressed JSON');
  }
}

/**
 * Inverse of {@link encodeGroup}, and the reader for legacy v1 single-build
 * codes (which decode to a group with no variants). Resolves to id-less
 * canonical builds — the caller assigns local identity.
 * @param {string} str
 * @returns {Promise<{parent: object, variants: {label: string, build: object}[]}>}
 */
export async function decodeGroup(str) {
  const v = typeof str === 'string' ? str[0] : undefined;
  if (v !== CODEC_VERSION && !LEGACY_VERSIONS.has(v)) {
    throw new CodecError('bad-version', `unknown build code version ${v ?? '(empty)'}`);
  }
  const payload = await inflate(str);
  if (LEGACY_VERSIONS.has(v)) return { parent: checked(payload, 'decoded build'), variants: [] };

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !payload.p) {
    throw new CodecError('corrupt', 'group code has no parent build');
  }
  const variants = (Array.isArray(payload.v) ? payload.v : []).map((e, i) => {
    if (e === null || typeof e !== 'object') {
      throw new CodecError('corrupt', `group variant ${i} is not an object`);
    }
    return {
      label: typeof e.l === 'string' ? e.l : `Variant ${i + 1}`,
      build: checked(e.b, `decoded variant ${i}`),
    };
  });
  return { parent: checked(payload.p, 'decoded build'), variants };
}
