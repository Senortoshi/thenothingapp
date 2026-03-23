import { Script, LockingScript, OP } from "@bsv/sdk";
import { APP_PREFIX, LEGACY_APP_PREFIX, PROTOCOL_VERSION, ACTION_COMMENT } from "./constants";

/**
 * Build the OP_RETURN locking script for a comment.
 *
 * Format (each field is a separate pushdata):
 *   OP_FALSE OP_RETURN <APP_PREFIX> <VERSION> <ACTION> <comment_text> <display_name> <timestamp> [<parent_txid>]
 *
 * OP_FALSE OP_RETURN makes the output provably unspendable and is the
 * standard BSV data-carrier pattern (replaces bare OP_RETURN).
 */
export function buildCommentOpReturn(params: {
  commentText: string;
  displayName: string;
  timestamp: string; // ISO 8601
  parentTxid?: string;
}): LockingScript {
  const { commentText, displayName, timestamp, parentTxid } = params;

  // Build chunks as UTF-8 buffers
  const chunks: number[][] = [
    [OP.OP_FALSE],
    [OP.OP_RETURN],
    toBuffer(APP_PREFIX),
    toBuffer(PROTOCOL_VERSION),
    toBuffer(ACTION_COMMENT),
    toBuffer(commentText),
    toBuffer(displayName),
    toBuffer(timestamp),
  ];

  if (parentTxid) {
    chunks.push(toBuffer(parentTxid));
  }

  // Encode as a Script: OP_FALSE OP_RETURN then push each data chunk
  const scriptData: number[] = [];

  // OP_FALSE (0x00) and OP_RETURN (0x6a)
  scriptData.push(OP.OP_FALSE);
  scriptData.push(OP.OP_RETURN);

  // Push each data chunk with its length prefix
  for (let i = 2; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.length === 0) {
      scriptData.push(0x00); // OP_0 for empty push
    } else if (chunk.length <= 75) {
      scriptData.push(chunk.length); // direct length byte
      scriptData.push(...chunk);
    } else if (chunk.length <= 255) {
      scriptData.push(0x4c); // OP_PUSHDATA1
      scriptData.push(chunk.length);
      scriptData.push(...chunk);
    } else if (chunk.length <= 65535) {
      scriptData.push(0x4d); // OP_PUSHDATA2
      scriptData.push(chunk.length & 0xff);
      scriptData.push((chunk.length >> 8) & 0xff);
      scriptData.push(...chunk);
    } else {
      throw new Error("Data chunk too large for OP_RETURN");
    }
  }

  return Script.fromBinary(scriptData) as unknown as LockingScript;
}

function toBuffer(str: string): number[] {
  return Array.from(Buffer.from(str, "utf8"));
}

// ---------------------------------------------------------------------------
// Parser — decode a raw tx hex back into comment fields
// ---------------------------------------------------------------------------

export interface ParsedComment {
  commentText: string;
  displayName: string;
  timestamp: string;
  parentTxid?: string;
}

/**
 * Parses a raw transaction hex and extracts BSVibes comment fields.
 * Returns null if the transaction is not a valid BSVibes comment.
 *
 * Expected OP_RETURN format (each field is a separate pushdata):
 *   OP_FALSE OP_RETURN <APP_PREFIX> <VERSION> <ACTION> <comment_text> <display_name> <timestamp> [<parent_txid>]
 */
export function parseOpReturnComment(txHex: string): ParsedComment | null {
  try {
    const txBytes = Buffer.from(txHex, "hex");

    // Scan all outputs for an OP_RETURN
    // TX structure (little-endian): version(4) + vin_count(varint) + vins + vout_count(varint) + vouts + locktime(4)
    let offset = 4; // skip version

    // Read vin count
    const vinCount = readVarInt(txBytes, offset);
    offset += vinCount.size;

    // Skip all inputs
    for (let i = 0; i < vinCount.value; i++) {
      offset += 32 + 4; // prev txid + prev vout
      const scriptLen = readVarInt(txBytes, offset);
      offset += scriptLen.size + scriptLen.value + 4; // scriptLen + script + sequence
    }

    // Read vout count
    const voutCount = readVarInt(txBytes, offset);
    offset += voutCount.size;

    // Scan outputs for OP_RETURN
    for (let i = 0; i < voutCount.value; i++) {
      offset += 8; // value (8 bytes, little-endian sats)
      const scriptLen = readVarInt(txBytes, offset);
      offset += scriptLen.size;

      const scriptStart = offset;
      const scriptEnd = offset + scriptLen.value;
      const scriptBytes = txBytes.slice(scriptStart, scriptEnd);
      offset = scriptEnd;

      // Check for OP_FALSE OP_RETURN (0x00 0x6a)
      if (scriptBytes.length >= 2 && scriptBytes[0] === 0x00 && scriptBytes[1] === 0x6a) {
        const fields = extractPushDataFields(scriptBytes, 2);

        // Validate prefix, version, action — accept both current and legacy prefix
        const isOurPrefix = fields[0] === APP_PREFIX || fields[0] === LEGACY_APP_PREFIX;
        if (
          fields.length < 6 ||
          !isOurPrefix ||
          fields[1] !== PROTOCOL_VERSION ||
          fields[2] !== ACTION_COMMENT
        ) {
          continue; // Not our format
        }

        const commentText = fields[3];
        const displayName = fields[4] || "Anonymous";
        const timestamp = fields[5];
        const parentTxid = fields[6] || undefined;

        if (!commentText) return null;

        return { commentText, displayName, timestamp, parentTxid };
      }
    }

    return null; // No matching OP_RETURN found
  } catch {
    return null;
  }
}

/** Reads a Bitcoin varint from buf at offset. Returns value and byte size consumed. */
function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  const first = buf[offset];
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd)
    return { value: buf.readUInt16LE(offset + 1), size: 3 };
  if (first === 0xfe)
    return { value: buf.readUInt32LE(offset + 1), size: 5 };
  // 0xff — 8-byte int (we'll just return a large safe integer)
  return { value: Number(buf.readBigUInt64LE(offset + 1)), size: 9 };
}

/** Extracts all pushdata fields from a script starting at offset, decoded as UTF-8. */
function extractPushDataFields(script: Buffer, startOffset: number): string[] {
  const fields: string[] = [];
  let i = startOffset;

  while (i < script.length) {
    const opcode = script[i];

    if (opcode === 0x00) {
      // OP_0 — empty push
      fields.push("");
      i++;
    } else if (opcode >= 0x01 && opcode <= 0x4b) {
      // Direct push of N bytes
      const len = opcode;
      fields.push(script.slice(i + 1, i + 1 + len).toString("utf8"));
      i += 1 + len;
    } else if (opcode === 0x4c) {
      // OP_PUSHDATA1
      const len = script[i + 1];
      fields.push(script.slice(i + 2, i + 2 + len).toString("utf8"));
      i += 2 + len;
    } else if (opcode === 0x4d) {
      // OP_PUSHDATA2
      const len = script.readUInt16LE(i + 1);
      fields.push(script.slice(i + 3, i + 3 + len).toString("utf8"));
      i += 3 + len;
    } else if (opcode === 0x4e) {
      // OP_PUSHDATA4
      const len = script.readUInt32LE(i + 1);
      fields.push(script.slice(i + 5, i + 5 + len).toString("utf8"));
      i += 5 + len;
    } else {
      break; // Unknown opcode — stop parsing
    }
  }

  return fields;
}
