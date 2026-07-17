import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

export function readZipEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    assert.equal(flags & 0x0008, 0, "Plugin bundle ZIP entry sizes must be stored in local headers.");

    const nameStart = offset + 30;
    const contentsStart = nameStart + nameLength + extraLength;
    const contentsEnd = contentsStart + compressedSize;
    assert.ok(contentsEnd <= archive.length, "Plugin bundle contains a truncated ZIP entry.");

    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = archive.subarray(contentsStart, contentsEnd);
    if (method === 0) entries.set(name, Buffer.from(compressed));
    else if (method === 8) entries.set(name, inflateRawSync(compressed));
    else assert.fail(`Unsupported ZIP compression method ${method} for ${name}.`);
    offset = contentsEnd;
  }
  return entries;
}
