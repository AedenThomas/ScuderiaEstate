// src/components/PropertyDetail.js
import React, { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  // Existing icons...
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
  faBalanceScale, // ✅ NEW Icon for Crime
  faPlusSquare, // ✅ NEW Icon for Expand
  faMinusSquare, // ✅ NEW Icon for Collapse
} from "@fortawesome/free-solid-svg-icons";

import DemographicCard from "./DemographicCard";
import CrimeCard from "./CrimeCard"; // ✅ NEW IMPORT
import ImageSlideshow from "./ImageSlideshow";
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

// --- Helper Functions (Keep existing formatters: formatPrice, formatCurrency, formatDate, formatPercentage) ---
const formatPrice = (value) => {
  /* ... keep existing ... */
};
const formatCurrency = (value) => {
  /* ... keep existing ... */
};
const formatDate = (dateStringOrDate) => {
  /* ... keep existing ... */
};
const formatPercentage = (value) => {
  /* ... keep existing ... */
};

const PropertyDetail = ({
  property,
  // Remove direct demo props, get from property
  // isLoadingLR, // Get from property if needed, but PropertyDetail doesn't use it directly now
  // isLoadingDemo, // Get from property if needed
  // Pass other necessary props
  predictionResults, // Keep if passed separately, otherwise get from property if included
  isLoadingPrediction,
  predictionError,
  onBackToListings,
}) => {
  // State for active tab
  const [activeTab, setActiveTab] = useState("overview"); // Default to overview

  // State for managing collapsed demographic AND crime cards
  const [collapsedCards, setCollapsedCards] = useState({});

  // Memoize demographics data
  const demographics = useMemo(
    () => property?.demographicData?.demographics,
    [property?.demographicData]
  );
  // Check if crime data exists
  const crimeStats = useMemo(
    () => property?.crimeStats,
    [property?.crimeStats]
  ); // ✅ Memoize crime data

  // Update collapsed topics when demographics or crime data changes
  useEffect(() => {
    const initialCollapseState = {};
    // Initialize from demographics
    if (demographics && typeof demographics === "object") {
      Object.keys(demographics).forEach((topic) => {
        initialCollapseState[topic] = true; // Default to collapsed
      });
    }
    // ✅ Initialize for Crime if data exists
    if (crimeStats) {
      initialCollapseState["Crime"] = true; // Use "Crime" as the key
    }
    setCollapsedCards(initialCollapseState);
  }, [demographics, crimeStats]); // ✅ Depend on crimeStats too

  // Memoize prediction data processing (Keep existing)
  const { processedPredictionData, predictionDomain } = useMemo(() => {
    /* ... keep existing ... */
  }, [predictionResults]);

  if (!property) return null; // Early return if no property

  // --- Destructure with defaults ---
  const {
    title = "Property Details",
    location = "N/A",
    postcode = "N/A",
    details = {},
    price = {},
    description = "",
    transactionHistory = null,
    priceGrowth = null,
    demographicData = null, // Keep demo data here
    source = "Unknown",
    detail_url = null,
    image_urls = [],
    image = "...", // Keep image data
    isAreaSummary = false, // ✅ Check if it's an area summary
    // crimeStats is accessed directly via property.crimeStats
  } = property;

  // Geo codes needed for DemographicCard
  const geoCodes = property?.demographicData?.geoCodes;
  // Fetch errors for demographics
  const demoFetchErrors = property?.demographicData?.fetchErrors || [];

  // --- Event Handlers for Collapse/Expand ---
  const handleToggleCollapse = useCallback((topicName) => {
    setCollapsedCards((prev) => ({ ...prev, [topicName]: !prev[topicName] }));
  }, []); // No dependencies needed if only using prev state

  const handleExpandAll = useCallback(() => {
    setCollapsedCards((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((topic) => (newState[topic] = false));
      return newState;
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    setCollapsedCards((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((topic) => (newState[topic] = true));
      return newState;
    });
  }, []);

  // Custom Tooltip for Prediction Chart (Keep existing)
  const PredictionTooltip = ({ active, payload, label }) => {
    /* ... keep existing ... */
  };

  // --- Render Logic ---
  return (
    <div className="property-detail">
      {/* --- Header (Keep existing) --- */}
      <div className="detail-header">
        {/* ... back button, title/location, external link ... */}
      </div>
      {/* --- Tabs (Conditionally show Demographics) --- */}
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
        {/* Only show Demographics for Area Summaries for now, or if specifically fetched for listing */}
        {(isAreaSummary || demographicData || crimeStats) && ( // Show if it's summary OR has specific demo/crime data
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
        {/* --- Overview Tab (Keep existing logic, using ImageSlideshow) --- */}
        {activeTab === "overview" && (
          <div className="property-tab-content overview-tab">
            <div className="overview-layout">
              <div className="overview-left">
                <div className="detail-image-container">
                  <ImageSlideshow
                    imageUrls={image_urls || []}
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
                    {/* ... render summary items based on 'details' and 'price' ... */}
                  </div>
                </div>
                {/* Add area summary note if applicable */}
                {isAreaSummary && (
                  <div className="detail-section area-summary-note">
                    <p>
                      This is an overview for the postcode area{" "}
                      <strong>{postcode}</strong>. Specific property details
                      (bedrooms, etc.) are not applicable. Area insights like
                      Demographics, Crime, and historical trends are available
                      in other tabs.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* --- Investment & Forecast Tab (Keep existing logic) --- */}
        {activeTab === "investment" && (
          <div className="property-tab-content investment-tab">
            {/* Historical Investment Data (Area) Section */}
            <div className="detail-section investment-history">
              <h3>
                <FontAwesomeIcon icon={faHistory} /> Historical Investment Data
                (Area)
              </h3>{" "}
              {/* ... render metrics and table based on transactionHistory and priceGrowth ... */}
            </div>
            {/* Prediction Trend Section */}
            <div className="detail-section prediction-info">
              <h3>
                <FontAwesomeIcon icon={faMagnifyingGlassChart} /> Price
                Prediction Trend
              </h3>{" "}
              {/* ... render chart and list based on prediction data ... */}
            </div>
          </div>
        )}
        {/* --- Demographics Tab (Integrate Crime Card) --- */}
        {activeTab === "demographics" &&
          (isAreaSummary || demographicData || crimeStats) && (
            <div className="property-tab-content demographics-tab">
              <div className="detail-section demographics-section">
                <div className="demographics-header">
                  <h3>
                    <FontAwesomeIcon icon={faUsersViewfinder} /> Area Insights (
                    {postcode})
                  </h3>
                  {/* Expand/Collapse Buttons */}
                  {(demographics || crimeStats) &&
                    Object.keys(collapsedCards).length > 0 && ( // Show if there's anything to collapse/expand
                      <div className="expand-collapse-controls">
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

                {/* Loading/Error states specifically for Demo - Crime is handled inside its card */}
                {property.isLoadingDemo &&
                  !demographics && ( // Show loading only if demo is loading AND not yet available
                    <div className="loading-indicator">
                      <FontAwesomeIcon icon={faSpinner} spin /> Loading
                      Demographics...
                    </div>
                  )}
                {demographicData?.error &&
                  !demographics && ( // Show error only if demo errored AND no data available
                    <p className="error-message">
                      Error loading demographics: {demographicData.error}
                    </p>
                  )}
                {!demographicData?.error &&
                  demoFetchErrors &&
                  demoFetchErrors.length > 0 && ( // Partial fetch warning
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

                {/* Cards Container */}
                <div className="demographics-cards-container">
                  {/* ✅ Render Crime Card FIRST if stats exist */}
                  {crimeStats && (
                    <CrimeCard
                      stats={crimeStats}
                      isCollapsed={collapsedCards["Crime"] ?? true} // Use "Crime" key
                      onToggleCollapse={() => handleToggleCollapse("Crime")}
                    />
                  )}
                  {!crimeStats &&
                    !property.isLoadingDemo && ( // Show if crime wasn't fetched/available
                      <div className="demographic-card no-data-card">
                        <div className="card-header">
                          <FontAwesomeIcon
                            icon={faBalanceScale}
                            className="topic-icon"
                          />
                          <h3>Crime</h3>
                        </div>
                        <div className="card-content">
                          <p>
                            Crime data not available for this location/search.
                          </p>
                        </div>
                      </div>
                    )}

                  {/* Render Demographic Cards */}
                  {demographics &&
                  geoCodes &&
                  Object.keys(demographics).length > 0 ? (
                    Object.entries(demographics)
                      .sort((a, b) => a[0].localeCompare(b[0])) // Sort topics
                      .map(([topicName, data]) => (
                        <DemographicCard
                          key={topicName}
                          topicName={topicName}
                          nomisData={data}
                          geoCodes={geoCodes}
                          isCollapsed={collapsedCards[topicName] ?? true} // Default true (collapsed)
                          onToggleCollapse={() =>
                            handleToggleCollapse(topicName)
                          }
                        />
                      ))
                  ) : !property.isLoadingDemo &&
                    !demographicData?.error &&
                    demoFetchErrors.length === 0 &&
                    !crimeStats ? (
                    // Show this only if NO demo AND NO crime data AND NO errors/loading
                    <p>
                      No specific demographic or crime data points were returned
                      for this area.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}{" "}
        {/* End Demographics Tab */}
      </div>{" "}
      {/* End detail-content */}
    </div> // End property-detail
  );
};

export default PropertyDetail;
