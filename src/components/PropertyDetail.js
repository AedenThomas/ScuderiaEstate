// src/components/PropertyDetail.js
import React, { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath,
  faRulerCombined,
  faBuilding,
  faHomeUser,
  faChartLine,
  faArrowLeft,
  faSpinner,
  faExternalLinkAlt,
  faUserGroup,
  faSterlingSign,
  faInfoCircle,
  faMoneyBillTrendUp,
  faMagnifyingGlassChart,
  faUsersViewfinder,
  faHistory,
} from "@fortawesome/free-solid-svg-icons";

import DemographicCard from "./DemographicCard";
import ImageSlideshow from "./ImageSlideshow"; // Import the new component
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// Helper to format price - ensure it handles potentially non-numeric input gracefully
const formatPrice = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "Error"
  )
    return value; // Pass through placeholders/errors
  const num = Number(String(value).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return "N/A";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

// Helper to format currency (for prediction list/tooltip) - Ensure robust
const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value));
};

// Helper to format date - ensure it handles null/invalid dates
const formatDate = (dateStringOrDate) => {
  if (!dateStringOrDate) return "N/A";
  try {
    const date = new Date(dateStringOrDate);
    if (isNaN(date.getTime())) return "Invalid Date";
    return date.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (e) {
    return "Invalid Date";
  }
};

// Format Percentage - handle strings/errors
const formatPercentage = (value) => {
  if (typeof value === "string" && value.includes("%")) return value; // Already formatted
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "Error" ||
    value === "Insufficient History"
  )
    return value;
  const num = parseFloat(value);
  if (isNaN(num)) return "N/A";
  return `${num.toFixed(1)}%`;
};

