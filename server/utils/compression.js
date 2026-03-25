const zlib = require('zlib');
const archiver = require('archiver');
const { Readable } = require('stream');
const { logger } = require('./logger');

/**
 * Compression utility for files and file streams
 * Supports GZIP for single files and ZIP for multiple files
 */

/**
 * Compress single file buffer with GZIP
 * @param {Buffer} fileBuffer - File data to compress
 * @returns {Promise<Buffer>} Compressed file data
 */
exports.compressGZIP = async (fileBuffer) => {
  return new Promise((resolve, reject) => {
    try {
      zlib.gzip(fileBuffer, (err, compressed) => {
        if (err) {
          logger.error('GZIP compression error:', err);
          reject(err);
        } else {
          const compressionRatio = ((1 - compressed.length / fileBuffer.length) * 100).toFixed(2);
          logger.debug(`File compressed with GZIP: ${compressionRatio}% reduction`);
          resolve(compressed);
        }
      });
    } catch (error) {
      logger.error('Error in compressGZIP:', error);
      reject(error);
    }
  });
};

/**
 * Decompress GZIP compressed buffer
 * @param {Buffer} compressedBuffer - Compressed data
 * @returns {Promise<Buffer>} Decompressed file data
 */
exports.decompressGZIP = async (compressedBuffer) => {
  return new Promise((resolve, reject) => {
    try {
      zlib.gunzip(compressedBuffer, (err, decompressed) => {
        if (err) {
          logger.error('GZIP decompression error:', err);
          reject(err);
        } else {
          logger.debug('File decompressed from GZIP');
          resolve(decompressed);
        }
      });
    } catch (error) {
      logger.error('Error in decompressGZIP:', error);
      reject(error);
    }
  });
};

/**
 * Create a ZIP archive from multiple files
 * @param {Array} files - Array of file objects { name: string, buffer: Buffer }
 * @returns {Promise<Buffer>} ZIP archive buffer
 */
exports.createZIPArchive = async (files) => {
  return new Promise((resolve, reject) => {
    try {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const buffers = [];

      archive.on('data', (chunk) => {
        buffers.push(chunk);
      });

      archive.on('end', () => {
        const zipBuffer = Buffer.concat(buffers);
        const compressionRatio = ((1 - zipBuffer.length / files.reduce((sum, f) => sum + f.buffer.length, 0)) * 100).toFixed(2);
        logger.debug(`ZIP archive created: ${compressionRatio}% reduction, size: ${zipBuffer.length} bytes`);
        resolve(zipBuffer);
      });

      archive.on('error', (err) => {
        logger.error('ZIP archive creation error:', err);
        reject(err);
      });

      // Add each file to the archive
      files.forEach((file) => {
        archive.append(file.buffer, { name: file.name });
      });

      archive.finalize();
    } catch (error) {
      logger.error('Error in createZIPArchive:', error);
      reject(error);
    }
  });
};

/**
 * Extract files from ZIP archive
 * Requires 'unzipper' package - returns array of file objects
 * @param {Buffer} zipBuffer - ZIP archive buffer
 * @returns {Promise<Array>} Array of extracted files { name: string, buffer: Buffer }
 */
exports.extractZIPArchive = async (zipBuffer) => {
  return new Promise(async (resolve, reject) => {
    try {
      const unzipper = require('unzipper');
      const Readable = require('stream').Readable;

      const readable = Readable.from(zipBuffer);
      const directory = await unzipper.Open.buffer(zipBuffer);
      const files = [];

      for (const file of directory.files) {
        if (!file.isDirectory) {
          const buffer = await file.buffer();
          files.push({
            name: file.path,
            buffer: buffer,
          });
        }
      }

      logger.debug(`ZIP archive extracted: ${files.length} files`);
      resolve(files);
    } catch (error) {
      logger.error('Error in extractZIPArchive:', error);
      reject(error);
    }
  });
};

/**
 * Calculate compression ratio
 * @param {number} originalSize - Original size in bytes
 * @param {number} compressedSize - Compressed size in bytes
 * @returns {object} { ratio: percentage, savings: bytes, formatted: string }
 */
exports.calculateCompressionRatio = (originalSize, compressedSize) => {
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2);
  const savings = originalSize - compressedSize;

  return {
    ratio: parseFloat(ratio),
    savings: savings,
    formatted: `${ratio}% (${formatBytes(savings)} saved)`,
  };
};

/**
 * Format bytes to human readable format
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
exports.formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Helper function: format bytes (also exported as standalone)
 */
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

module.exports = exports;
