// src/components/PropertyDetail.js
import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  faBalanceScale,
  faPlusSquare,
  faMinusSquare,
} from "@fortawesome/free-solid-svg-icons";

// Import child components
import DemographicCard from "./DemographicCard";
import CrimeCard from "./CrimeCard";
import ImageSlideshow from "./ImageSlideshow"; // Ensure this path is correct
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

// --- Helper Functions ---
const formatPrice = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "Error"
  )
    return value;
  const num = Number(String(value).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return "N/A";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};
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
const formatPercentage = (value) => {
  if (
    typeof value === "string" &&
    (value.includes("%") ||
      value === "N/A" ||
      value === "Error" ||
      value === "Insufficient History")
  )
    return value; // Pass through formatted or placeholders
  if (value === null || value === undefined) return "N/A";
  const num = parseFloat(value);
  if (isNaN(num)) return "N/A";
  return `${num.toFixed(1)}%`;
};
// Custom Tooltip for Prediction Chart
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

// ========== Main Component ==========
const PropertyDetail = ({
  property, // Single prop containing all data
  onBackToListings,
}) => {
  // ========== HOOKS (Called First & Unconditionally) ==========
  const [activeTab, setActiveTab] = useState("overview");
  const [collapsedCards, setCollapsedCards] = useState({});
  const demographics = useMemo(
    () => property?.demographicData?.demographics,
    [property?.demographicData]
  );
  const crimeStats = useMemo(
    () => property?.crimeStats,
    [property?.crimeStats]
  );

  const handleToggleCollapse = useCallback((topicName) => {
    setCollapsedCards((prev) => ({ ...prev, [topicName]: !prev[topicName] }));
  }, []);
  const handleExpandAll = useCallback(() => {
    setCollapsedCards((prev) => {
      const n = { ...prev };
      Object.keys(n).forEach((k) => (n[k] = false));
      return n;
    });
  }, []);
  const handleCollapseAll = useCallback(() => {
    setCollapsedCards((prev) => {
      const n = { ...prev };
      Object.keys(n).forEach((k) => (n[k] = true));
      return n;
    });
  }, []);

  const { processedPredictionData, predictionDomain } = useMemo(() => {
    const predictionResults = property?.predictionResults;
    if (!predictionResults || predictionResults.length === 0)
      return {
        processedPredictionData: [],
        predictionDomain: ["auto", "auto"],
      }; // Use correct keys
    const prices = predictionResults.map((p) => p.predicted_price);
    if (prices.some((p) => p == null || isNaN(p)))
      return {
        processedPredictionData: predictionResults,
        predictionDomain: ["auto", "auto"],
      };
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const buffer = (maxP - minP) * 0.05 || 5000;
    return {
      processedPredictionData: predictionResults,
      predictionDomain: [
        Math.max(0, Math.floor((minP - buffer) / 1000) * 1000),
        Math.ceil((maxP + buffer) / 1000) * 1000,
      ],
    };
  }, [property?.predictionResults]);

  // Effect to initialize collapse state
  useEffect(() => {
    console.log("Effect to initialize collapse state running..."); // Debug log
    const initialCollapseState = {};
    if (demographics && typeof demographics === "object") {
      Object.keys(demographics).forEach((topic) => {
        initialCollapseState[topic] = true;
      });
    }
    if (crimeStats) {
      initialCollapseState["Crime"] = true;
    }
    // Update state ONLY if the calculated initial state has keys
    // and it's different from the current keys (prevents unnecessary updates if data disappears)
    const currentKeys = Object.keys(collapsedCards).sort().join(",");
    const initialKeys = Object.keys(initialCollapseState).sort().join(",");

    // Update only if the set of topics has actually changed or it's the very first load
    if (
      Object.keys(initialCollapseState).length > 0 &&
      initialKeys !== currentKeys
    ) {
      console.log("Setting initial collapsed state:", initialCollapseState); // Debug log
      setCollapsedCards(initialCollapseState);
    } else if (
      Object.keys(initialCollapseState).length === 0 &&
      currentKeys !== ""
    ) {
      console.log("Resetting collapsed state as data disappeared"); // Debug log
      setCollapsedCards({}); // Reset if data disappears
    }

    // ***** CORRECTED DEPENDENCY ARRAY *****
  }, [demographics, crimeStats]); // Add collapsedCards to dependency to prevent potential stale state issues

  // ========== Early Return Check ==========
  if (!property) return null;

  // ========== Destructuring & Variables ==========
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
    image_urls = [],
    image = "...",
    isAreaSummary = false,
    isLoadingLR = false,
    isLoadingDemo = false,
    isLoadingPrediction = false,
    predictionError = null,
  } = property;

  const geoCodes = property?.demographicData?.geoCodes;
  const demoFetchErrors = property?.demographicData?.fetchErrors || [];

  // ========== Render Logic ==========
  return (
    <div className="property-detail">
      {/* --- Header --- */}
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
        {detail_url && !isAreaSummary && (
          <a
            href={detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="external-link button-like"
            title="View original listing"
          >
            {" "}
            View Source <FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />
          </a>
        )}
      </div>

      {/* --- Tabs --- */}
      <div className="detail-tabs">
        <button
          className={`tab-button ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <FontAwesomeIcon icon={faHomeUser} /> Overview
        </button>
        {(!isAreaSummary ||
          (isAreaSummary && priceGrowth && priceGrowth.growth !== "N/A")) && (
          <button
            className={`tab-button ${
              activeTab === "investment" ? "active" : ""
            }`}
            onClick={() => setActiveTab("investment")}
          >
            <FontAwesomeIcon icon={faMoneyBillTrendUp} /> Investment & Forecast
          </button>
        )}
        {(isAreaSummary || demographicData || crimeStats) && (
          <button
            className={`tab-button ${
              activeTab === "demographics" ? "active" : ""
            }`}
            onClick={() => setActiveTab("demographics")}
          >
            <FontAwesomeIcon icon={faUsersViewfinder} /> Area Insights
          </button>
        )}
      </div>

      {/* --- Tab Content --- */}
      <div className="detail-content">
        {/* --- Overview Tab --- */}
        {activeTab === "overview" && (
          <div className="property-tab-content overview-tab">
            <div className="overview-layout">
              <div className="overview-left">
                <div className="detail-image-container">
                  {" "}
                  <ImageSlideshow
                    imageUrls={image_urls || []}
                    altText={title}
                  />{" "}
                </div>
                {description && !isAreaSummary && (
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
                    <FontAwesomeIcon icon={faBuilding} />{" "}
                    {isAreaSummary ? "Area Summary" : "Property Summary"}
                  </h3>
                  <div className="summary-grid">
                    {!isAreaSummary && (
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
                    )}
                    <div className="summary-item">
                      <FontAwesomeIcon
                        icon={faSterlingSign}
                        className="summary-icon"
                      />
                      <span className="summary-label">
                        {isAreaSummary
                          ? "Avg. Sold Price (Area)"
                          : "Est. Value (Area Avg)"}
                      </span>
                      <span className="summary-value">
                        {formatPrice(price.estimated)}
                      </span>
                    </div>
                    {!isAreaSummary && (
                      <div className="summary-item">
                        <FontAwesomeIcon
                          icon={faBed}
                          className="summary-icon"
                        />
                        <span className="summary-label">Bedrooms</span>
                        <span className="summary-value">
                          {details.bedrooms || "-"}
                        </span>
                      </div>
                    )}
                    {!isAreaSummary && (
                      <div className="summary-item">
                        <FontAwesomeIcon
                          icon={faBath}
                          className="summary-icon"
                        />
                        <span className="summary-label">Bathrooms</span>
                        <span className="summary-value">
                          {details.bathrooms && details.bathrooms !== "N/A"
                            ? details.bathrooms
                            : "-"}
                        </span>
                      </div>
                    )}
                    {!isAreaSummary && (
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
                    )}
                    {!isAreaSummary && (
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
                    )}
                  </div>
                </div>
                {isAreaSummary && (
                  <div className="detail-section area-summary-note">
                    <p>
                      Area overview for <strong>{postcode}</strong>. See other
                      tabs for insights.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- Investment & Forecast Tab --- */}
        {activeTab === "investment" &&
          (!isAreaSummary ||
            (isAreaSummary && priceGrowth && priceGrowth.growth !== "N/A")) && (
            <div className="property-tab-content investment-tab">
              <div className="detail-section investment-history">
                <h3>
                  <FontAwesomeIcon icon={faHistory} /> Historical Investment
                  Data (Area)
                </h3>
                {isLoadingLR ? (
                  <div className="loading-indicator">
                    <FontAwesomeIcon icon={faSpinner} spin /> Loading Area
                    History...
                  </div>
                ) : (
                  <>
                    {priceGrowth?.error && (
                      <p className="error-message">
                        History Error: {priceGrowth.error}
                      </p>
                    )}
                    {!priceGrowth?.error &&
                      transactionHistory?.length === 0 && (
                        <p>
                          No recent transaction history found for this area.
                        </p>
                      )}
                    {!priceGrowth?.error &&
                      transactionHistory === null &&
                      !isLoadingLR && (
                        <p className="error-message">
                          Could not load transaction history for this area.
                        </p>
                      )}
                    {transactionHistory?.length > 0 && !priceGrowth?.error && (
                      <div className="investment-metrics">
                        <div className="metric-box">
                          <span className="metric-label">
                            Est. Value (Area Avg)
                          </span>
                          <span className="metric-value">
                            {formatPrice(price.estimated)}
                          </span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">
                            Price Growth Trend
                          </span>
                          <span className="metric-value">
                            {priceGrowth?.growth ?? "N/A"}
                          </span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">
                            Annualized Return (Est.)
                          </span>
                          <span className="metric-value">
                            {formatPercentage(priceGrowth?.annualizedReturn)}
                          </span>
                        </div>
                      </div>
                    )}
                    {transactionHistory?.length > 0 && !priceGrowth?.error && (
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
                            Showing 10 of {transactionHistory.length}...
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Prediction Trend (Show only for specific listings) */}
              {!isAreaSummary && (
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
                  ) : // Use processedPredictionData from useMemo hook
                  processedPredictionData?.length > 0 ? (
                    <div className="prediction-chart-container">
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart
                          data={processedPredictionData}
                          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#e0e0e0"
                          />
                          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                          <YAxis
                            tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                            domain={predictionDomain}
                            allowDataOverflow={true}
                            tick={{ fontSize: 12 }}
                            width={70}
                          />
                          <Tooltip
                            content={<PredictionTooltip />}
                            cursor={{ stroke: "#8884d8", strokeWidth: 1 }}
                          />
                          <Legend wrapperStyle={{ fontSize: "13px" }} />
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
                      <ul className="prediction-list">
                        {processedPredictionData.map((r) => (
                          <li key={r.year}>
                            <strong>{r.year}:</strong>{" "}
                            {formatCurrency(r.predicted_price)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p>No prediction data available for this property.</p>
                  )}
                </div>
              )}
            </div>
          )}

        {/* --- Demographics Tab --- */}
        {activeTab === "demographics" &&
          (isAreaSummary || demographicData || crimeStats) && (
            <div className="property-tab-content demographics-tab">
              {" "}
              {/* <<< Ensure these classes exist */}
              <div className="detail-section demographics-section">
                {" "}
                {/* <<< Ensure these classes exist */}
                <div className="demographics-header">
                  {" "}
                  {/* <<< Ensure this class exists */}
                  <h3>
                    <FontAwesomeIcon icon={faUsersViewfinder} /> Area Insights (
                    {postcode})
                  </h3>
                  {(demographics || crimeStats) &&
                    Object.keys(collapsedCards).length > 0 && (
                      <div className="expand-collapse-controls">
                        {" "}
                        {/* <<< Ensure this class exists */}
                        <button onClick={handleExpandAll} title="Expand All">
                          <FontAwesomeIcon icon={faPlusSquare} /> Expand All
                        </button>
                        <button
                          onClick={handleCollapseAll}
                          title="Collapse All"
                        >
                          <FontAwesomeIcon icon={faMinusSquare} /> Collapse All
                        </button>
                      </div>
                    )}
                </div>
                {isLoadingDemo && !demographics && !crimeStats && (
                  <div className="loading-indicator">
                    <FontAwesomeIcon icon={faSpinner} spin /> Loading Area
                    Insights...
                  </div>
                )}
                {demographicData?.error && !demographics && (
                  <p className="error-message">
                    Error loading demographics: {demographicData.error}
                  </p>
                )}
                {!demographicData?.error && demoFetchErrors?.length > 0 && (
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
                <div className="demographics-cards-container">
                  {crimeStats && (
                    <CrimeCard
                      stats={crimeStats}
                      isCollapsed={collapsedCards["Crime"] ?? true}
                      onToggleCollapse={() => handleToggleCollapse("Crime")}
                    />
                  )}
                  {!crimeStats && !isLoadingDemo && !demographicData?.error && (
                    <div className="demographic-card no-data-card">
                      <div className="card-header">
                        <FontAwesomeIcon
                          icon={faBalanceScale}
                          className="topic-icon"
                        />
                        <h3>Crime</h3>
                      </div>
                      <div className="card-content">
                        <p>Crime data not available.</p>
                      </div>
                    </div>
                  )}
                  {demographics &&
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
                          isCollapsed={collapsedCards[topicName] ?? true}
                          onToggleCollapse={() =>
                            handleToggleCollapse(topicName)
                          }
                        />
                      ))
                  ) : !isLoadingDemo &&
                    !demographicData?.error &&
                    demoFetchErrors.length === 0 &&
                    !crimeStats ? (
                    <p>No specific demographic data points were returned.</p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  );
};

export default PropertyDetail;
