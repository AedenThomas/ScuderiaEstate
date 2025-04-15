import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath,
  faRulerCombined,
  faClock,
  faBuilding,
  faTrain,
  faSchool,
  faExclamationTriangle,
  faSterlingSign,
  faHome, // Icon for property type
} from "@fortawesome/free-solid-svg-icons";

// Helper to format price or show placeholder (assuming you might get price later)
const formatDisplayPrice = (price) => {
  if (
    price &&
    price !== "N/A" &&
    !isNaN(Number(String(price).replace(/[^0-9.-]+/g, "")))
  ) {
    return `£${Number(
      String(price).replace(/[^0-9.-]+/g, "")
    ).toLocaleString()}`;
  }
  return "N/A";
};

// Helper to safely access nested properties
const getAttribute = (property, path) => {
  // Check if property or attributes exist
  if (!property || !property.attributes) return null;
  // Split path string into keys
  const keys = path.split(".");
  let current = property.attributes;
  // Traverse the keys
  for (const key of keys) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      !(key in current)
    ) {
      return null; // Return null if path is invalid or property doesn't exist
    }
    current = current[key];
  }
  return current; // Return the final value
};

const PropertyCard = ({ property, dataSource, onViewProperty }) => {
  if (!property) return null;

  let displayData = {};

  // Adapt data based on the source
  if (dataSource === "streetData") {
    const streetGroupAddress = getAttribute(
      property,
      "address.street_group_format.address_lines"
    );
    const postcode = getAttribute(
      property,
      "address.street_group_format.postcode"
    );
    const simplifiedAddress = getAttribute(
      property,
      "address.simplified_format"
    );
    const royalMailAddress = getAttribute(
      property,
      "address.royal_mail_format"
    );

    // Construct a fallback address string
    let addressString =
      streetGroupAddress ||
      (simplifiedAddress
        ? `${simplifiedAddress.house_number || ""} ${
            simplifiedAddress.street || ""
          }`.trim()
        : null) ||
      (royalMailAddress
        ? `${
            royalMailAddress.building_number ||
            royalMailAddress.building_name ||
            ""
          } ${royalMailAddress.thoroughfare || ""}`.trim()
        : null) ||
      "Address N/A";

    displayData = {
      id: property.id,
      title: addressString, // Use address as title
      location:
        getAttribute(property, "localities.local_authority") ||
        postcode ||
        "Unknown Location", // Use local authority or postcode
      postcode: postcode,
      image: `https://placehold.co/600x400/d1ecf1/0c5460?text=${
        postcode || "Property"
      }`, // Placeholder using postcode
      details: {
        // Basic tier might not have these, add safety checks or fetch 'core' later
        bedrooms: getAttribute(property, "number_of_bedrooms.value") ?? "-",
        bathrooms: getAttribute(property, "number_of_bathrooms.value") ?? "-",
        sqft: getAttribute(property, "internal_area_square_metres")
          ? `${getAttribute(property, "internal_area_square_metres")} m²`
          : "- m²", // Note: metres not sqft
        age: getAttribute(property, "construction_age_band") ?? "-", // Age band, not specific years
        propertyType: getAttribute(property, "property_type.value") ?? "N/A",
      },
      price: {
        // Prices usually in premium tier, show N/A for basic
        asking: "N/A",
        estimated: "N/A",
        roi: "N/A",
        rentalYield: "N/A",
      },
      // Basic tier doesn't include these details
      amenities: [],
      transport: [],
      schools: [],
      riskScore: "N/A",
    };
  } else {
    // Assume 'featured' or original structure
    displayData = {
      ...property,
      details: property.details || {},
      price: property.price || {},
      amenities: property.amenities || [],
      transport: property.transport || [],
      schools: property.schools || [],
    };
    // Ensure sqft has unit for consistency if it exists
    if (displayData.details.sqft) {
      displayData.details.sqft = `${displayData.details.sqft} sqft`;
    } else {
      displayData.details.sqft = "- sqft";
    }
    // Ensure N/A defaults for price sub-fields
    displayData.price = {
      asking: displayData.price.asking || "N/A",
      estimated: displayData.price.estimated || "N/A",
      roi: displayData.price.roi || "N/A",
      rentalYield: displayData.price.rentalYield || "N/A",
    };
  }

  return (
    <div className="property-card">
      <div className="property-image">
        <img
          src={
            displayData.image ||
            "https://placehold.co/600x400/e9e9e9/1d1d1d?text=No+Image"
          }
          alt={displayData.title || "Property Image"}
        />
      </div>
      <div className="property-content">
        <h3 className="property-title">
          {displayData.title || "Property Listing"}
        </h3>
        <div className="property-location">
          <FontAwesomeIcon icon={faLocationDot} />
          <span>{displayData.location || "Location unknown"}</span>
          {displayData.postcode && (
            <span className="postcode-card"> ({displayData.postcode})</span>
          )}
        </div>

        <div className="property-details">
          <div className="detail-item" title="Bedrooms">
            <FontAwesomeIcon icon={faBed} />
            <span>{displayData.details.bedrooms ?? "-"}</span>
          </div>
          <div className="detail-item" title="Bathrooms">
            <FontAwesomeIcon icon={faBath} />
            <span>{displayData.details.bathrooms ?? "-"}</span>
          </div>
          {/* Show Property Type if available */}
          {dataSource === "streetData" &&
            displayData.details.propertyType &&
            displayData.details.propertyType !== "N/A" && (
              <div className="detail-item" title="Property Type">
                <FontAwesomeIcon icon={faHome} />
                <span>{displayData.details.propertyType}</span>
              </div>
            )}
          <div className="detail-item" title="Internal Area">
            <FontAwesomeIcon icon={faRulerCombined} />
            <span>{displayData.details.sqft ?? "-"}</span>
          </div>
          {dataSource === "featured" && displayData.details.age && (
            <div className="detail-item" title="Age">
              <FontAwesomeIcon icon={faClock} />
              <span>{displayData.details.age} yrs</span>
            </div>
          )}
          {dataSource === "streetData" &&
            displayData.details.age &&
            displayData.details.age !== "-" && (
              <div className="detail-item" title="Construction Age Band">
                <FontAwesomeIcon icon={faClock} />
                <span>{displayData.details.age}</span>
              </div>
            )}
        </div>

        {/* Pricing - Only show if not StreetData basic tier (or adapt if you fetch price later) */}
        {dataSource !== "streetData" && (
          <div className="property-pricing">
            <div className="price-row">
              <span className="price-label">Asking:</span>
              <span className="price-value">
                {formatDisplayPrice(displayData.price.asking)}
              </span>
            </div>
            <div className="price-row">
              <span className="price-label">Est. Value:</span>
              <span className="price-value">
                {formatDisplayPrice(displayData.price.estimated)}
              </span>
            </div>
            <div className="price-row">
              <span className="price-label">ROI:</span>
              <span className="price-value">
                {displayData.price.roi && displayData.price.roi !== "No result"
                  ? displayData.price.roi
                  : "N/A"}
              </span>
            </div>
            <div className="price-row">
              <span className="price-label">Yield:</span>
              <span className="price-value">
                {displayData.price.rentalYield &&
                displayData.price.rentalYield !== "No result"
                  ? displayData.price.rentalYield
                  : "N/A"}
              </span>
            </div>
          </div>
        )}

        {/* Amenities/Transport/Schools - Only for featured data for now */}
        {dataSource === "featured" &&
          (displayData.amenities.length > 0 ||
            displayData.transport.length > 0 ||
            displayData.schools.length > 0) && (
            <div className="property-sections">
              {displayData.amenities.length > 0 && (
                <div className="section">
                  <h4>
                    <FontAwesomeIcon icon={faBuilding} /> Amenities
                  </h4>
                  <ul className="compact-list">
                    {displayData.amenities.slice(0, 2).map((amenity, index) => (
                      <li key={index}>
                        <span>{amenity}</span>
                      </li>
                    ))}
                    {displayData.amenities.length > 2 && (
                      <li>
                        <span>...</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {displayData.transport.length > 0 && (
                <div className="section">
                  <h4>
                    <FontAwesomeIcon icon={faTrain} /> Transport
                  </h4>
                  <ul className="compact-list">
                    {displayData.transport.slice(0, 1).map((item, index) => (
                      <li key={index}>
                        <span>
                          {item.name} ({item.distance})
                        </span>
                      </li>
                    ))}
                    {displayData.transport.length > 1 && (
                      <li>
                        <span>...</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {displayData.schools.length > 0 && (
                <div className="section">
                  <h4>
                    <FontAwesomeIcon icon={faSchool} /> Schools
                  </h4>
                  <ul className="compact-list">
                    {displayData.schools.slice(0, 1).map((school, index) => (
                      <li key={index}>
                        <span>{school}</span>
                      </li>
                    ))}
                    {displayData.schools.length > 1 && (
                      <li>
                        <span>...</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

        <div className="property-footer">
          {dataSource === "featured" && (
            <div className="risk-score">
              <FontAwesomeIcon icon={faExclamationTriangle} />
              <span>
                Risk:{" "}
                {displayData.riskScore && displayData.riskScore !== "N/A"
                  ? displayData.riskScore
                  : "N/A"}
              </span>
            </div>
          )}
          {/* Use street group ID for street data */}
          {dataSource === "streetData" && (
            <div className="risk-score">
              {" "}
              {/* Use the same style for ID */}
              <span>ID: {displayData.id}</span>
            </div>
          )}
          <button className="view-property-btn" onClick={onViewProperty}>
            {dataSource === "streetData" ? "Focus Map" : "View Details"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PropertyCard;
