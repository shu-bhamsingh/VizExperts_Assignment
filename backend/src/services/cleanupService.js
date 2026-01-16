const db = require('../config/database');
const fileUtils = require('../utils/fileUtils');

const CLEANUP_INTERVAL = parseInt(process.env.CLEANUP_INTERVAL) || 3600000;
const ABANDONED_TIMEOUT = parseInt(process.env.ABANDONED_UPLOAD_TIMEOUT) || 86400000;

async function cleanupAbandonedUploads() {
  try {
    console.log('Running cleanup service...');
    
    // Convert milliseconds to hours for MySQL compatibility
    const timeoutHours = Math.floor(ABANDONED_TIMEOUT / 3600000);
    
    // Find abandoned uploads
    const [abandonedUploads] = await db.query(
      `SELECT id, file_path, filename FROM uploads
       WHERE status = 'UPLOADING'
       AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [timeoutHours]
    );
    
    if (abandonedUploads.length === 0) {
      console.log('No abandoned uploads found');
      return;
    }
    
    console.log(`Found ${abandonedUploads.length} abandoned uploads`);
    
    for (const upload of abandonedUploads) {
      try {
        // Delete file
        await fileUtils.safeDeleteFile(upload.file_path);
        
        // Mark as FAILED in database
        await db.query(
          `UPDATE uploads SET status = 'FAILED' WHERE id = ?`,
          [upload.id]
        );
        
        console.log(`✅ Cleaned up abandoned upload: ${upload.filename}`);
      } catch (error) {
        console.error(`❌ Failed to cleanup ${upload.id}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Cleanup service failed:', error);
  }
}

/**
 * Start cleanup service with periodic execution
 */
function startCleanupService() {
  console.log(`🧹 Cleanup service started (interval: ${CLEANUP_INTERVAL}ms)`);
  
  // Run immediately on startup
  cleanupAbandonedUploads();
  
  // Schedule periodic cleanup
  setInterval(cleanupAbandonedUploads, CLEANUP_INTERVAL);
}

module.exports = {
  startCleanupService,
  cleanupAbandonedUploads
};
