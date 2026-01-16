const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

async function ensureDirectory(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function preallocateFile(filePath, size) {
  const fd = await fs.open(filePath, 'w');
  try {
    // Truncate creates sparse file on most systems
    await fd.truncate(size);
  } finally {
    await fd.close();
  }
}

function writeChunkAtOffset(filePath, offset, dataStream) {
  return new Promise((resolve, reject) => {
    // Open file with 'r+' to write at offset without truncating
    const writeStream = fsSync.createWriteStream(filePath, {
      flags: 'r+',
      start: offset,
      autoClose: true
    });
    
    let bytesWritten = 0;
    
    dataStream.on('data', (chunk) => {
      bytesWritten += chunk.length;
    });
    
    dataStream.on('error', (error) => {
      writeStream.destroy();
      reject(error);
    });
    
    writeStream.on('error', (error) => {
      reject(error);
    });
    
    writeStream.on('finish', () => {
      resolve(bytesWritten);
    });
    
    // Pipe data to file
    dataStream.pipe(writeStream);
  });
}

/**
 * Delete file safely (ignore if not exists)
 * @param {string} filePath - File to delete
 */
async function safeDeleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Get file size
 * @param {string} filePath - File path
 * @returns {Promise<number>} - File size in bytes
 */
async function getFileSize(filePath) {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * Check if file exists
 * @param {string} filePath - File path
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ensureDirectory,
  preallocateFile,
  writeChunkAtOffset,
  safeDeleteFile,
  getFileSize,
  fileExists
};
