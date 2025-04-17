import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath,
  faRulerCombined,
  faClock,
  faBuilding,
  faHome,
  faMoneyBillWave,
  faChartLine,
  faExclamationTriangle,
  faSchool,
  faTrain,
  faWalking,
  faChartBar,
  faDollarSign,
  faPercentage,
  faMapMarkedAlt,
  faHistory,
  faCalendarAlt,
  faEllipsisH,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import HeatmapLayer from "./HeatmapLayer";

const PropertyDetailModal = ({
  property,
  isOpen,
  onClose,
  priceHistory = [],
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [transactionData, setTransactionData] = useState([]);

  // Sample market trend data (would be replaced with API data)
  const marketTrendData = {
    labels: ["2022", "2023", "2024", "2025", "2026"],
    data: [850000, 875000, 920000, 950000, 980000],
  };

  // Sample price history data (would be replaced with API data)
  const historicalPriceData = {
    labels: ["2019", "2020", "2021"],
    data: [600000, 650000, 700000],
  };

  // Sample future projections data (would be replaced with API data)
  const futureProjectionsData = {
    labels: ["2022", "2023", "2024"],
    data: [700000, 750000, 800000],
  };

  useEffect(() => {
    const fetchTransactionData = async () => {
      if (!property || !property.postcode) return;

      setIsLoading(true);
      try {
        // Format the postcode for the API call
        const formattedPostcode = property.postcode.replace(/\s/g, "+");
        const apiUrl = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${formattedPostcode}`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        // Extract and format transactions
        if (data && data.result && data.result.items) {
          const transactions = data.result.items.map((item) => ({
            id: item.transactionId,
            date: new Date(item.transactionDate),
            price: item.pricePaid,
            address: `${item.propertyAddress.paon} ${item.propertyAddress.street}`,
            propertyType:
              item.propertyType?.prefLabel?.[0]?._value || "Unknown",
            newBuild: item.newBuild,
          }));

          // Sort by date (newest first)
          transactions.sort((a, b) => b.date - a.date);

          setTransactionData(transactions);
        }
      } catch (error) {
        console.error("Error fetching transaction data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen && property) {
      fetchTransactionData();
    }
  }, [isOpen, property]);

  if (!isOpen || !property) return null;

  // Sample location for map (would be replaced with actual property coordinates)
  const position = [51.505, -0.09];

  // Sample heatmap data (would be replaced with real data)
  const heatmapData = {
    data: [
      [51.505, -0.09, 0.9], // Selected property (higher intensity)
      [51.504, -0.088, 0.6],
      [51.506, -0.092, 0.7],
      [51.503, -0.091, 0.5],
      [51.507, -0.093, 0.4],
      [51.508, -0.087, 0.6],
      [51.502, -0.085, 0.3],
    ],
    radius: 20,
    blur: 15,
    gradient: { 0.4: "blue", 0.6: "lime", 0.8: "yellow", 1.0: "red" },
  };

  // Generate price history for the chart
  const priceHistoryFormatted = transactionData.map((transaction) => ({
    date: transaction.date.toLocaleDateString(),
    price: transaction.price,
  }));

  // Calculate price change
  const calculatePriceChange = (data) => {
    if (!data || data.length < 2) return { value: 0, percentage: 0 };

    const oldestPrice = data[data.length - 1].price;
    const newestPrice = data[0].price;
    const change = newestPrice - oldestPrice;
    const percentage = (change / oldestPrice) * 100;

    return {
      value: change,
      percentage: percentage.toFixed(1),
    };
  };

  const priceChange = calculatePriceChange(transactionData);

  return (
    <div className="modal-overlay">
      <div className="property-detail-modal">
        <button className="close-button" onClick={onClose}>
          <FontAwesomeIcon icon={faTimes} />
        </button>

        <div className="modal-content">
          {/* Left panel: Map visualization */}
          <div className="map-panel">
            <div className="search-bar">
              <input type="text" placeholder="Search for an address" />
              <button>Search</button>
            </div>
            <MapContainer center={position} zoom={14} className="map-container">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <HeatmapLayer {...heatmapData} />
              <Marker position={position}>
                <Popup>{property.title}</Popup>
              </Marker>
            </MapContainer>
          </div>

          {/* Right panel: Investment Intelligence dashboard */}
          <div className="property-panel">
            <div className="modal-header">
              <h2>Investment Intelligence</h2>
              <button className="options-button">
                <FontAwesomeIcon icon={faEllipsisH} />
              </button>
            </div>

            {/* Market trend graph */}
            <div className="property-image-large">
              <div className="market-trend-graph">
                <h3>Market Trends (2022-2026)</h3>
                <svg width="100%" height="150" viewBox="0 0 500 150">
                  <polyline
                    fill="none"
                    stroke="#1e88e5"
                    strokeWidth="3"
                    points={marketTrendData.labels
                      .map((_, i) => {
                        const x =
                          (i / (marketTrendData.labels.length - 1)) * 480 + 10;
                        // Create a wave-like pattern
                        const normalizedValue =
                          (marketTrendData.data[i] -
                            Math.min(...marketTrendData.data)) /
                          (Math.max(...marketTrendData.data) -
                            Math.min(...marketTrendData.data));
                        const y = 140 - normalizedValue * 100;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                  />
                  {marketTrendData.labels.map((label, i) => {
                    const x =
                      (i / (marketTrendData.labels.length - 1)) * 480 + 10;
                    return (
                      <text
                        key={i}
                        x={x}
                        y="140"
                        textAnchor="middle"
                        fontSize="12"
                      >
                        {label}
                      </text>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Key metrics section */}
            <div className="property-details-container">
              <div className="detail-section">
                <h3>
                  Key Metrics <FontAwesomeIcon icon={faEllipsisH} />
                </h3>
                <div className="details-grid">
                  <div className="metric">
                    <FontAwesomeIcon icon={faHome} />
                    <div className="metric-content">
                      <span className="metric-label">Home Value</span>
                      <span className="metric-value">£1,050,000</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faChartLine} />
                    <div className="metric-content">
                      <span className="metric-label">Price Forecast</span>
                      <span className="metric-value">5.8% annual growth</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faMoneyBillWave} />
                    <div className="metric-content">
                      <span className="metric-label">Rent Forecast</span>
                      <span className="metric-value">6.2% annual growth</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <div className="metric-content">
                      <span className="metric-label">Mortgage Delinquency</span>
                      <span className="metric-value">2.3% of homes</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <div className="metric-content">
                      <span className="metric-label">Violent Crime Rate</span>
                      <span className="metric-value">1 in 1,000 residents</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <div className="metric-content">
                      <span className="metric-label">Property Crime Rate</span>
                      <span className="metric-value">1 in 100 residents</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Historical price analysis section */}
              <div className="detail-section">
                <h3>
                  5-Year Price Trends <FontAwesomeIcon icon={faEllipsisH} />
                </h3>
                <h4>Historical Prices</h4>
                <div className="price-stats">
                  <div className="price-big">
                    <span className="price-value">£600K</span>
                    <span className="price-change positive">+10%</span>
                  </div>
                  <svg width="100%" height="100" viewBox="0 0 500 100">
                    <polyline
                      fill="none"
                      stroke="#2ecc71"
                      strokeWidth="3"
                      points={historicalPriceData.labels
                        .map((_, i) => {
                          const x =
                            (i / (historicalPriceData.labels.length - 1)) *
                              480 +
                            10;
                          const normalizedValue =
                            (historicalPriceData.data[i] -
                              Math.min(...historicalPriceData.data)) /
                            (Math.max(...historicalPriceData.data) -
                              Math.min(...historicalPriceData.data));
                          const y = 90 - normalizedValue * 80;
                          return `${x},${y}`;
                        })
                        .join(" ")}
                    />
                    {historicalPriceData.labels.map((label, i) => {
                      const x =
                        (i / (historicalPriceData.labels.length - 1)) * 480 +
                        10;
                      return (
                        <text
                          key={i}
                          x={x}
                          y="100"
                          textAnchor="middle"
                          fontSize="12"
                        >
                          {label}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Future projections section */}
              <div className="detail-section">
                <h3>
                  Future Projections <FontAwesomeIcon icon={faEllipsisH} />
                </h3>
                <div className="price-stats">
                  <div className="price-big">
                    <span className="price-value">£700K</span>
                    <span className="price-change positive">+15%</span>
                  </div>
                  <svg width="100%" height="100" viewBox="0 0 500 100">
                    <polyline
                      fill="none"
                      stroke="#3498db"
                      strokeWidth="3"
                      points={futureProjectionsData.labels
                        .map((_, i) => {
                          const x =
                            (i / (futureProjectionsData.labels.length - 1)) *
                              480 +
                            10;
                          const normalizedValue =
                            (futureProjectionsData.data[i] -
                              Math.min(...futureProjectionsData.data)) /
                            (Math.max(...futureProjectionsData.data) -
                              Math.min(...futureProjectionsData.data));
                          const y = 90 - normalizedValue * 80;
                          return `${x},${y}`;
                        })
                        .join(" ")}
                    />
                    {futureProjectionsData.labels.map((label, i) => {
                      const x =
                        (i / (futureProjectionsData.labels.length - 1)) * 480 +
                        10;
                      return (
                        <text
                          key={i}
                          x={x}
                          y="100"
                          textAnchor="middle"
                          fontSize="12"
                        >
                          {label}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Property insights grid */}
              <div className="detail-section">
                <h3>
                  Property Insights <FontAwesomeIcon icon={faEllipsisH} />
                </h3>
                <div className="details-grid">
                  <div className="metric">
                    <FontAwesomeIcon icon={faChartLine} />
                    <div className="metric-content">
                      <span className="metric-label">Price Predictions</span>
                      <span className="metric-value">£500K (+5%)</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faPercentage} />
                    <div className="metric-content">
                      <span className="metric-label">Rental Yield</span>
                      <span className="metric-value">4.5% (+0.5%)</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faChartBar} />
                    <div className="metric-content">
                      <span className="metric-label">Market Liquidity</span>
                      <span className="metric-value">High (Stable)</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <div className="metric-content">
                      <span className="metric-label">Risk Score</span>
                      <span className="metric-value">Low (Improved)</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faBed} />
                    <div className="metric-content">
                      <span className="metric-label">Property Details</span>
                      <span className="metric-value">
                        {property.details.bedrooms} Beds,{" "}
                        {property.details.bathrooms} Baths,{" "}
                        {property.details.sqft} sqft
                      </span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faDollarSign} />
                    <div className="metric-content">
                      <span className="metric-label">Current Price</span>
                      <span className="metric-value">
                        {property.price.asking}
                      </span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faDollarSign} />
                    <div className="metric-content">
                      <span className="metric-label">AI Fair Value</span>
                      <span className="metric-value">
                        {property.price.estimated}
                      </span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faSchool} />
                    <div className="metric-content">
                      <span className="metric-label">Nearby Schools</span>
                      <span className="metric-value">5</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faTrain} />
                    <div className="metric-content">
                      <span className="metric-label">Transport Links</span>
                      <span className="metric-value">Excellent</span>
                    </div>
                  </div>
                  <div className="metric">
                    <FontAwesomeIcon icon={faWalking} />
                    <div className="metric-content">
                      <span className="metric-label">Virtual Tour</span>
                      <span className="metric-value">Available</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transaction history table (from Land Registry API) */}
              <div className="detail-section">
                <h3>
                  Transaction History <FontAwesomeIcon icon={faHistory} />
                </h3>
                {isLoading ? (
                  <div className="loading-overlay">
                    <div className="loading-spinner"></div>
                    <p>Loading transaction data...</p>
                  </div>
                ) : transactionData.length > 0 ? (
                  <table className="transaction-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Price</th>
                        <th>Property Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactionData.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{transaction.date.toLocaleDateString()}</td>
                          <td>£{transaction.price.toLocaleString()}</td>
                          <td>{transaction.propertyType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="no-data-message">
                    <FontAwesomeIcon icon={faExclamationTriangle} />
                    <p>No transaction data available for this property.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyDetailModal;
