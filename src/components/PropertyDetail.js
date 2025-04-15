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
  faPlusSquare,
  faMinusSquare,
  faChartBar,
  faPercentage,
  faHistory,
  faArrowLeft,
  faEllipsisH,
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

// Helper to safely access nested properties for Street Data properties
const getAttribute = (property, path) => {
  if (!property || !property.attributes) return null;
  const keys = path.split(".");
  let current = property.attributes;
  for (const key of keys) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      !(key in current)
    ) {
      return null; // Return null if path is invalid
    }
    current = current[key];
  }
  return current; // Return the final value
};

// --- Main Component ---

const PropertyDetail = ({
  property,
  demographicData,
  landRegistryTransactions = [], // Add transactions array with default
  landRegistrySummary = null, // Add summary with default
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

  // Determine if property is from street data or featured
  const isStreetData = property.dataSource === "streetData";
  const isFeatured = property.dataSource === "featured";

  // --- Display Title and Basic Property Information ---
  let displayTitle = "Property Details";
  if (isFeatured) {
    displayTitle = property.title || "Featured Property";
  } else if (isStreetData) {
    const address = getAttribute(
      property,
      "address.street_group_format.address_lines"
    );
    const postcode = getAttribute(
      property,
      "address.street_group_format.postcode"
    );
    displayTitle = address ? `${address}` : postcode || "Selected Property";
  }

  // --- Data Preparation ---
  // Use transaction data from property if available (for property-specific history)
  // Or use area transactions if passed as prop (for area data analysis)
  const currentTransactionData =
    property.transactionHistory || landRegistryTransactions || [];

  // Merge price growth data sources - prefer property specific if available
  const priceGrowthInfo =
    property.priceGrowth ||
    (landRegistrySummary ? landRegistrySummary.priceGrowth || {} : {});

  const isSpecificListing =
    property.details && property.details.bedrooms !== "N/A";

  const details = property.details || {};
  const price = property.price || {};
  const amenities = property.amenities || [];
  const transport = property.transport || [];
  const schools = property.schools || [];

  // --- Handler Functions ---
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
  const hasAreaTransactions =
    landRegistryTransactions && landRegistryTransactions.length > 0;
  const isAreaSummary = property.details && property.details.bedrooms === "N/A";

  // Add a postcode display in case we have area data but not property postcode
  const displayPostcode =
    property.postcode ||
    demographicData?.postcode ||
    (landRegistrySummary?.title
      ? landRegistrySummary.title.replace("Land Registry Overview: ", "")
      : null);

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
          {/* Show History tab if we have property or area transaction data */}
          {(hasTransactionData || hasAreaTransactions) && (
            <button
              className={activeTab === "history" ? "active" : ""}
              onClick={() => setActiveTab("history")}
            >
              {" "}
              History{" "}
            </button>
          )}
          {/* Demographics tab now available for all properties when area data exists */}
          {hasDemographicData && (
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
          alt={displayTitle || "Property Image"}
        />
      </div>
      <div className="property-title-section">
        <h2>{displayTitle}</h2>
        <div className="property-location">
          <FontAwesomeIcon icon={faLocationDot} />
          {isStreetData ? (
            <>
              <span>
                {getAttribute(property, "localities.local_authority") ||
                  "Location not specified"}
              </span>
              {getAttribute(
                property,
                "address.street_group_format.postcode"
              ) && (
                <span className="postcode">
                  {" "}
                  (
                  {getAttribute(
                    property,
                    "address.street_group_format.postcode"
                  )}
                  )
                </span>
              )}
            </>
          ) : (
            <>
              <span>{property.location || "Location not specified"}</span>
              {displayPostcode && (
                <span className="postcode"> ({displayPostcode})</span>
              )}
            </>
          )}
        </div>
        {/* Show property type for street data properties */}
        {isStreetData && (
          <div className="property-type">
            <FontAwesomeIcon icon={faHome} />
            <span>
              Type: {getAttribute(property, "property_type.value") || "N/A"}
            </span>
          </div>
        )}
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

          {/* Area Summary (shown when we have land registry data) */}
          {hasAreaTransactions && (
            <div className="detail-section">
              <h3>
                Area Data Summary {displayPostcode && `(${displayPostcode})`}
              </h3>
              <div className="area-summary">
                <p>
                  Showing data for the surrounding area based on{" "}
                  {landRegistryTransactions.length} property transactions.
                </p>
                {landRegistrySummary && (
                  <div className="details-grid">
                    <div className="metric">
                      <FontAwesomeIcon icon={faSterlingSign} />
                      <div className="metric-content">
                        <span className="metric-label">
                          Average Price (Area)
                        </span>
                        <span className="metric-value">
                          {landRegistrySummary.averagePrice}
                        </span>
                      </div>
                    </div>
                    {landRegistrySummary.priceGrowth &&
                      landRegistrySummary.priceGrowth.annualizedReturn && (
                        <div className="metric">
                          <FontAwesomeIcon icon={faChartLine} />
                          <div className="metric-content">
                            <span className="metric-label">Annual Growth</span>
                            <span className="metric-value">
                              {landRegistrySummary.priceGrowth.annualizedReturn}
                            </span>
                          </div>
                        </div>
                      )}
                  </div>
                )}
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

          {/* Note for Property in Area Context */}
          {(isStreetData || isAreaSummary) && (
            <div className="detail-section area-summary-note">
              <p>
                This property is shown in the context of area data. Check the
                Investment, History, and Demographics tabs for more insights
                about the surrounding area.
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
                    {isSpecificListing
                      ? formatPrice(price.estimated)
                      : (landRegistrySummary
                          ? landRegistrySummary.averagePrice
                          : formatPrice(price.estimated)) || (
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
      {activeTab === "history" &&
        (hasTransactionData || hasAreaTransactions) && (
          <div className="property-tab-content">
            <div className="detail-section">
              <h3>
                Transaction History{" "}
                {displayPostcode ? `(${displayPostcode})` : ""}{" "}
                <FontAwesomeIcon icon={faHistory} />
              </h3>
              {hasTransactionData || hasAreaTransactions ? (
                <>
                  {/* --- Summary Stats --- */}
                  <div className="price-stats history-stats">
                    {currentTransactionData.length > 0 && (
                      <div className="stat-item">
                        <span className="stat-label">
                          Latest Recorded Sale (
                          {currentTransactionData[0].date.toLocaleDateString()}
                          ):
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
                    {priceGrowthInfo.priceRange &&
                      priceGrowthInfo.priceRange.min > 0 && (
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

      {activeTab === "history" &&
        !hasTransactionData &&
        !hasAreaTransactions && (
          <div className="property-tab-content">
            <div className="no-data-message">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <p>
                No historical transaction data found for this specific property
                or area.
              </p>
            </div>
          </div>
        )}

      {/* --- Demographics Tab --- */}
      {activeTab === "demographics" && hasDemographicData && (
        <div className="property-tab-content demographics-tab-content">
          <div className="detail-section demographics-section">
            <div className="demographics-header">
              <h3>
                Area Demographics -{" "}
                {demographicData.postcode || displayPostcode || "Area"} (Census
                2021)
              </h3>
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
              <div className="loading-message">
                <FontAwesomeIcon icon={faSpinner} spin />
                <p>Loading demographic data...</p>
              </div>
            )}

            {/* Error State */}
            {demographicsError && !hasDemographicData && (
              <div className="no-data-message error">
                <FontAwesomeIcon icon={faExclamationTriangle} />
                <p>Error loading demographic data: {demographicsError}</p>
              </div>
            )}

            {/* Data Display using Cards */}
            {hasDemographicData && (
              <div className="demographics-cards-container">
                <p className="data-source-note">Data source: Nomis (ONS)</p>

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

                {demographicData.fetchErrors &&
                  Object.keys(demographicData.fetchErrors).length > 0 && (
                    <div className="partial-errors">
                      <p>Note: Some demographic topics could not be loaded.</p>
                    </div>
                  )}
              </div>
            )}

            {/* No Data Message */}
            {!isFetchingDemographics &&
              !demographicsError &&
              !hasDemographicData && (
                <div className="no-data-message">
                  <FontAwesomeIcon icon={faExclamationTriangle} />
                  <p>No demographic data is available for this area.</p>
                </div>
              )}
          </div>
        </div>
      )}
    </div> // End property-detail
  );
};

export default PropertyDetail;
