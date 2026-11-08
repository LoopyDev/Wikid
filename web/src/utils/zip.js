// A zip file made in the browser, for exports. Files are stored as they are, not compressed:
// Markdown is small, and images are compressed already.

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// Says the file names are UTF-8, so page titles with accents or emoji keep their names when unzipped
const UTF8_NAMES = 0x0800;

/**
 * @param {Array<{ path: string, data: Uint8Array | string }>} entries
 * @returns {Blob}
 */
export const createZipBlob = (entries) => {
  const encoder = new TextEncoder();
  const headerChunks = [];
  const centralChunks = [];
  let offset = 0;

  entries.forEach(({ path, data }) => {
    const fileBytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : encoder.encode(String(data));
    const nameBytes = encoder.encode(path);
    const checksum = crc32(fileBytes);
    const entryOffset = offset;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_NAMES, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, fileBytes.length, true);
    localView.setUint32(22, fileBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    headerChunks.push(localHeader);
    headerChunks.push(fileBytes);
    offset += localHeader.length + fileBytes.length;

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true); // made by
    centralView.setUint16(6, 20, true); // needed to extract
    centralView.setUint16(8, UTF8_NAMES, true);
    centralView.setUint16(10, 0, true); // stored, not compressed
    centralView.setUint16(12, 0, true); // time
    centralView.setUint16(14, 0, true); // date
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, fileBytes.length, true);
    centralView.setUint32(24, fileBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true); // extra field
    centralView.setUint16(32, 0, true); // comment
    centralView.setUint16(34, 0, true); // disk
    centralView.setUint16(36, 0, true); // internal attributes
    centralView.setUint32(38, 0, true); // external attributes
    centralView.setUint32(42, entryOffset, true);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);
  });

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const endOfCentral = new Uint8Array(22);
  const endView = new DataView(endOfCentral.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, centralChunks.length, true);
  endView.setUint16(10, centralChunks.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...headerChunks, ...centralChunks, endOfCentral], { type: 'application/zip' });
};

/**
 * The files in a zip made by createZipBlob (stored, not compressed). For tests.
 * @param {Uint8Array} bytes
 * @returns {Map<string, Uint8Array>}
 */
export const readStoredZip = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map();
  let ptr = 0;
  while (ptr + 30 <= bytes.length && view.getUint32(ptr, true) === 0x04034b50) {
    const size = view.getUint32(ptr + 18, true);
    const nameLength = view.getUint16(ptr + 26, true);
    const extraLength = view.getUint16(ptr + 28, true);
    const nameStart = ptr + 30;
    const dataStart = nameStart + nameLength + extraLength;
    files.set(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)), bytes.slice(dataStart, dataStart + size));
    ptr = dataStart + size;
  }
  return files;
};
