// src/components/CrimeCard.js
import React from 'react';
import { faBalanceScale, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const CrimeCard = ({ stats, isCollapsed, onToggleCollapse }) => {
  if (!stats) {
    return (
      <div className="demographic-card no-data-card">
        <div className="card-header">
          <FontAwesomeIcon icon={faBalanceScale} className="topic-icon" />
          <h3>Crime</h3>
        </div>
        <div className="card-content">
          <p>No crime data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`demographic-card ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="card-header clickable" onClick={onToggleCollapse}>
        <FontAwesomeIcon icon={faBalanceScale} className="topic-icon" />
        <h3>Crime</h3>
        <FontAwesomeIcon
          icon={isCollapsed ? faChevronDown : faChevronUp}
          className="toggle-icon"
        />
      </div>

      {!isCollapsed && (
        <div className="card-content">
          <p><strong>Total Incidents:</strong> {stats.total.toLocaleString()}</p>

          <div className="chart-section">
            <h5>By Category</h5>
            <ul className="chart-list">
              {Object.entries(stats.byCategory).map(([category, count]) => (
                <li key={category} className="chart-item">
                  <div className="chart-label">{category.replace(/-/g, ' ')}</div>
                  <div className="chart-bar-container">
                    <div className="chart-bar" style={{
                      width: `${Math.min(100, count / stats.total * 100)}%`,
                      backgroundColor: "#e74c3c"
                    }}></div>
                  </div>
                  <div className="chart-percentage">{((count / stats.total) * 100).toFixed(1)}%</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="chart-section">
            <h5>By Outcome</h5>
            <ul className="chart-list">
              {Object.entries(stats.byOutcome).map(([outcome, count]) => (
                <li key={outcome} className="chart-item">
                  <div className="chart-label">{outcome}</div>
                  <div className="chart-bar-container">
                    <div className="chart-bar" style={{
                      width: `${Math.min(100, count / stats.total * 100)}%`,
                      backgroundColor: "#3498db"
                    }}></div>
                  </div>
                  <div className="chart-percentage">{((count / stats.total) * 100).toFixed(1)}%</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default CrimeCard;
