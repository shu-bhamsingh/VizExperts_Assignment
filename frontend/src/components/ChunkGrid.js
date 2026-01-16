/**
 * Chunk Status Grid Component
 * Visual representation of chunk upload states
 */

import React from 'react';
import './ChunkGrid.css';

const ChunkGrid = ({ chunks }) => {
  const getChunkColor = (status) => {
    switch (status) {
      case 'pending': return '#e0e0e0';
      case 'uploading': return '#2196f3';
      case 'success': return '#4caf50';
      case 'error': return '#f44336';
      default: return '#e0e0e0';
    }
  };
  
  const getChunkIcon = (status) => {
    switch (status) {
      case 'pending': return '⏸';
      case 'uploading': return '⬆';
      case 'success': return '✓';
      case 'error': return '✗';
      default: return '?';
    }
  };
  
  return (
    <div className="chunk-grid">
      <div className="chunk-grid-header">
        <h3>Chunk Status ({chunks.filter(s => s === 'success').length}/{chunks.length})</h3>
      </div>
      <div className="chunk-grid-container">
        {chunks.map((status, index) => (
          <div
            key={index}
            className="chunk-cell"
            style={{ backgroundColor: getChunkColor(status) }}
            title={`Chunk ${index}: ${status}`}
          >
            <span className="chunk-icon">{getChunkIcon(status)}</span>
            <span className="chunk-number">{index}</span>
          </div>
        ))}
      </div>
      <div className="chunk-legend">
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#e0e0e0' }}></div>
          <span>Pending</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#2196f3' }}></div>
          <span>Uploading</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#4caf50' }}></div>
          <span>Success</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#f44336' }}></div>
          <span>Error</span>
        </div>
      </div>
    </div>
  );
};

export default ChunkGrid;
