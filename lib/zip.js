const encoder = new TextEncoder();
const ZIP64_LIMIT = 0xffffffffn;
const UINT16_LIMIT = 0xffffn;
const UTF8_DATA_DESCRIPTOR_FLAG = 0x0808;
const STORE_METHOD = 0;

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC_TABLE.length; i += 1) {
  let crc = i;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[i] = crc >>> 0;
}

function toBigIntSize(value) {
  const size = BigInt(Number(value));
  if (size <= 0n) {
    throw new Error('ZIP entries must have a positive size.');
  }
  return size;
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach(chunk => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function writeUInt16(view, offset, value) {
  view.setUint16(offset, Number(value), true);
}

function writeUInt32(view, offset, value) {
  view.setUint32(offset, Number(value), true);
}

function writeUInt64(view, offset, value) {
  let remaining = BigInt(value);
  for (let i = 0; i < 8; i += 1) {
    view.setUint8(offset + i, Number(remaining & 0xffn));
    remaining >>= 8n;
  }
}

function dosDateTime(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.valueOf()) ? new Date() : date;
  const year = Math.max(1980, safeDate.getFullYear());
  const dosTime = (safeDate.getHours() << 11)
    | (safeDate.getMinutes() << 5)
    | Math.floor(safeDate.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9)
    | ((safeDate.getMonth() + 1) << 5)
    | safeDate.getDate();

  return { dosTime, dosDate };
}

function zip64Extra(values) {
  const payloadLength = values.length * 8;
  const output = new Uint8Array(4 + payloadLength);
  const view = new DataView(output.buffer);

  writeUInt16(view, 0, 0x0001);
  writeUInt16(view, 2, payloadLength);
  values.forEach((value, index) => writeUInt64(view, 4 + index * 8, value));

  return output;
}

function updateCrc32(crc, chunk) {
  let nextCrc = crc;
  for (let i = 0; i < chunk.length; i += 1) {
    nextCrc = CRC_TABLE[(nextCrc ^ chunk[i]) & 0xff] ^ (nextCrc >>> 8);
  }
  return nextCrc >>> 0;
}

function localFileHeader(entry, nameBytes) {
  const size = toBigIntSize(entry.sizeBytes);
  const needsZip64 = size >= ZIP64_LIMIT;
  const extra = needsZip64 ? zip64Extra([size, size]) : new Uint8Array(0);
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  const { dosTime, dosDate } = dosDateTime(entry.lastModified);

  writeUInt32(view, 0, 0x04034b50);
  writeUInt16(view, 4, needsZip64 ? 45 : 20);
  writeUInt16(view, 6, UTF8_DATA_DESCRIPTOR_FLAG);
  writeUInt16(view, 8, STORE_METHOD);
  writeUInt16(view, 10, dosTime);
  writeUInt16(view, 12, dosDate);
  writeUInt32(view, 14, 0);
  writeUInt32(view, 18, needsZip64 ? 0xffffffff : 0);
  writeUInt32(view, 22, needsZip64 ? 0xffffffff : 0);
  writeUInt16(view, 26, nameBytes.length);
  writeUInt16(view, 28, extra.length);

  return concatBytes([header, nameBytes, extra]);
}

function dataDescriptor(crc32, size) {
  const needsZip64 = size >= ZIP64_LIMIT;
  const output = new Uint8Array(needsZip64 ? 24 : 16);
  const view = new DataView(output.buffer);

  writeUInt32(view, 0, 0x08074b50);
  writeUInt32(view, 4, crc32);
  if (needsZip64) {
    writeUInt64(view, 8, size);
    writeUInt64(view, 16, size);
  } else {
    writeUInt32(view, 8, size);
    writeUInt32(view, 12, size);
  }

  return output;
}

function centralDirectoryHeader(entry) {
  const size = entry.size;
  const offset = entry.offset;
  const needsZip64Size = size >= ZIP64_LIMIT;
  const needsZip64Offset = offset >= ZIP64_LIMIT;
  const zip64Values = [];

  if (needsZip64Size) {
    zip64Values.push(size, size);
  }
  if (needsZip64Offset) {
    zip64Values.push(offset);
  }

  const extra = zip64Values.length ? zip64Extra(zip64Values) : new Uint8Array(0);
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);

  writeUInt32(view, 0, 0x02014b50);
  writeUInt16(view, 4, extra.length ? 45 : 20);
  writeUInt16(view, 6, needsZip64Size ? 45 : 20);
  writeUInt16(view, 8, UTF8_DATA_DESCRIPTOR_FLAG);
  writeUInt16(view, 10, STORE_METHOD);
  writeUInt16(view, 12, entry.dosTime);
  writeUInt16(view, 14, entry.dosDate);
  writeUInt32(view, 16, entry.crc32);
  writeUInt32(view, 20, needsZip64Size ? 0xffffffff : size);
  writeUInt32(view, 24, needsZip64Size ? 0xffffffff : size);
  writeUInt16(view, 28, entry.nameBytes.length);
  writeUInt16(view, 30, extra.length);
  writeUInt16(view, 32, 0);
  writeUInt16(view, 34, 0);
  writeUInt16(view, 36, 0);
  writeUInt32(view, 38, 0);
  writeUInt32(view, 42, needsZip64Offset ? 0xffffffff : offset);

  return concatBytes([header, entry.nameBytes, extra]);
}

function zip64EndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const record = new Uint8Array(56);
  const view = new DataView(record.buffer);

  writeUInt32(view, 0, 0x06064b50);
  writeUInt64(view, 4, 44n);
  writeUInt16(view, 12, 45);
  writeUInt16(view, 14, 45);
  writeUInt32(view, 16, 0);
  writeUInt32(view, 20, 0);
  writeUInt64(view, 24, entryCount);
  writeUInt64(view, 32, entryCount);
  writeUInt64(view, 40, centralDirectorySize);
  writeUInt64(view, 48, centralDirectoryOffset);

  return record;
}

