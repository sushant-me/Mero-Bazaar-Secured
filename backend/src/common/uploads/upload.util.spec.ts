/**
 * Regression tests for MERO-UPLOAD-CONTENT-VALIDATION-001 (High).
 *
 * The old upload path trusted the client MIME type and the original filename
 * extension, so arbitrary content could be written under a publicly served
 * /uploads path. These tests assert the replacement fails CLOSED:
 *
 *   - a non-image is rejected even when it is named and announced as a PNG
 *   - an accepted image is re-encoded, so what is stored is a fresh JPEG that
 *     the server produced, never the client's bytes
 *   - the client never controls the stored filename
 */
import { BadRequestException } from '@nestjs/common';
import { fileTypeFromFile } from 'file-type';
import * as fs from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import sharp from 'sharp';

import {
  imageFileFilter,
  removeUploadedFiles,
  serverFilename,
  validateAndReencodeImage,
} from './upload.util';

// `file-type` is redirected to __mocks__/file-type.js by moduleNameMapper.
const mockedFileTypeFromFile = fileTypeFromFile as unknown as jest.Mock;

function multerFile(
  overrides: Record<string, unknown> = {},
): Express.Multer.File {
  return {
    fieldname: 'images',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 16,
    destination: './uploads/vehicles',
    filename: 'stored.png',
    path: './uploads/vehicles/stored.png',
    buffer: Buffer.alloc(0),
    ...overrides,
  } as unknown as Express.Multer.File;
}

