// public/js/build-code.js
// Pure ES module — Build Planner share codec. Canonical JSON → deflate →
// base64url with a leading codec-version char. Dual-environment via the Web
// CompressionStream API (global in Node >= 20 and evergreen browsers); format
// 'deflate' deliberately — 'deflate-raw' is missing from some Node 20.x.
import { b64ToBytes, bytesToB64 } from './passive-code.js';
import { validateBuild } from './build-store.js';

const CODEC_VERSION = '1';

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

/** Build → version-prefixed base64url deflate of its canonical JSON. */
export async function encodeBuild(build) {
  const json = JSON.stringify(canonical(build));
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate'));
  return CODEC_VERSION + bytesToB64(packed);
}

/** Inverse of encodeBuild. Resolves to an id-less canonical build. */
export async function decodeBuild(str) {
  if (typeof str !== 'string' || str[0] !== CODEC_VERSION) {
    throw new CodecError('bad-version', `unknown build code version ${String(str)[0] ?? '(empty)'}`);
  }
  let build;
  try {
    const bytes = await pipe(b64ToBytes(str.slice(1)), new DecompressionStream('deflate'));
    build = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new CodecError('corrupt', 'build code is not valid compressed JSON');
  }
  const { ok, errors } = validateBuild(build);
  if (!ok) throw new CodecError('invalid-build', `decoded build failed validation: ${errors.join('; ')}`);
  return build;
}
