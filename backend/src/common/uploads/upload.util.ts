/**
 * Shared hardening for every public image upload (listing photos and the user
 * profile photo).
 *
 * Remediation for MERO-UPLOAD-CONTENT-VALIDATION-001 (High): the upload path
 * used to trust the client-supplied MIME type and the original filename
 * extension, so arbitrary content could be stored under a publicly served
 * /uploads path (HTML/SVG carrying script, or a polyglot image).
 *
 * Defence in depth, cheapest check first:
 *
 *   1. `imageFileFilter`          - rejects obvious non-images before multer
 *                                   writes anything to disk. Advisory only:
 *                                   both the MIME type and the extension are
 *                                   attacker-controlled.
 *   2. `serverFilename`           - the stored name is random and
 *                                   server-chosen, so the client controls
 *                                   neither the filename nor its extension.
 *   3. `validateAndReencodeImage` - the authoritative gate. Reads the real
 *                                   magic bytes with `file-type`, then
 *                                   decodes and re-encodes through `sharp`.
 *                                   Only a genuine, decodable JPEG/PNG can
 *                                   survive that round trip, which strips
 *                                   trailing payloads, embedded scripts and
 *                                   EXIF metadata. A rejection deletes the
 *                                   temporary file.
 *   4. `removeUploadedFiles`      - cleanup helper for request handlers whose
 *                                   service call failed after multer had
 *                                   already written files.
 */
import { BadRequestException } from '@nestjs/common';
import { fileTypeFromFile } from 'file-type';
import { extname, join } from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import sharp from 'sharp';

/** MIME types `file-type` may report for content we accept. */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);

/** Extensions accepted by the (advisory) multer pre-filter. */
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png']);

/** MIME types browsers send, including the common non-standard `image/jpg`. */
const ALLOWED_CLIENT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/jpg',
]);

/** Output is always JPEG, so every stored file gets a fresh `.jpg` name. */
const OUTPUT_EXT = '.jpg';

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 85;

/** Bounds the retry loop in `safeUnlink`. */
const UNLINK_RETRIES = 5;
const UNLINK_RETRY_DELAY_MS = 100;

type FileFilterCb = (error: Error | null, acceptFile: boolean) => void;
type StorageFilenameCb = (error: Error | null, filename: string) => void;

/**
 * Multer `fileFilter` pre-filter.
 *
 * This is a fast rejection for clearly wrong input, not a security control:
 * `file.mimetype` and `file.originalname` are both supplied by the client.
 * The real content check happens in `validateAndReencodeImage` once multer
 * has written the bytes to disk.
 */
export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: FileFilterCb,
): void {
  const ext = extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (!ALLOWED_EXT.has(ext) || !ALLOWED_CLIENT_MIME.has(mime)) {
    cb(
      new BadRequestException(
        `Unsupported image type: ${ext || mime || 'unknown'}`,
      ),
      false,
    );
    return;
  }

  cb(null, true);
}

/**
 * Multer `filename` generator. The client never influences the stored name:
 * a random 128-bit hex value is used, with a whitelisted extension.
 */
export function serverFilename(
  _req: unknown,
  file: Express.Multer.File,
  cb: StorageFilenameCb,
): void {
  const ext = extname(file.originalname || '').toLowerCase();
  const safeExt = ALLOWED_EXT.has(ext) ? ext : OUTPUT_EXT;

  cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`);
}

/**
 * Verifies that `tempPath` really is a JPEG or PNG, re-encodes it to a clean
 * JPEG inside `destDir`, and deletes the temporary file.
 *
 * @returns the basename of the re-encoded file, so callers can build a public
 *          path such as `/uploads/vehicles/<name>`.
 * @throws BadRequestException when the content is not a real image, or cannot
 *         be decoded. The temporary file is removed either way.
 */
export async function validateAndReencodeImage(
  tempPath: string,
  destDir: string,
): Promise<string> {
  const detected = await fileTypeFromFile(tempPath).catch(() => undefined);

  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    await safeUnlink(tempPath);
    throw new BadRequestException(
      'File content does not match an allowed image type (JPEG or PNG).',
    );
  }

  const finalName = `${crypto.randomBytes(16).toString('hex')}${OUTPUT_EXT}`;

  await fs.mkdir(destDir, { recursive: true });
  const destPath = join(destDir, finalName);

  try {
    await sharp(tempPath)
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(destPath);
  } catch {
    // A file that passes the magic-byte check but fails to decode is corrupt
    // or crafted; leave nothing behind.
    await safeUnlink(destPath);
    await safeUnlink(tempPath);
    throw new BadRequestException('Image could not be processed.');
  }

  await safeUnlink(tempPath);
  return finalName;
}

/**
 * Best-effort removal of files multer already wrote to disk. Never throws:
 * callers use this from a catch block, and a failed cleanup must not mask the
 * original error.
 */
export async function removeUploadedFiles(
  files?: Express.Multer.File[],
): Promise<void> {
  if (!files || files.length === 0) {
    return;
  }

  await Promise.all(
    files.map((file) => (file?.path ? safeUnlink(file.path) : undefined)),
  );
}

/**
 * `fs.unlink` that tolerates the transient `EPERM`/`EBUSY` a virus scanner or
 * an antivirus filter driver can cause on Windows, and that never throws.
 */
async function safeUnlink(
  filePath: string,
  retries = UNLINK_RETRIES,
  delayMs = UNLINK_RETRY_DELAY_MS,
): Promise<void> {
  if (!filePath) {
    return;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return;
      }

      const isLastAttempt = attempt === retries - 1;
      if ((err?.code === 'EPERM' || err?.code === 'EBUSY') && !isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      console.warn(
        `Failed to delete upload file ${filePath} after ${attempt + 1} attempt(s):`,
        err?.message,
      );
      return;
    }
  }
}