describe('imageFileFilter (advisory pre-filter)', () => {
  it('accepts a JPEG or PNG by name', () => {
    const accept = jest.fn();
    imageFileFilter({}, multerFile(), accept);
    expect(accept).toHaveBeenCalledWith(null, true);
  });

  it('accepts WebP, which accept="image/*" forms can produce', () => {
    const accept = jest.fn();
    imageFileFilter(
      {},
      multerFile({ originalname: 'x.webp', mimetype: 'image/webp' }),
      accept,
    );
    expect(accept).toHaveBeenCalledWith(null, true);
  });

  it('rejects an SVG even though the browser calls it an image', () => {
    const accept = jest.fn();
    imageFileFilter(
      {},
      multerFile({ originalname: 'x.svg', mimetype: 'image/svg+xml' }),
      accept,
    );
    const [error, allowed] = accept.mock.calls[0];
    expect(allowed).toBe(false);
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it('rejects an HTML file renamed to .png', () => {
    const accept = jest.fn();
    imageFileFilter(
      {},
      multerFile({ originalname: 'x.png', mimetype: 'text/html' }),
      accept,
    );
    const [error, allowed] = accept.mock.calls[0];
    expect(allowed).toBe(false);
    expect(error).toBeInstanceOf(BadRequestException);
  });
});

describe('serverFilename', () => {
  it('never reuses the client-supplied name', () => {
    const cb = jest.fn();
    serverFilename({}, multerFile({ originalname: '../../etc/passwd.png' }), cb);

    const [error, name] = cb.mock.calls[0];
    expect(error).toBeNull();
    expect(name).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(name).not.toContain('passwd');
    expect(name).not.toContain('/');
  });

  it('falls back to .jpg for an extension outside the allowlist', () => {
    const cb = jest.fn();
    serverFilename({}, multerFile({ originalname: 'x.svg' }), cb);
    expect(cb.mock.calls[0][1]).toMatch(/^[0-9a-f]{32}\.jpg$/);
  });

  it('produces a distinct name each time', () => {
    const cb = jest.fn();
    serverFilename({}, multerFile(), cb);
    serverFilename({}, multerFile(), cb);
    expect(cb.mock.calls[0][1]).not.toBe(cb.mock.calls[1][1]);
  });
});

describe('validateAndReencodeImage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(os.tmpdir(), 'upload-util-'));
    mockedFileTypeFromFile.mockReset();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rejects content whose magic bytes are not an image, and deletes it', async () => {
    const tempPath = join(dir, 'payload.png');
    await fs.writeFile(tempPath, '<html><script>alert(1)</script></html>');
    // file-type finds no known signature in HTML.
    mockedFileTypeFromFile.mockResolvedValue(undefined);

    await expect(
      validateAndReencodeImage(tempPath, join(dir, 'out')),
    ).rejects.toThrow(BadRequestException);

    await expect(fs.access(tempPath)).rejects.toThrow();
  });

  it('rejects a real but non-allowlisted format (GIF)', async () => {
    const tempPath = join(dir, 'x.gif');
    await fs.writeFile(tempPath, Buffer.from('GIF89a'));
    mockedFileTypeFromFile.mockResolvedValue({ ext: 'gif', mime: 'image/gif' });

    await expect(
      validateAndReencodeImage(tempPath, join(dir, 'out')),
    ).rejects.toThrow(BadRequestException);
  });

  it('re-encodes a real PNG to a server-generated JPEG and removes the temp file', async () => {
    const tempPath = join(dir, 'real.png');
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 200, g: 30, b: 30 },
      },
    })
      .png()
      .toFile(tempPath);
    mockedFileTypeFromFile.mockResolvedValue({ ext: 'png', mime: 'image/png' });

    const destDir = join(dir, 'out');
    const finalName = await validateAndReencodeImage(tempPath, destDir);

    expect(finalName).toMatch(/^[0-9a-f]{32}\.jpg$/);

    // The stored file is a genuine JPEG the server produced.
    const stored = join(destDir, finalName);
    const metadata = await sharp(stored).metadata();
    expect(metadata.format).toBe('jpeg');

    // The client's original bytes are gone.
    await expect(fs.access(tempPath)).rejects.toThrow();
  });

  it('accepts a real WebP and re-encodes it to a JPEG', async () => {
    const tempPath = join(dir, 'real.webp');
    await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 30, g: 120, b: 200 },
      },
    })
      .webp()
      .toFile(tempPath);
    mockedFileTypeFromFile.mockResolvedValue({
      ext: 'webp',
      mime: 'image/webp',
    });

    const destDir = join(dir, 'out-webp');
    const finalName = await validateAndReencodeImage(tempPath, destDir);

    expect(finalName).toMatch(/^[0-9a-f]{32}\.jpg$/);
    const metadata = await sharp(join(destDir, finalName)).metadata();
    expect(metadata.format).toBe('jpeg');

    await expect(fs.access(tempPath)).rejects.toThrow();
  });

  it('rejects a PNG magic-byte header with a non-image body', async () => {
    const tempPath = join(dir, 'polyglot.png');
    // Valid PNG signature, then junk that cannot be decoded.
    await fs.writeFile(
      tempPath,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('<script>alert(1)</script>'),
      ]),
    );
    mockedFileTypeFromFile.mockResolvedValue({ ext: 'png', mime: 'image/png' });

    await expect(
      validateAndReencodeImage(tempPath, join(dir, 'out')),
    ).rejects.toThrow(BadRequestException);

    await expect(fs.access(tempPath)).rejects.toThrow();
  });
});

describe('removeUploadedFiles', () => {
  it('deletes the files multer wrote and never throws on a missing one', async () => {
    const dir = await fs.mkdtemp(join(os.tmpdir(), 'upload-cleanup-'));
    const a = join(dir, 'a.png');
    const b = join(dir, 'b.png');
    await fs.writeFile(a, 'x');
    await fs.writeFile(b, 'y');

    await expect(
      removeUploadedFiles([
        multerFile({ path: a }),
        multerFile({ path: b }),
        multerFile({ path: join(dir, 'already-gone.png') }),
      ]),
    ).resolves.toBeUndefined();

    await expect(fs.access(a)).rejects.toThrow();
    await expect(fs.access(b)).rejects.toThrow();

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('tolerates an empty or absent list', async () => {
    await expect(removeUploadedFiles([])).resolves.toBeUndefined();
    await expect(removeUploadedFiles(undefined)).resolves.toBeUndefined();
  });
});