function zip64EndOfCentralDirectoryLocator(zip64DirectoryOffset) {
  const locator = new Uint8Array(20);
  const view = new DataView(locator.buffer);

  writeUInt32(view, 0, 0x07064b50);
  writeUInt32(view, 4, 0);
  writeUInt64(view, 8, zip64DirectoryOffset);
  writeUInt32(view, 16, 1);

  return locator;
}

function endOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset, needsZip64) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  const entryCountField = needsZip64 ? 0xffff : entryCount;
  const sizeField = needsZip64 ? 0xffffffff : centralDirectorySize;
  const offsetField = needsZip64 ? 0xffffffff : centralDirectoryOffset;

  writeUInt32(view, 0, 0x06054b50);
  writeUInt16(view, 4, 0);
  writeUInt16(view, 6, 0);
  writeUInt16(view, 8, entryCountField);
  writeUInt16(view, 10, entryCountField);
  writeUInt32(view, 12, sizeField);
  writeUInt32(view, 16, offsetField);
  writeUInt16(view, 20, 0);

  return record;
}

function entryNameBytes(entry) {
  const nameBytes = encoder.encode(entry.name);
  if (nameBytes.length > 0xffff) {
    throw new Error(`ZIP entry name is too long: ${entry.name}`);
  }
  return nameBytes;
}

function centralExtraLength(size, offset) {
  let valueCount = 0;
  if (size >= ZIP64_LIMIT) valueCount += 2;
  if (offset >= ZIP64_LIMIT) valueCount += 1;
  return valueCount ? BigInt(4 + valueCount * 8) : 0n;
}

export function estimateStoredZipSize(entries) {
  let offset = 0n;
  let centralDirectorySize = 0n;

  entries.forEach(entry => {
    const nameLength = BigInt(entryNameBytes(entry).length);
    const size = toBigIntSize(entry.sizeBytes);
    const localExtraLength = size >= ZIP64_LIMIT ? 20n : 0n;
    const descriptorLength = size >= ZIP64_LIMIT ? 24n : 16n;
    const entryOffset = offset;

    offset += 30n + nameLength + localExtraLength + size + descriptorLength;
    centralDirectorySize += 46n + nameLength + centralExtraLength(size, entryOffset);
  });

  const entryCount = BigInt(entries.length);
  const needsZip64 = entryCount >= UINT16_LIMIT
    || offset >= ZIP64_LIMIT
    || centralDirectorySize >= ZIP64_LIMIT;
  const zip64Length = needsZip64 ? 76n : 0n;

  return offset + centralDirectorySize + zip64Length + 22n;
}

export function createStoredZipStream(entries) {
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  async function writeChunk(chunk) {
    await writer.write(chunk);
  }

  async function writeZip() {
    let offset = 0n;
    const completedEntries = [];

    for (const entry of entries) {
      const expectedSize = toBigIntSize(entry.sizeBytes);
      const nameBytes = entryNameBytes(entry);
      const offsetBeforeEntry = offset;
      const localHeader = localFileHeader(entry, nameBytes);
      const { dosTime, dosDate } = dosDateTime(entry.lastModified);

      await writeChunk(localHeader);
      offset += BigInt(localHeader.length);

      const upstream = await entry.open();
      if (!upstream.ok && upstream.status !== 206) {
        throw new Error(`Could not fetch ZIP entry: ${entry.name}`);
      }
      if (!upstream.body) {
        throw new Error(`ZIP entry has no response body: ${entry.name}`);
      }

      const reader = upstream.body.getReader();
      let crc = 0xffffffff;
      let written = 0n;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        crc = updateCrc32(crc, chunk);
        written += BigInt(chunk.length);
        offset += BigInt(chunk.length);
        await writeChunk(chunk);
      }

      if (written !== expectedSize) {
        throw new Error(`ZIP entry size changed while downloading: ${entry.name}`);
      }

      const crc32 = (crc ^ 0xffffffff) >>> 0;
      const descriptor = dataDescriptor(crc32, written);
      await writeChunk(descriptor);
      offset += BigInt(descriptor.length);

      completedEntries.push({
        nameBytes,
        size: written,
        offset: offsetBeforeEntry,
        crc32,
        dosTime,
        dosDate,
      });
    }

    const centralDirectoryOffset = offset;
    for (const entry of completedEntries) {
      const centralHeader = centralDirectoryHeader(entry);
      await writeChunk(centralHeader);
      offset += BigInt(centralHeader.length);
    }

    const centralDirectorySize = offset - centralDirectoryOffset;
    const entryCount = BigInt(completedEntries.length);
    const needsZip64 = entryCount >= UINT16_LIMIT
      || centralDirectoryOffset >= ZIP64_LIMIT
      || centralDirectorySize >= ZIP64_LIMIT;

    if (needsZip64) {
      const zip64DirectoryOffset = offset;
      const zip64Directory = zip64EndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset);
      const zip64Locator = zip64EndOfCentralDirectoryLocator(zip64DirectoryOffset);

      await writeChunk(zip64Directory);
      offset += BigInt(zip64Directory.length);
      await writeChunk(zip64Locator);
      offset += BigInt(zip64Locator.length);
    }

    await writeChunk(endOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset, needsZip64));
  }

  queueMicrotask(async () => {
    try {
      await writeZip();
      await writer.close();
    } catch (error) {
      await writer.abort(error);
    }
  });

  return stream.readable;
}
