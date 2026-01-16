const crypto = require('crypto');

/**
 * Calculate SHA-256 hash of a chunk (in-memory)
 * @param {Buffer} chunkBuffer - The chunk data as a buffer
 * @returns {string} - Hex hash
 */
function calculateChunkHash(chunkBuffer) {
  return crypto.createHash('sha256').update(chunkBuffer).digest('hex');
}

/**
 * Verify chunk integrity by comparing hashes
 * @param {Buffer} chunkBuffer - The chunk data
 * @param {string} expectedHash - Expected SHA-256 hash
 * @returns {boolean} - True if hashes match
 */
function verifyChunkHash(chunkBuffer, expectedHash) {
  const actualHash = calculateChunkHash(chunkBuffer);
  return actualHash === expectedHash;
}

module.exports = {
  calculateChunkHash,
  verifyChunkHash
};
