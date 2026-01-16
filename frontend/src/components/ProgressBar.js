/**
 * Progress Bar Component
 * Shows upload progress with metrics
 */

import React from 'react';
import './ProgressBar.css';

const ProgressBar = ({ progress, metrics }) => {
  const { speed, eta, uploadedSize, totalSize } = metrics;
  
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };
  
  const formatTime = (seconds) => {
    if (!seconds || seconds === Infinity) return '--:--';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };
  
  return (
    <div className="progress-container">
      <div className="progress-header">
        <span className="progress-percentage">{progress}%</span>
        <span className="progress-size">{formatBytes(uploadedSize)} / {formatBytes(totalSize)}</span>
      </div>
      
      <div className="progress-bar-wrapper">
        <div 
          className="progress-bar-fill"
          style={{ width: `${progress}%` }}
        >
          <div className="progress-bar-shine"></div>
        </div>
      </div>
      
      <div className="progress-metrics">
        <div className="metric">
          <span className="metric-label">Speed:</span>
          <span className="metric-value">{speed.toFixed(2)} MB/s</span>
        </div>
        <div className="metric">
          <span className="metric-label">ETA:</span>
          <span className="metric-value">{formatTime(eta)}</span>
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
