const yauzl = require('yauzl');

function listZipContents(zipPath) {
  return new Promise((resolve, reject) => {
    const files = [];
    
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) {
        return reject(err);
      }
      
      zipfile.on('entry', (entry) => {

        const isDirectory = /\/$/.test(entry.fileName);
        
        files.push({
          name: entry.fileName,
          size: entry.uncompressedSize,
          compressed: entry.compressedSize,
          isDirectory,
          lastModified: entry.getLastModDate()
        });
        
        zipfile.readEntry();
      });
      
      zipfile.on('end', () => {
        resolve(files);
      });
      
      zipfile.on('error', (err) => {
        reject(err);
      });
      
      zipfile.readEntry();
    });
  });
}

/**
 * Validate if file is a valid ZIP
 * @param {string} zipPath - Path to ZIP file
 * @returns {Promise<boolean>}
 */
function isValidZip(zipPath) {
  return new Promise((resolve) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) {
        resolve(false);
      } else {
        zipfile.close();
        resolve(true);
      }
    });
  });
}

module.exports = {
  listZipContents,
  isValidZip
};
