import React from 'react';
import './ChunkGrid.css';

const ChunkGrid = ({ chunks }) => {
  const statsCount = {
    success: chunks.filter(s => s === 'success').length,
    uploading: chunks.filter(s => s === 'uploading').length,
    error: chunks.filter(s => s === 'error').length,
    pending: chunks.filter(s => s === 'pending').length
  };
  
  return (
    <div className="chunk-grid-container">
      <div className="chunk-grid-header">
        <h3 className="chunk-grid-title">
          Chunk Status ({statsCount.success}/{chunks.length})
        </h3>
        <div className="chunk-stats">
          <div className="stat-item stat-success">
            ✓ {statsCount.success}
          </div>
          <div className="stat-item stat-uploading">
            ↻ {statsCount.uploading}
          </div>
          <div className="stat-item stat-error">
            ✗ {statsCount.error}
          </div>
          <div className="stat-item stat-pending">
            ○ {statsCount.pending}
          </div>
        </div>
      </div>
      
      <div className="chunk-grid">
        {chunks.map((status, index) => (
          <div
            key={index}
            className={`chunk chunk-${status}`}
            title={`Chunk ${index}: ${status}`}
          />
        ))}
      </div>
    </div>
  );
};

export default ChunkGrid;
