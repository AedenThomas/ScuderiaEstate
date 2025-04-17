// src/components/PropertyCard.js
import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath, // Keep faBath
  faRulerCombined,
  faSterlingSign,
} from "@fortawesome/free-solid-svg-icons";
import ImageSlideshow from "./ImageSlideshow"; // Import the new component

// Helper to format price or show placeholder
const formatDisplayPrice = (price) => {
  if (
    price &&
    price !== "N/A" &&
    !isNaN(Number(price.toString().replace(/[^0-9.-]+/g, "")))
  ) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(price.toString().replace(/[^0-9.-]+/g, "")));
  }
  return "N/A";
};

const PropertyCard = ({ property, onViewProperty }) => {
  if (!property) return null;

  const details = property.details || {};
  const price = property.price || {};

  // Refined check for valid bathrooms - ensure it's a non-empty string/number > 0 after parsing
  let bathroomCount = null;
  if (
    details.bathrooms &&
    details.bathrooms !== "N/A" &&
    details.bathrooms !== "-"
  ) {
    const parsed = parseInt(String(details.bathrooms).match(/\d+/)?.[0], 10); // Extract digits and parse
    if (!isNaN(parsed) && parsed > 0) {
      bathroomCount = parsed;
    }
  }
  const hasValidBathrooms = bathroomCount !== null; // Check if we got a valid number

  const hasValidSqft =
    details.sqft && details.sqft !== "N/A" && details.sqft !== "-";

  return (
    <div className="property-card simplified">
      {/* --- Replace img with ImageSlideshow --- */}
      <div className="property-image">
        <ImageSlideshow
          imageUrls={
            property.image_urls || [
              property.image ||
                "https://placehold.co/600x400/e9e9e9/1d1d1d?text=No+Image",
            ]
          }
          altText={property.title}
        />
        <div className="property-price-overlay">
          {formatDisplayPrice(price.asking)}
        </div>
      </div>

      {/* --- Keep property-content --- */}
      <div className="property-content">
        <h3 className="property-title">
          {property.title || "Property Listing"}
        </h3>
        <div className="property-location">
          <FontAwesomeIcon icon={faLocationDot} />
          <span>{property.location || "Location unknown"}</span>
          {property.postcode && (
            <span className="postcode-card"> ({property.postcode})</span>
          )}
        </div>

        {/* Simplified Details Row */}
        <div className="property-details simple-details">
          <div className="detail-item">
            <FontAwesomeIcon icon={faBed} />
            <span>{details.bedrooms || "-"} Beds</span>
          </div>
          {/* Conditionally render bathrooms - USE hasValidBathrooms */}
          {hasValidBathrooms && (
            <div className="detail-item">
              <FontAwesomeIcon icon={faBath} />
              {/* Display the parsed count */}
              <span>
                {bathroomCount} {bathroomCount === 1 ? "Bath" : "Baths"}
              </span>
            </div>
          )}
          {/* Conditionally render sqft (keep existing) */}
          {hasValidSqft && (
            <div className="detail-item">
              <FontAwesomeIcon icon={faRulerCombined} />
              <span>
                {details.sqft.includes("sq ft")
                  ? details.sqft
                  : `${details.sqft} sq ft`}
              </span>
            </div>
          )}
        </div>

        <div className="property-footer">
          {property.source && (
            <span className="source-tag">{property.source}</span>
          )}
          <button className="view-property-btn" onClick={onViewProperty}>
            View Details
          </button>
        </div>
      </div>
    </div>
  );
};

export default PropertyCard;