const PropertyDetail = ({
  property,
  isLoadingLR,
  isLoadingDemo,
  predictionResults,
  isLoadingPrediction,
  predictionError,
  onBackToListings,
}) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [collapsedTopics, setCollapsedTopics] = useState({});
  const demographics = useMemo(
    () => property?.demographicData?.demographics,
    [property?.demographicData?.demographics]
  );

  useEffect(() => {
    if (demographics && typeof demographics === "object") {
      const initialState = {};
      Object.keys(demographics).forEach((topic) => {
        initialState[topic] = true; // Default collapsed
      });
      setCollapsedTopics(initialState);
    } else {
      setCollapsedTopics({});
    }
  }, [demographics]);

  const { processedPredictionData, predictionDomain } = useMemo(() => {
    if (!predictionResults || predictionResults.length === 0) {
      return {
        processedPredictionData: [],
        predictionDomain: ["auto", "auto"],
      };
    }
    const prices = predictionResults.map((p) => p.predicted_price);
    if (prices.some((p) => p === null || p === undefined || isNaN(p))) {
      console.warn("Invalid price data in predictions");
      return {
        processedPredictionData: predictionResults,
        predictionDomain: ["auto", "auto"],
      }; // Use auto domain if invalid data
    }
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const buffer = (maxPrice - minPrice) * 0.05 || 5000;
    return {
      processedPredictionData: predictionResults,
      predictionDomain: [
        Math.max(0, Math.floor((minPrice - buffer) / 1000) * 1000),
        Math.ceil((maxPrice + buffer) / 1000) * 1000,
      ],
    };
  }, [predictionResults]);

  if (!property) return null;

  const {
    title = "Property Details",
    location = "N/A",
    postcode = "N/A",
    details = {},
    price = {},
    description = "",
    transactionHistory = null,
    priceGrowth = null,
    demographicData = null,
    source = "Unknown",
    detail_url = null,
    image = "https://placehold.co/600x400/cccccc/1d1d1d?text=Detail+View",
    image_urls = [],
  } = property;

  const geoCodes = property?.demographicData?.geoCodes;
  const demoFetchErrors = property?.demographicData?.fetchErrors || [];

  // Refined check for valid bathrooms
  let bathroomCountDetail = null;
  if (
    details.bathrooms &&
    details.bathrooms !== "N/A" &&
    details.bathrooms !== "-"
  ) {
    const parsed = parseInt(String(details.bathrooms).match(/\d+/)?.[0], 10);
    if (!isNaN(parsed) && parsed > 0) {
      bathroomCountDetail = parsed;
    }
  }
  const hasValidBathroomsDetail = bathroomCountDetail !== null;

  // --- Event Handlers (Keep existing) ---
  const toggleTopicCollapse = (topicName) => {
    setCollapsedTopics((prev) => ({ ...prev, [topicName]: !prev[topicName] }));
  };
  const handleExpandAll = () => {
    if (!demographics) return;
    const newState = {};
    Object.keys(demographics).forEach((topic) => (newState[topic] = false));
    setCollapsedTopics(newState);
  };
  const handleCollapseAll = () => {
    if (!demographics) return;
    const newState = {};
    Object.keys(demographics).forEach((topic) => (newState[topic] = true));
    setCollapsedTopics(newState);
  };

  // Prediction Tooltip (Keep existing)
  const PredictionTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip prediction-tooltip">
          <p className="label">{`Year: ${label}`}</p>
          <p className="intro">{`Predicted: ${formatCurrency(
            payload[0].value
          )}`}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="property-detail">
      {/* --- Header (Keep existing) --- */}
      <div className="detail-header">
        <button
          onClick={onBackToListings}
          className="back-button"
          aria-label="Back to listings"
        >
          <FontAwesomeIcon icon={faArrowLeft} /> Back
        </button>
        <div className="header-title-location">
          <h2>{title}</h2>
          <div className="detail-location">
            <FontAwesomeIcon icon={faLocationDot} />
            <span>
              {location} {postcode && `(${postcode})`}
            </span>
            {source && <span className="data-source-tag">{source}</span>}
          </div>
        </div>
        {detail_url && (
          <a
            href={detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="external-link button-like"
            title="View original listing on external site"
          >
            View Source <FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />
          </a>
        )}
      </div>
      {/* --- Tabs (Keep existing) --- */}
      <div className="detail-tabs">
        <button
          className={`tab-button ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <FontAwesomeIcon icon={faHomeUser} /> Overview
        </button>
        <button
          className={`tab-button ${activeTab === "investment" ? "active" : ""}`}
          onClick={() => setActiveTab("investment")}
        >
          <FontAwesomeIcon icon={faMoneyBillTrendUp} /> Investment & Forecast
        </button>
        <button
          className={`tab-button ${
            activeTab === "demographics" ? "active" : ""
          }`}
          onClick={() => setActiveTab("demographics")}
        >
          <FontAwesomeIcon icon={faUsersViewfinder} /> Area Demographics
        </button>
      </div>
      {/* --- Tab Content --- */}
      <div className="detail-content">
        {/* --- Overview Tab --- */}
        {activeTab === "overview" && (
          <div className="property-tab-content overview-tab">
            <div className="overview-layout">
              <div className="overview-left">
                {/* --- Replace img with ImageSlideshow --- */}
                <div className="detail-image-container">
                  {" "}
                  {/* Added container for aspect ratio */}
                  <ImageSlideshow
                    imageUrls={image_urls || [image]}
                    altText={title}
                  />
                </div>
                {description && (
                  <div className="detail-section description-section">
                    <h3>
                      <FontAwesomeIcon icon={faInfoCircle} /> Description
                    </h3>
                    <p className="detail-description">{description}</p>
                  </div>
                )}
              </div>
              <div className="overview-right">
                <div className="detail-section property-summary">
                  <h3>
                    <FontAwesomeIcon icon={faBuilding} /> Property Summary
                  </h3>
                  <div className="summary-grid">
                    {/* FIX: Use price.asking here */}
                    <div className="summary-item price-prominent">
                      <FontAwesomeIcon
                        icon={faSterlingSign}
                        className="summary-icon"
                      />
                      <span className="summary-label">Asking Price</span>
                      <span className="summary-value">
                        {formatPrice(price.asking)}
                      </span>
                    </div>
                    <div className="summary-item">
                      <FontAwesomeIcon icon={faBed} className="summary-icon" />
                      <span className="summary-label">Bedrooms</span>
                      <span className="summary-value">
                        {details.bedrooms || "-"}
                      </span>
                    </div>
                    {/* FIX: Use hasValidBathroomsDetail for conditional rendering */}
                    {hasValidBathroomsDetail && (
                      <div className="summary-item">
                        <FontAwesomeIcon
                          icon={faBath}
                          className="summary-icon"
                        />
                        <span className="summary-label">Bathrooms</span>
                        <span className="summary-value">
                          {bathroomCountDetail}
                        </span>
                      </div>
                    )}
                    {/* If no valid bathrooms, maybe show a placeholder? Optional. */}
                    {!hasValidBathroomsDetail && (
                      <div className="summary-item">
                        <FontAwesomeIcon
                          icon={faBath}
                          className="summary-icon"
                        />
                        <span className="summary-label">Bathrooms</span>
                        <span className="summary-value">-</span>
                      </div>
                    )}
                    <div className="summary-item">
                      <FontAwesomeIcon
                        icon={faRulerCombined}
                        className="summary-icon"
                      />
                      <span className="summary-label">Floor Area</span>
                      <span className="summary-value">
                        {details.sqft && details.sqft !== "N/A"
                          ? details.sqft
                          : "-"}
                      </span>
                    </div>
                    <div className="summary-item">
                      <FontAwesomeIcon
                        icon={faBuilding}
                        className="summary-icon"
                      />
                      <span className="summary-label">Property Type</span>
                      <span className="summary-value">
                        {details.propertyType || "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
                {/* ... other overview sections ... */}
              </div>
            </div>
          </div>
        )}

        {/* --- Investment & Forecast Tab (Fixes needed here) --- */}
        {activeTab === "investment" && (
          <div className="property-tab-content investment-tab">
            {/* --- Land Registry / Historical Data --- */}
            <div className="detail-section investment-history">
              <h3>
                <FontAwesomeIcon icon={faHistory} /> Historical Investment Data
                (Area)
              </h3>
              {isLoadingLR ? (
                <div className="loading-indicator">
                  <FontAwesomeIcon icon={faSpinner} spin /> Loading Historical
                  Data...
                </div>
              ) : (
                <>
                  {/* Handle specific LR error message if present */}
                  {property.priceGrowth?.error && (
                    <p className="error-message">
                      Historical Data Error: {property.priceGrowth.error}
                    </p>
                  )}
                  {/* Handle no transactions */}
                  {!property.priceGrowth?.error &&
                    transactionHistory &&
                    transactionHistory.length === 0 && (
                      <p>
                        No recent transaction history found for this postcode
                        area.
                      </p>
                    )}
                  {/* Handle general null case if no error but still no data */}
                  {!property.priceGrowth?.error &&
                    transactionHistory === null &&
                    !isLoadingLR && (
                      <p className="error-message">
                        Could not load transaction history.
                      </p>
                    )}

                  {/* Show metrics ONLY if NOT loading AND we have valid history */}
                  {!isLoadingLR &&
                    transactionHistory &&
                    transactionHistory.length > 0 && (
                      <div className="investment-metrics">
                        <div className="metric-box">
                          <span className="metric-label">
                            Est. Value (Avg. Sold)
                          </span>
                          {/* Use formatPrice */}
                          <span className="metric-value">
                            {formatPrice(price.estimated)}
                          </span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">
                            Price Growth Trend
                          </span>
                          {/* Use helper, pass original value */}
                          <span className="metric-value">
                            {priceGrowth?.growth ?? "N/A"}
                          </span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">
                            Annualized Return (Est.)
                          </span>
                          {/* Use formatPercentage */}
                          <span className="metric-value">
                            {formatPercentage(priceGrowth?.annualizedReturn)}
                          </span>
                        </div>
                      </div>
                    )}

                  {/* Show table ONLY if NOT loading AND we have valid history */}
                  {!isLoadingLR &&
                    transactionHistory &&
                    transactionHistory.length > 0 && (
                      <div className="transaction-history">
                        <h4>Recent Transactions (Area)</h4>
                        <div className="table-container">
                          <table className="transaction-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Price</th>
                                <th>Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {transactionHistory.slice(0, 10).map((t) => (
                                <tr key={t.id}>
                                  <td>{formatDate(t.date)}</td>
                                  <td className="price-cell">
                                    {formatPrice(t.price)}
                                  </td>
                                  <td>
                                    {t.propertyType}{" "}
                                    {t.isNewBuild ? "(New)" : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {transactionHistory.length > 10 && (
                          <p className="more-transactions">
                            Showing first 10 of {transactionHistory.length}{" "}
                            transactions...
                          </p>
                        )}
                      </div>
                    )}
                </>
              )}
            </div>{" "}
            {/* End investment-history */}
            {/* --- Prediction Trend Section (Fixes needed here) --- */}
            <div className="detail-section prediction-info">
              <h3>
                <FontAwesomeIcon icon={faMagnifyingGlassChart} /> Price
                Prediction Trend
              </h3>
              {isLoadingPrediction ? (
                <div className="loading-indicator">
                  <FontAwesomeIcon icon={faSpinner} spin /> Loading
                  Predictions...
                </div>
              ) : predictionError ? (
                <p className="error-message">
                  Prediction Error: {predictionError}
                </p>
              ) : processedPredictionData &&
                processedPredictionData.length > 0 ? (
                <div className="prediction-chart-container">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={processedPredictionData}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                      {/* Ensure dataKey matches the structure */}
                      <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(value) =>
                          formatCurrency(value).replace(/£|,/g, "") + "k"
                        } // Simpler k format
                        domain={predictionDomain}
                        allowDataOverflow={true}
                        tick={{ fontSize: 12 }}
                        width={70} // Increased width for labels like £1,000k
                      />
                      <Tooltip
                        content={<PredictionTooltip />}
                        cursor={{ stroke: "#8884d8", strokeWidth: 1 }}
                      />
                      <Legend wrapperStyle={{ fontSize: "13px" }} />
                      {/* Ensure dataKey is correct */}
                      <Line
                        type="monotone"
                        dataKey="predicted_price"
                        name="Predicted Price"
                        stroke="#82ca9d"
                        strokeWidth={2}
                        activeDot={{ r: 6 }}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  {/* FIX: Use formatCurrency in the list */}
                  <ul className="prediction-list">
                    {processedPredictionData.map((result) => (
                      <li key={result.year}>
                        <strong>{result.year}:</strong>{" "}
                        {formatCurrency(result.predicted_price)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>No prediction data available.</p>
              )}
            </div>{" "}
            {/* End prediction-info */}
          </div> // End investment-tab
        )}

        {/* --- Demographics Tab (Add container and controls) --- */}
        {activeTab === "demographics" && (
          <div className="property-tab-content demographics-tab">
            <div className="detail-section demographics-section">
              <div className="demographics-header">
                <h3>
                  <FontAwesomeIcon icon={faUserGroup} /> Area Demographics
                </h3>
                {demographics && Object.keys(demographics).length > 0 && (
                  <div className="expand-collapse-controls">
                    <button onClick={handleExpandAll}>Expand All</button>
                    <button onClick={handleCollapseAll}>Collapse All</button>
                  </div>
                )}
              </div>

              {isLoadingDemo ? (
                <div className="loading-indicator">
                  <FontAwesomeIcon icon={faSpinner} spin /> Loading
                  Demographics...
                </div>
              ) : (
                <>
                  {demographicData?.error && (
                    <p className="error-message">
                      Error loading demographics: {demographicData.error}
                    </p>
                  )}
                  {!demographicData?.error &&
                    demoFetchErrors &&
                    demoFetchErrors.length > 0 && (
                      <div className="warning-message">
                        <p>Note: Some demographic topics failed to load:</p>
                        <ul>
                          {demoFetchErrors.map((err, i) => (
                            <li key={i}>
                              <small>{err}</small>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {/* ADDED: Container for cards */}
                  <div className="demographics-cards-container">
                    {
                      demographics &&
                      geoCodes &&
                      Object.keys(demographics).length > 0 ? (
                        Object.entries(demographics)
                          .sort((a, b) => a[0].localeCompare(b[0]))
                          .map(([topicName, data]) => (
                            <DemographicCard
                              key={topicName}
                              topicName={topicName}
                              nomisData={data}
                              geoCodes={geoCodes}
                              isCollapsed={collapsedTopics[topicName] !== false}
                              onToggleCollapse={() =>
                                toggleTopicCollapse(topicName)
                              }
                            />
                          ))
                      ) : !isLoadingDemo &&
                        !demographicData?.error &&
                        demoFetchErrors.length === 0 ? (
                        <p>
                          No specific demographic data points were returned for
                          this area.
                        </p>
                      ) : null /* Handles cases where there might be an error but also no data */
                    }
                  </div>
                  {!demographicData &&
                    !isLoadingDemo &&
                    !demographicData?.error && (
                      <p className="error-message">
                        Could not load demographic data.
                      </p>
                    )}
                </>
              )}
            </div>
          </div>
        )}
      </div>{" "}
      {/* End detail-content */}
    </div> // End property-detail
  );
};

export default PropertyDetail;
