/**
 * LODVault — Compression module (deflate-raw + custom base64)
 *
 * Uses the browser-native CompressionStream / DecompressionStream API when
 * available, with a transparent fallback that returns text unchanged.
 * Stores compressed output as base64 strings so they survive
 * chrome.storage.sync JSON serialisation.
 */
(() => {
  const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /* ------------------------------------------------------------------ */
  /*  Feature detection                                                   */
  /* ------------------------------------------------------------------ */

  let compressionAvailable = false;

  try {
    compressionAvailable = Boolean(
      typeof CompressionStream !== "undefined"
      && typeof DecompressionStream !== "undefined"
      && typeof ReadableStream !== "undefined"
      && typeof WritableStream !== "undefined"
      && typeof TextEncoder !== "undefined"
      && typeof TextDecoder !== "undefined"
    );
  } catch (_error) {
    // Intentionally empty — fall back to no-op.
  }

  /* ------------------------------------------------------------------ */
  /*  Custom base64 (avoids btoa/atob which may be absent in workers)     */
  /* ------------------------------------------------------------------ */

  function bytesToBase64(bytes) {
    let result = "";
    const length = bytes.length;

    for (let index = 0; index < length; index += 3) {
      const byte1 = bytes[index];
      const byte2 = index + 1 < length ? bytes[index + 1] : 0;
      const byte3 = index + 2 < length ? bytes[index + 2] : 0;

      result += BASE64_ALPHABET[byte1 >> 2];
      result += BASE64_ALPHABET[((byte1 & 3) << 4) | (byte2 >> 4)];
      result += index + 1 < length ? BASE64_ALPHABET[((byte2 & 15) << 2) | (byte3 >> 6)] : "=";
      result += index + 2 < length ? BASE64_ALPHABET[byte3 & 63] : "=";
    }

    return result;
  }

  function base64ToBytes(value) {
    const cleaned = String(value || "").replace(/[^A-Za-z0-9+/=]/g, "");
    const length = cleaned.length;

    if (length === 0) {
      return new Uint8Array(0);
    }

    const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
    const outputLength = Math.floor(length * 0.75) - padding;
    const bytes = new Uint8Array(outputLength);
    let byteIndex = 0;

    for (let index = 0; index < length; index += 4) {
      const enc1 = BASE64_ALPHABET.indexOf(cleaned[index]);
      const enc2 = BASE64_ALPHABET.indexOf(cleaned[index + 1]);
      const enc3 = index + 2 < length && cleaned[index + 2] !== "="
        ? BASE64_ALPHABET.indexOf(cleaned[index + 2])
        : 0;
      const enc4 = index + 3 < length && cleaned[index + 3] !== "="
        ? BASE64_ALPHABET.indexOf(cleaned[index + 3])
        : 0;

      bytes[byteIndex++] = (enc1 << 2) | (enc2 >> 4);

      if (index + 2 < length && cleaned[index + 2] !== "=") {
        bytes[byteIndex++] = ((enc2 & 15) << 4) | (enc3 >> 2);
      }

      if (index + 3 < length && cleaned[index + 3] !== "=") {
        bytes[byteIndex++] = ((enc3 & 3) << 6) | enc4;
      }
    }

    return bytes;
  }

  /* ------------------------------------------------------------------ */
  /*  Stream helpers                                                     */
  /* ------------------------------------------------------------------ */

  async function readAllChunks(readableStream) {
    const reader = readableStream.getReader();
    const chunks = [];

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          chunks.push(value);
        }
      }
      return buildResult(chunks);
    } catch (_error) {
      return null;
    } finally {
      try {
        reader.releaseLock();
      } catch (_error) {
        // Reader may already be released due to stream error.
      }
    }
  }

  function buildResult(chunks) {
    if (chunks.length === 0) {
      return new Uint8Array(0);
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Compress a UTF-8 string via deflate-raw and return a base64-encoded
   * result.  When compression is unavailable the function returns the
   * original text unchanged (identity fallback).
   */
  async function compress(text) {
    if (!compressionAvailable) {
      return text;
    }

    try {
      const encoder = new TextEncoder();
      const inputBytes = encoder.encode(text);

      if (inputBytes.length === 0) {
        return "";
      }

      const cs = new CompressionStream("deflate-raw");
      const writer = cs.writable.getWriter();
      const readerPromise = readAllChunks(cs.readable);

      await writer.write(inputBytes);
      await writer.close();

      const compressedBytes = await readerPromise;
      return bytesToBase64(compressedBytes);
    } catch (_error) {
      return text;
    }
  }

  /**
   * Decompress a base64-encoded deflate-raw payload back into the original
   * UTF-8 string.  When compression is unavailable, returns the argument
   * unchanged.
   */
  async function decompress(value) {
    if (!compressionAvailable) {
      return value;
    }

    try {
      const compressedBytes = base64ToBytes(value);

      if (compressedBytes.length === 0) {
        return "";
      }

      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      const readerPromise = readAllChunks(ds.readable);

      try {
        await writer.write(compressedBytes);
        await writer.close();
      } catch (_error) {
        writer.releaseLock();
        return value;
      }

      const decompressedBytes = await readerPromise;

      if (!decompressedBytes) {
        return value;
      }

      const decoder = new TextDecoder();
      return decoder.decode(decompressedBytes);
    } catch (_error) {
      return value;
    }
  }

  /** Returns true when the native CompressionStream API is available. */
  function isAvailable() {
    return compressionAvailable;
  }

  /* ------------------------------------------------------------------ */
  /*  Export                                                             */
  /* ------------------------------------------------------------------ */

  globalThis.LodWrapperCompress = Object.freeze({
    compress,
    decompress,
    isAvailable,
    // Exposed for tests that need to stub the availability flag.
    _setAvailableForTest(available) {
      compressionAvailable = Boolean(available);
    }
  });
})();
