import { calculatePriceGrowth } from "../services/landRegistryService";
import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import CrimeCard from "./CrimeCard";
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
  faPlusSquare,
  faMinusSquare,
  faChevronDown,
  faChartBar,
  faDollarSign,
  faPercentage,
  faHistory,
  faArrowLeft,
  faEllipsisH,
  faQuestionCircle,
  faCar,
  faChartArea,
  faSterlingSign, // Use sterling
} from "@fortawesome/free-solid-svg-icons";

import {
  faUsers, // Icon for Demographics
  faSpinner, // Loading icon
  faExclamationCircle, // Error icon
} from "@fortawesome/free-solid-svg-icons";
import DemographicCard from "./DemographicCard";

// --- Helper Functions ---
const DemographicTopic = ({ topicName, nomisData, geoCodes }) => {
  // nomisData is the object like { format, version, result: { _about, ..., obs: [...] } }
  // or { error: '...', obs: [] } if fetch failed for this topic

  if (
    !nomisData ||
    nomisData.error ||
    !nomisData.obs ||
    nomisData.obs.length === 0
  ) {
    // Optionally display the specific error: {nomisData?.error || 'No data available'}
    return (
      <div className="demographic-topic no-data">
        <h4>{topicName}</h4>
        <p>No data available for LSOA/LAD.</p>
      </div>
    );
  }

  // Find the dimension code key (e.g., 'c_sex', 'c2021_age_12a') dynamically
  // It's usually the key in the 'obs' object that isn't 'dataset', 'geography', 'measures', etc.
  const dimensionKey = Object.keys(nomisData.obs[0] || {}).find(
    (key) =>
      key !== "dataset" &&
      key !== "geography" &&
      key !== "measures" &&
      key !== "freq" &&
      key !== "time_format" &&
      key !== "unit" &&
      key !== "time" &&
      key !== "obs_value" &&
      key !== "obs_status" &&
      key !== "obs_conf" &&
      key !== "obs_round" &&
      key !== "urn"
  );

  if (!dimensionKey) {
    console.warn(`Could not determine dimension key for topic: ${topicName}`);
    return (
      <div className="demographic-topic error">
        <h4>{topicName}</h4>
        <p>Could not parse data structure.</p>
      </div>
    );
  }

  // Group observations by geography (LSOA vs LAD)
  const lsoaData = nomisData.obs.filter(
    (obs) => obs.geography?.geogcode === geoCodes?.lsoa_gss
  );
  const ladData = nomisData.obs.filter(
    (obs) => obs.geography?.geogcode === geoCodes?.lad_gss
  );

  // Function to render data for a specific geography level
  const renderGeographyData = (data, levelName) => {
    if (!data || data.length === 0) return null;
    // Find the "Total" observation to calculate percentages (if needed)
    const totalObs = data.find(
      (obs) =>
        obs[dimensionKey]?.value === 0 ||
        obs[dimensionKey]?.description?.toLowerCase().includes("total")
    );
    const totalValue = totalObs?.obs_value?.value;

    return (
      <div className="demographic-level">
        <h5>
          {levelName} ({data[0]?.geography?.description || "N/A"})
        </h5>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Value</th>
              {totalValue > 0 && <th>%</th>}
            </tr>
          </thead>
          <tbody>
            {data
              .filter(
                (obs) =>
                  obs[dimensionKey]?.value !== 0 &&
                  !obs[dimensionKey]?.description
                    ?.toLowerCase()
                    .includes("total")
              ) // Exclude total row from table body
              .map((obs, index) => (
                <tr
                  key={`${obs.geography?.geogcode}-${obs[dimensionKey]?.value}-${index}`}
                >
                  <td>{obs[dimensionKey]?.description || "N/A"}</td>
                  <td>{obs.obs_value?.value?.toLocaleString() ?? "N/A"}</td>
                  {totalValue > 0 && (
                    <td>
                      {obs.obs_value?.value !== undefined
                        ? `${((obs.obs_value.value / totalValue) * 100).toFixed(
                            1
                          )}%`
                        : "N/A"}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="demographic-topic">
      <h4>{topicName}</h4>
      {renderGeographyData(lsoaData, "LSOA Level")}
      {renderGeographyData(ladData, "Local Authority Level")}
    </div>
  );
};

// Formats numbers as currency (adds £, commas) or returns "No result"
const formatPrice = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "No result"
  ) {
    return "No result";
  }
  // Check if it's already formatted
  if (typeof value === "string" && value.startsWith("£")) {
    return value;
  }
  // Try to parse as number
  const num = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
  if (!isNaN(num)) {
    return `£${num.toLocaleString("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`; // Use GB locale for formatting
  }
  // If it's a string that couldn't be parsed but isn't 'N/A', return it as is (less likely)
  if (typeof value === "string") return value;
  return "No result";
};

// Formats percentages or returns "No result"
const formatPercentage = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "No result" ||
    value === "Not enough data" ||
    value === "Calculation error"
  ) {
    return "No result";
  }
  // Check if it already has %
  if (typeof value === "string" && value.includes("%")) {
    // Clean up potential double percentage signs or extra text
    const match = value.match(/([+-]?\d+(\.\d+)?%)/);
    return match ? match[0] : value; // Return matched percentage or original string
  }
  // Assume it's a number needing formatting
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return `${num.toFixed(1)}%`;
  }
  // If it's a string like 'p.a.' or similar, return it
  if (typeof value === "string") return value;
  return "No result";
};

// Component to display a metric with "No result" state
const NoResultDisplay = ({ label, icon }) => (
  <div className="metric">
    {icon && <FontAwesomeIcon icon={icon} />}
    <div className="metric-content">
      <span className="metric-label">{label}</span>
      <span className="metric-value no-result">No result</span>
    </div>
  </div>
);

// --- Main Component ---

const PropertyDetail = ({
  property,
  demographicData,
  isFetchingDemographics,
  demographicsError,
  onBackToListings,
}) => {
  const [activeTab, setActiveTab] = useState("overview");
  // Initialize with all cards collapsed by default
  const [collapsedCards, setCollapsedCards] = useState({});

  // Check if demographic data is present and has the expected structure
  const hasDemographicData =
    demographicData?.demographics &&
    Object.keys(demographicData.demographics).length > 0;

  useEffect(() => {
    if (hasDemographicData) {
      const initialCollapseState = {};
      Object.keys(demographicData.demographics).forEach((topic) => {
        initialCollapseState[topic] = true; // Start all collapsed
      });
      setCollapsedCards(initialCollapseState);
    } else {
      setCollapsedCards({}); // Reset if no data
    }
  }, [demographicData]); // Re-run when demographicData changes

  if (!property) return null;

  // --- Data Preparation ---
  // Use transaction data from property if available (for search results)
  const currentTransactionData = property.transactionHistory || [];
  const priceGrowthInfo = property.priceGrowth || {}; // Use pre-calculated from App.js with fallback
  const isSpecificListing =
    property.details && property.details.bedrooms !== "N/A";

  const details = property.details || {};
  const price = property.price || {};
  const amenities = property.amenities || [];
  const transport = property.transport || [];
  const schools = property.schools || [];

  // --- NEW Handler Functions ---
  const handleToggleCollapse = (topicName) => {
    setCollapsedCards((prevState) => ({
      ...prevState,
      [topicName]: !prevState[topicName], // Toggle the specific topic
    }));
  };

  const handleExpandAll = () => {
    const allExpanded = {};
    Object.keys(collapsedCards).forEach((topic) => {
      allExpanded[topic] = false; // Set all to not collapsed
    });
    setCollapsedCards(allExpanded);
  };

  const handleCollapseAll = () => {
    const allCollapsed = {};
    Object.keys(collapsedCards).forEach((topic) => {
      allCollapsed[topic] = true; // Set all to collapsed
    });
    setCollapsedCards(allCollapsed);
  };

  const hasTransactionData =
    property.transactionHistory && property.transactionHistory.length > 0;
  const isAreaSummary = property.details && property.details.bedrooms === "N/A";

  return (
    <div className="property-detail">
      {/* --- Header and Tabs --- */}
      <div className="detail-header">
        <button className="back-button" onClick={onBackToListings}>
          <FontAwesomeIcon icon={faArrowLeft} /> Back
        </button>
        <div className="tabs">
          <button
            className={activeTab === "overview" ? "active" : ""}
            onClick={() => setActiveTab("overview")}
          >
            {" "}
            Overview{" "}
          </button>
          <button
            className={activeTab === "investment" ? "active" : ""}
            onClick={() => setActiveTab("investment")}
          >
            {" "}
            Investment{" "}
          </button>
          {hasTransactionData && (
            <button
              className={activeTab === "history" ? "active" : ""}
              onClick={() => setActiveTab("history")}
            >
              {" "}
              History{" "}
            </button>
          )}
          {/* --- Demographics Tab --- */}
          {isAreaSummary && (
            <button
              className={activeTab === "demographics" ? "active" : ""}
              onClick={() => setActiveTab("demographics")}
              disabled={isFetchingDemographics && !hasDemographicData}
            >
              <FontAwesomeIcon icon={faUsers} /> Demographics{" "}
              {isFetchingDemographics && !hasDemographicData && (
                <FontAwesomeIcon icon={faSpinner} spin />
              )}
            </button>
          )}
        </div>
      </div>

      {/* --- Image and Title --- */}
      <div className="property-image-large">
        <img
          src={
            property.image ||
            "https://placehold.co/600x400/e9e9e9/1d1d1d?text=Image+Not+Available"
          }
          alt={property.title || "Property Image"}
        />
      </div>
      <div className="property-title-section">
        <h2>{property.title || "Property Details"}</h2>
        <div className="property-location">
          <FontAwesomeIcon icon={faLocationDot} />
          <span>{property.location || "Location not specified"}</span>
          {property.postcode && (
            <span className="postcode"> ({property.postcode})</span>
          )}
        </div>
      </div>

      {/* === Tab Content === */}

      {/* --- Overview Tab --- */}
      {activeTab === "overview" && (
        <div className="property-tab-content">
          {/* Property Specific Details (only for specific listings) */}
          {isSpecificListing && (
            <div className="detail-section">
              <h3>Property Details</h3>
              <div className="details-grid">
                <div className="metric">
                  <FontAwesomeIcon icon={faBed} />
                  <div className="metric-content">
                    <span className="metric-label">Bedrooms</span>
                    <span className="metric-value">
                      {details.bedrooms || "N/A"}
                    </span>
                  </div>
                </div>
                <div className="metric">
                  <FontAwesomeIcon icon={faBath} />
                  <div className="metric-content">
                    <span className="metric-label">Bathrooms</span>
                    <span className="metric-value">
                      {details.bathrooms || "N/A"}
                    </span>
                  </div>
                </div>
                <div className="metric">
                  <FontAwesomeIcon icon={faRulerCombined} />
                  <div className="metric-content">
                    <span className="metric-label">Size</span>
                    <span className="metric-value">
                      {details.sqft ? `${details.sqft} sqft` : "N/A"}
                    </span>
                  </div>
                </div>
                <div className="metric">
                  <FontAwesomeIcon icon={faClock} />
                  <div className="metric-content">
                    <span className="metric-label">Age</span>
                    <span className="metric-value">
                      {details.age ? `${details.age} years` : "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pricing Information (Common to both types) */}
          <div className="detail-section">
            <h3>Pricing Information</h3>
            <div className="details-grid">
              <div className="metric">
                <FontAwesomeIcon icon={faSterlingSign} />
                <div className="metric-content">
                  <span className="metric-label">Asking Price</span>
                  <span className="metric-value">
                    {formatPrice(price.asking)}
                  </span>
                </div>
              </div>
              <div className="metric">
                <FontAwesomeIcon icon={faSterlingSign} />
                <div className="metric-content">
                  <span className="metric-label">
                    {isSpecificListing ? "Est. Value" : "Avg. Price (Area)"}
                  </span>
                  <span className="metric-value">
                    {formatPrice(price.estimated)}
                  </span>
                </div>
              </div>
              <div className="metric">
                {/* ROI / Annualized Return depends on context and availability */}
                <FontAwesomeIcon icon={faChartLine} />
                <div className="metric-content">
                  <span className="metric-label">
                    {isSpecificListing ? "Potential ROI" : "Annualized Return"}
                  </span>
                  <span className="metric-value">
                    {formatPercentage(price.roi)}
                  </span>
                </div>
              </div>
              <div className="metric">
                <FontAwesomeIcon icon={faPercentage} />
                <div className="metric-content">
                  <span className="metric-label">Rental Yield</span>
                  <span className="metric-value">
                    {formatPercentage(price.rentalYield)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Amenities, Transport, Schools (only for specific listings) */}
          {isSpecificListing && amenities.length > 0 && (
            <div className="detail-section">
              <h3>Amenities</h3>
              <ul className="amenities-list">
                {amenities.map((amenity, index) => (
                  <li key={index}>
                    <FontAwesomeIcon
                      icon={
                        amenity.toLowerCase().includes("park")
                          ? faCar
                          : faBuilding
                      }
                    />
                    <span>{amenity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isSpecificListing && transport.length > 0 && (
            <div className="detail-section">
              <h3>Transport Links</h3>
              <ul className="transport-list">
                {transport.map((item, index) => (
                  <li key={index}>
                    <FontAwesomeIcon icon={faTrain} />
                    <span>
                      {item.name} ({item.distance})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isSpecificListing && schools.length > 0 && (
            <div className="detail-section">
              <h3>Nearby Schools</h3>
              <ul className="schools-list">
                {schools.map((school, index) => (
                  <li key={index}>
                    <FontAwesomeIcon icon={faSchool} />
                    <span>{school}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Note for Area Summary */}
          {isAreaSummary && (
            <div className="detail-section area-summary-note">
              <p>
                This is an overview for the postcode area based on recent
                transaction data. Investment and historical data are available
                in the other tabs. Specific property details like bedrooms,
                amenities etc., require viewing individual listings.
              </p>
            </div>
          )}
        </div>
      )}

      {/* --- Investment Tab --- */}
      {activeTab === "investment" && (
        <div className="property-tab-content">
          {/* Placeholder for Market Trends */}
          <div className="detail-section">
            <h3>
              Market Trends (Placeholder) <FontAwesomeIcon icon={faEllipsisH} />
            </h3>
            <div className="market-trend-graph placeholder">
              <FontAwesomeIcon icon={faChartArea} size="3x" />
              <p>
                Detailed market trend visualization will be done by DS students.
              </p>
            </div>
          </div>

          {/* Investment Metrics */}
          <div className="detail-section">
            <h3>Investment Metrics</h3>
            <div className="details-grid">
              {/* Home Value / Average Price */}
              <div className="metric">
                <FontAwesomeIcon icon={faHome} />
                <div className="metric-content">
                  <span className="metric-label">
                    {isSpecificListing
                      ? "Est. Home Value"
                      : "Avg. Price (Area)"}
                  </span>
                  <span className="metric-value">
                    {formatPrice(price.estimated) || (
                      <span className="no-result">No result</span>
                    )}
                  </span>
                </div>
              </div>
              {/* Historical Growth (Calculated) */}
              {priceGrowthInfo.growth !== "No result" &&
              priceGrowthInfo.growth !== "Not enough data" &&
              priceGrowthInfo.growth !== "Calculation error" ? (
                <div className="metric">
                  <FontAwesomeIcon icon={faChartLine} />
                  <div className="metric-content">
                    <span className="metric-label">Historical Growth</span>
                    <span className="metric-value">
                      {priceGrowthInfo.growth}
                    </span>
                  </div>
                </div>
              ) : (
                <NoResultDisplay label="Historical Growth" icon={faChartLine} />
              )}
              {/* Annualized Return (Calculated) */}
              {priceGrowthInfo.annualizedReturn !== "No result" &&
              priceGrowthInfo.annualizedReturn !== "Not enough data" &&
              priceGrowthInfo.annualizedReturn !== "Calculation error" ? (
                <div className="metric">
                  <FontAwesomeIcon icon={faPercentage} />
                  <div className="metric-content">
                    <span className="metric-label">Annualized Return</span>
                    <span className="metric-value">
                      {formatPercentage(priceGrowthInfo.annualizedReturn)}
                    </span>
                  </div>
                </div>
              ) : (
                <NoResultDisplay
                  label="Annualized Return"
                  icon={faPercentage}
                />
              )}
              {/* Rental Yield (From Property Data) */}
              <div className="metric">
                <FontAwesomeIcon icon={faPercentage} />
                <div className="metric-content">
                  <span className="metric-label">Rental Yield</span>
                  <span className="metric-value">
                    {formatPercentage(price.rentalYield)}
                  </span>
                </div>
              </div>
              {/* Risk score (From Property Data - needs external source) */}
              <div className="metric">
                <FontAwesomeIcon icon={faExclamationTriangle} />
                <div className="metric-content">
                  <span className="metric-label">Risk Score</span>
                  <span className="metric-value">
                    {property.riskScore && property.riskScore !== "N/A" ? (
                      property.riskScore
                    ) : (
                      <span className="no-result">No result</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Placeholders for metrics needing external data */}
              <NoResultDisplay label="Price Forecast" icon={faChartLine} />
              <NoResultDisplay label="Rent Forecast" icon={faMoneyBillWave} />
              <NoResultDisplay label="Market Liquidity" icon={faChartBar} />
            </div>
          </div>
        </div>
      )}

      {/* --- History Tab --- */}
      {activeTab === "history" && hasTransactionData && (
        <div className="property-tab-content">
          <div className="detail-section">
            <h3>
              Transaction History ({property.postcode}){" "}
              <FontAwesomeIcon icon={faHistory} />
            </h3>
            {hasTransactionData ? (
              <>
                {/* --- Summary Stats --- */}
                <div className="price-stats history-stats">
                  {currentTransactionData.length > 0 && (
                    <div className="stat-item">
                      <span className="stat-label">
                        Latest Recorded Sale (
                        {currentTransactionData[0].date.toLocaleDateString()}):
                      </span>
                      <span className="stat-value price-value">
                        {formatPrice(currentTransactionData[0].price)}
                      </span>
                    </div>
                  )}
                  {priceGrowthInfo.growth !== "No result" &&
                    priceGrowthInfo.growth !== "Not enough data" &&
                    priceGrowthInfo.growth !== "Calculation error" && (
                      <div className="stat-item">
                        <span className="stat-label">
                          Overall Growth Trend:
                        </span>
                        <span
                          className={`stat-value price-change ${
                            priceGrowthInfo.growth.startsWith("+")
                              ? "positive"
                              : "negative"
                          }`}
                        >
                          {priceGrowthInfo.growth}
                        </span>
                      </div>
                    )}
                  {priceGrowthInfo.annualizedReturn !== "No result" &&
                    priceGrowthInfo.annualizedReturn !== "Not enough data" &&
                    priceGrowthInfo.annualizedReturn !==
                      "Calculation error" && (
                      <div className="stat-item">
                        <span className="stat-label">Annualized Return:</span>
                        <span className="stat-value price-change">
                          {formatPercentage(priceGrowthInfo.annualizedReturn)}
                        </span>
                      </div>
                    )}
                  {/* Display Price Range */}
                  {priceGrowthInfo.priceRange.min > 0 && (
                    <div className="stat-item">
                      <span className="stat-label">
                        Price Range (in results):
                      </span>
                      <span className="stat-value">
                        {formatPrice(priceGrowthInfo.priceRange.min)} -{" "}
                        {formatPrice(priceGrowthInfo.priceRange.max)}
                      </span>
                    </div>
                  )}
                  <div className="stat-item">
                    <span className="stat-label">
                      Total Transactions Found:
                    </span>
                    <span className="stat-value">
                      {currentTransactionData.length}
                    </span>
                  </div>
                </div>

                {/* --- Transaction Table --- */}
                <div className="table-container">
                  <table className="transaction-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Price</th>
                        <th>Type</th>
                        <th>Address</th>
                        <th>New Build</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentTransactionData.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>
                            {transaction.date
                              ? transaction.date.toLocaleDateString()
                              : "N/A"}
                          </td>
                          <td>{formatPrice(transaction.price)}</td>
                          <td>{transaction.propertyType || "N/A"}</td>
                          <td>{transaction.address || "N/A"}</td>
                          <td>{transaction.isNewBuild ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              // Message if no transaction data was found
              <div className="no-data-message">
                <FontAwesomeIcon icon={faExclamationTriangle} />
                <p>
                  No historical transaction data found for this specific
                  property or area.
                </p>
                {!isSpecificListing && <p>Try searching another postcode.</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "history" && !hasTransactionData && (
        <div className="property-tab-content">
          <div className="no-data-message">
            <FontAwesomeIcon icon={faExclamationTriangle} />
            <p>
              No historical transaction data found for this specific property or
              area.
            </p>
          </div>
        </div>
      )}

      {/* --- NEW Demographics Tab --- */}
      {activeTab === "demographics" && isAreaSummary && (
        <div className="property-tab-content demographics-tab-content">
          <div className="detail-section demographics-section">
            <div className="demographics-header">
              <h3>Area Demographics (Census 2021)</h3>
              {/* --- Add Expand/Collapse Buttons --- */}
              {hasDemographicData && (
                <div className="expand-collapse-controls">
                  <button onClick={handleExpandAll} title="Expand All">
                    <FontAwesomeIcon icon={faPlusSquare} /> Expand All
                  </button>
                  <button onClick={handleCollapseAll} title="Collapse All">
                    <FontAwesomeIcon icon={faMinusSquare} /> Collapse All
                  </button>
                </div>
              )}
            </div>

            {/* Loading State */}
            {isFetchingDemographics && !hasDemographicData && (
              <div className="loading-message"> /* ... loading ... */ </div>
            )}

            {/* Error State */}
            {demographicsError && !hasDemographicData && (
              <div className="no-data-message error"> /* ... error ... */ </div>
            )}

            {/* Data Display using Cards */}
            {hasDemographicData && (
              <div className="demographics-cards-container">
                <p className="data-source-note">Data source: Nomis (ONS)</p>
                {property.crimeStats && (
  <CrimeCard
    stats={property.crimeStats}
    isCollapsed={collapsedCards["Crime"] ?? true}
    onToggleCollapse={() => handleToggleCollapse("Crime")}
  />
)}

                {Object.entries(demographicData.demographics)
                  .sort(([topicA], [topicB]) => topicA.localeCompare(topicB))
                  .map(([topic, data]) => (
                    <DemographicCard
                      key={topic}
                      topicName={topic}
                      nomisData={data}
                      geoCodes={demographicData.geoCodes}
                      // --- Pass state and handler ---
                      isCollapsed={
                        collapsedCards[topic] === undefined
                          ? true
                          : collapsedCards[topic]
                      } // Default to collapsed if state not yet set
                      onToggleCollapse={() => handleToggleCollapse(topic)}
                    />
                  ))}

                {/* ... partial error note ... */}
              </div>
            )}
            {/* ... Message if fetched but no data ... */}
            {!isFetchingDemographics &&
              !demographicsError &&
              !hasDemographicData && (
                <div className="no-data-message">
                  {" "}
                  /* ... no data message ... */{" "}
                </div>
              )}
          </div>
        </div>
      )}
    </div> // End property-detail
  );
};

// Need to re-import calculatePriceGrowth if not globally available or passed down
// Assuming it's imported where PropertyDetail is used or available globally.
// If not, you might need to pass it as a prop or import it here:

export default PropertyDetail;
