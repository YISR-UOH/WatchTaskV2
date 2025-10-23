import pako from "pako";

export const COMPRESSION_THRESHOLD = 1024;
export const MAX_CHUNK_SIZE = 64 * 1024;
export const COMPRESSION_LEVEL = 6;

export function compressPayload(data) {
  try {
    const jsonString = JSON.stringify(data);
    if (jsonString.length < COMPRESSION_THRESHOLD) {
      return { data: jsonString, compressed: false };
    }
    const compressed = pako.gzip(jsonString, { level: COMPRESSION_LEVEL });
    return { data: compressed, compressed: true };
  } catch {
    const fallback = JSON.stringify(data);
    return { data: fallback, compressed: false };
  }
}

export function decompressPayload(data, compressed) {
  try {
    if (!compressed) {
      return typeof data === "string" ? JSON.parse(data) : data;
    }
    const source = data instanceof Uint8Array ? data : new Uint8Array(data);
    const decompressed = pako.ungzip(source, { to: "string" });
    return JSON.parse(decompressed);
  } catch {
    throw new Error("Failed to decompress data");
  }
}

export function createChunks(serialized, compressed) {
  const chunks = [];
  const totalSize = serialized.length || serialized.byteLength;
  const numChunks = Math.ceil(totalSize / MAX_CHUNK_SIZE);

  for (let index = 0; index < numChunks; index++) {
    const start = index * MAX_CHUNK_SIZE;
    const end = Math.min(start + MAX_CHUNK_SIZE, totalSize);
    const slice = serialized.slice
      ? serialized.slice(start, end)
      : serialized.subarray(start, end);

    chunks.push({
      data: slice,
      index,
      total: numChunks,
      size: slice.length || slice.byteLength,
      compressed,
    });
  }

  return chunks;
}

export function encodeBinaryChunk(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function decodeBinaryChunk(encoded) {
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

export function reassembleChunks(chunks) {
  if (!chunks.length) return null;
  const first = chunks[0];
  const isBinary = !(
    typeof first === "string" || typeof first.data === "string"
  );

  if (!isBinary) {
    return chunks.map((chunk) => chunk.data || chunk).join("");
  }

  const sources = chunks.map((chunk) =>
    chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  );
  const total = sources.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of sources) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function buildChunkKey(remoteId, originalType, metadata = {}) {
  if (metadata.userCode != null) {
    return `${remoteId}-${originalType}-user-${metadata.userCode}`;
  }
  if (metadata.speciality != null) {
    return `${remoteId}-${originalType}-spec-${metadata.speciality}`;
  }
  return `${remoteId}-${originalType}-all`;
}
