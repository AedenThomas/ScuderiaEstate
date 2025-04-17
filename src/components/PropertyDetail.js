import React, { useState, useEffect } from "react"; // Import useState and useEffect from React
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath,
  faRulerCombined,
  faBuilding,
  faHome,
  faChartLine,
  faSchool,
  faTrain,
  faArrowLeft,
  faSpinner,
  faExternalLinkAlt,
  faUserGroup,
  faCar,
  faSterlingSign,
} from "@fortawesome/free-solid-svg-icons";

import DemographicCard from "./DemographicCard";
// import "./PropertyDetail.css"; // Make sure this path is correct

// Optional: Import charting library if using
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

// Helper to format currency
const formatCurrency = (value) => {
  if (typeof value !== "number" || isNaN(value)) return "N/A";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Helper to format date string or return placeholder
const formatDate = (date) => {
  if (!date) return "N/A";
  try {
    return new Date(date).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (e) {
    return "Invalid Date";
  }
};

// (Keep formatPrice and formatPercentage helpers as they are correct)
// Formats numbers as currency (adds £, commas) or returns "No result"
const formatPrice = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "No result" ||
    value === "Loading..." || // Handle loading state
    value === "Error"
  ) {
    return value ?? "No result"; // Return loading/error or default
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
    value === "Calculation error" ||
    value === "Loading..." || // Handle loading state
    value === "Error"
  ) {
    return value ?? "No result"; // Return loading/error or default
  }
  // Check if it already has % or p.a.
  if (
    typeof value === "string" &&
    (value.includes("%") || value.includes("p.a."))
  ) {
    // Simple check, might need more robust cleaning if format varies wildly
    return value;
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

const PropertyDetail = ({
  property,
  isLoadingLR, // Receive loading state for Land Registry
  isLoadingDemo, // Receive loading state for Demographics

  // *** NEW PROPS for Prediction ***
  predictionResults,
  isLoadingPrediction,
  predictionError,
  // *** End New Props ***

  onBackToListings,
}) => {
  // --- HOOKS MUST BE CALLED AT THE TOP LEVEL ---
  // State for managing collapsed demographic cards
  const [collapsedTopics, setCollapsedTopics] = useState({});

  // Extract demographics safely for the effect dependency check
  // This avoids accessing property directly inside useEffect if property could be null initially
  const demographics = property?.demographicData?.demographics;

  // Update collapsed topics when demographics data changes
  // This useEffect depends on 'demographics', which is derived from 'property'
  useEffect(() => {
    // Only run if demographics is a valid object
    if (demographics && typeof demographics === "object") {
      const initialState = {};
      Object.keys(demographics).forEach((topic) => {
        // Set initial state to collapsed (true) for each topic
        initialState[topic] = true;
      });
      setCollapsedTopics(initialState);
    } else {
      // If demographics is not available (e.g., property is null or data missing),
      // reset the collapsed state to empty
      setCollapsedTopics({});
    }
    // Dependency array includes 'demographics'. This effect runs when 'demographics' changes.
  }, [demographics]);

  // --- EARLY RETURN (AFTER HOOKS) ---
  // If there's no property data, don't render anything
  if (!property) {
    return null;
  }

  // --- Destructure with defaults (AFTER the early return check) ---
  const {
    // id, // Removed 'id' as it's not used directly in the render
    title = "Property Details",
    location = "N/A",
    postcode = "N/A",
    details = {},
    price = {},
    description = "",
    transactionHistory = null,
    priceGrowth = null,
    demographicData = null, // Contains { postcode, geoCodes, demographics, fetchErrors }
    source = "Unknown",
    detail_url = null,
    image = "https://placehold.co/600x400/cccccc/1d1d1d?text=Detail+View",
    amenities = [],
    transport = [],
    schools = [],
  } = property;

  // Extract geoCodes and fetchErrors safely AFTER potentially null demographicData check
  const geoCodes = property?.demographicData?.geoCodes;
  const demoFetchErrors = property?.demographicData?.fetchErrors || [];

  // --- Event Handler ---
  const toggleTopicCollapse = (topicName) => {
    setCollapsedTopics((prev) => ({
      ...prev,
      [topicName]: !prev[topicName], // Toggle the boolean value
    }));
  };

  // --- Render Logic ---
  return (
    <div className="property-detail">
      <div className="detail-header">
        <button
          onClick={onBackToListings}
          className="back-button"
          aria-label="Back to listings"
        >
          <FontAwesomeIcon icon={faArrowLeft} /> Back
        </button>
        <h2>{title}</h2>
        <div className="detail-location">
          <FontAwesomeIcon icon={faLocationDot} />
          <span>
            {location} {postcode && `(${postcode})`}
          </span>
          {source && <span className="data-source-tag">{source}</span>}
        </div>
        {detail_url && (
          <a
            href={detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="external-link"
            title="View original listing on external site"
          >
            View Original Listing{" "}
            <FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />
          </a>
        )}
      </div>

      <div className="detail-content">
        {/* --- Basic Property Info (Always Show) --- */}
        <div className="detail-section basic-info">
          <div className="info-left">
            <img src={image} alt={title} className="detail-image" />
            {description && <p className="detail-description">{description}</p>}
          </div>
          <div className="info-right">
            <h4>Property Overview</h4>
            <div className="info-grid">
              <div className="info-item">
                <FontAwesomeIcon icon={faBed} />
                <span>{details.bedrooms || "N/A"} Beds</span>
              </div>
              <div className="info-item">
                <FontAwesomeIcon icon={faBath} />
                <span>{details.bathrooms || "N/A"} Baths</span>
              </div>
              <div className="info-item">
                <FontAwesomeIcon icon={faRulerCombined} />
                {/* Display sqft only if available and not 'N/A' */}
                <span>
                  {details.sqft && details.sqft !== "N/A"
                    ? details.sqft
                    : "Area N/A"}
                </span>
              </div>
              <div className="info-item">
                <FontAwesomeIcon icon={faBuilding} />
                <span>{details.propertyType || "Type N/A"}</span>
              </div>
              <div className="info-item price-asking">
                <FontAwesomeIcon icon={faSterlingSign} />
                {/* Use formatPrice helper for consistency */}
                <span>Asking: {formatPrice(price.asking)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* --- Investment / Land Registry Section --- */}
        <div className="detail-section investment-info">
          <h3>
            <FontAwesomeIcon icon={faChartLine} /> Investment Data
          </h3>
          {isLoadingLR ? ( // Use ternary operator for cleaner conditional rendering
            <div className="loading-indicator">
              <FontAwesomeIcon icon={faSpinner} spin /> Loading Land Registry
              Data...
            </div>
          ) : (
            // Render content when not loading
            <>
              {/* Handle case where loading is finished but history is null (error) */}
              {transactionHistory === null && !isLoadingLR && (
                <p className="error-message">
                  Could not load transaction history.
                </p>
              )}
              {/* Render metrics only if history exists and has items */}
              {transactionHistory && transactionHistory.length > 0 && (
                <div className="investment-metrics">
                  <div className="metric-box">
                    <span className="metric-label">Est. Value (Avg. Sold)</span>
                    {/* Use formatPrice helper */}
                    <span className="metric-value">
                      {formatPrice(price.estimated)}
                    </span>
                  </div>
                  <div className="metric-box">
                    <span className="metric-label">Price Growth Trend</span>
                    {/* Show growth period if available */}
                    <span className="metric-value">
                      {priceGrowth?.growth && priceGrowth.growth !== "N/A"
                        ? priceGrowth.growth
                        : "No result"}
                    </span>
                  </div>
                  <div className="metric-box">
                    <span className="metric-label">Annualized Return</span>
                    {/* Use formatPercentage helper */}
                    <span className="metric-value">
                      {formatPercentage(priceGrowth?.annualizedReturn)}
                    </span>
                  </div>
                </div>
              )}
              {/* Render transaction list if history exists and has items */}
              {transactionHistory && transactionHistory.length > 0 && (
                <div className="transaction-history">
                  <h4>Recent Transactions (Area)</h4>
                  <ul className="transaction-list">
                    {transactionHistory.slice(0, 5).map(
                      (
                        t // Show top 5
                      ) => (
                        <li key={t.id}>
                          <span className="date">{formatDate(t.date)}</span>
                          {/* Use formatPrice helper */}
                          <span className="price">{formatPrice(t.price)}</span>
                          <span className="type">
                            {t.propertyType} {t.isNewBuild ? "(New)" : ""}
                          </span>
                        </li>
                      )
                    )}
                    {transactionHistory.length > 5 && (
                      <li className="more-transactions">
                        ...and {transactionHistory.length - 5} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {/* Show message only if loading finished and history is explicitly empty */}
              {!isLoadingLR &&
                transactionHistory &&
                transactionHistory.length === 0 && (
                  <p>
                    No recent transaction history found for this postcode area.
                  </p>
                )}
            </>
          )}
        </div>

        {/* --- Amenities Section (if available) --- */}
        {amenities && amenities.length > 0 && (
          <div className="detail-section amenities-info">
            <h3>
              <FontAwesomeIcon icon={faHome} /> Amenities
            </h3>
            <ul className="compact-list">
              {" "}
              {/* Use compact-list for better spacing */}
              {amenities.map((amenity, index) => (
                <li key={index}>
                  {/* Simple check for common amenity types for icon */}
                  <FontAwesomeIcon
                    icon={
                      amenity.toLowerCase().includes("park") ||
                      amenity.toLowerCase().includes("garage")
                        ? faCar
                        : amenity.toLowerCase().includes("gym") ||
                          amenity.toLowerCase().includes("fitness")
                        ? faSpinner // Placeholder - choose better icon if needed
                        : faBuilding // Default amenity icon
                    }
                    className="list-icon"
                  />
                  <span>{amenity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* --- Transport Section (if available) --- */}
        {transport && transport.length > 0 && (
          <div className="detail-section transport-info">
            <h3>
              <FontAwesomeIcon icon={faTrain} /> Transport Links
            </h3>
            <ul className="compact-list">
              {transport.map((item, index) => (
                <li key={index}>
                  <FontAwesomeIcon icon={faTrain} className="list-icon" />
                  <span>
                    {item.name} ({item.distance})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* --- Schools Section (if available) --- */}
        {schools && schools.length > 0 && (
          <div className="detail-section schools-info">
            <h3>
              <FontAwesomeIcon icon={faSchool} /> Nearby Schools
            </h3>
            <ul className="compact-list">
              {schools.map((school, index) => (
                <li key={index}>
                  <FontAwesomeIcon icon={faSchool} className="list-icon" />
                  <span>{school}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* --- Demographics Section --- */}
        <div className="detail-section demographics-info">
          <h3>
            <FontAwesomeIcon icon={faUserGroup} /> Area Demographics
          </h3>
          {isLoadingDemo ? ( // Use ternary operator
            <div className="loading-indicator">
              <FontAwesomeIcon icon={faSpinner} spin /> Loading Demographics...
            </div>
          ) : (
            // Render content when not loading
            <>
              {/* Check for specific error property in demographicData */}
              {demographicData?.error && (
                <p className="error-message">
                  Error loading demographics: {demographicData.error}
                </p>
              )}
              {/* Show general message if no data and no specific error */}
              {!demographicData && !isLoadingDemo && (
                <p className="error-message">
                  Could not load demographic data.
                </p>
              )}

              {/* Show partial load warning if applicable */}
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

              {/* Render demographic cards only if demographics object exists, has keys, and geoCodes are present */}
              {demographics &&
                geoCodes &&
                Object.keys(demographics).length > 0 && (
                  <div className="demographic-cards-container">
                    {Object.entries(demographics)
                      // Sort alphabetically by topic name for consistent order
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([topicName, data]) => (
                        <DemographicCard
                          key={topicName}
                          topicName={topicName}
                          nomisData={data} // Pass the data/error object for the specific topic
                          geoCodes={geoCodes}
                          // Check if state exists for topic, default to collapsed (true)
                          isCollapsed={collapsedTopics[topicName] !== false}
                          onToggleCollapse={() =>
                            toggleTopicCollapse(topicName)
                          }
                        />
                      ))}
                  </div>
                )}

              {/* Show message if demographics object exists but is empty, and no errors occurred */}
              {!isLoadingDemo &&
                demographics &&
                Object.keys(demographics).length === 0 &&
                !demographicData?.error &&
                demoFetchErrors.length === 0 && (
                  <p>
                    No specific demographic data points were returned for this
                    area.
                  </p>
                )}
            </>
          )}
        </div>

        {/* --- PREDICTION SECTION --- */}
        <div className="detail-section prediction-info">
          <h3>
            <FontAwesomeIcon icon={faChartLine} /> Price Prediction Trend (Next
            5 Years)
          </h3>
          {isLoadingPrediction ? (
            <div className="loading-indicator">
              <FontAwesomeIcon icon={faSpinner} spin /> Loading predictions...
            </div>
          ) : predictionError ? (
            <p className="error-message">Prediction Error: {predictionError}</p>
          ) : predictionResults && predictionResults.length > 0 ? (
            <>
              <ul>
                {predictionResults.map((result) => (
                  <li key={result.year}>
                    {result.year}: {formatCurrency(result.predicted_price)}
                  </li>
                ))}
              </ul>
              {/* Optional Chart */}
              <div style={{ width: "100%", height: 250, marginTop: "15px" }}>
                <ResponsiveContainer>
                  <LineChart
                    data={predictionResults}
                    margin={{ top: 5, right: 10, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis
                      tickFormatter={(value) =>
                        `£${(value / 1000).toFixed(0)}k`
                      }
                    />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="predicted_price"
                      name="Predicted"
                      stroke="#82ca9d"
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p>No prediction data available.</p>
          )}
        </div>
        {/* --- END PREDICTION SECTION --- */}
      </div>
    </div>
  );
};

export default PropertyDetail;
