// src/components/PropertyCard.js
import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath,
  faRulerCombined,
} from "@fortawesome/free-solid-svg-icons";
import ImageSlideshow from "./ImageSlideshow"; // Import the slideshow component

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
  return "Price N/A"; // Consistent placeholder
};

const PropertyCard = ({ property, onViewProperty }) => {
  if (!property) return null;

  const details = property.details || {};
  const price = property.price || {};

  // Refined check for valid bathrooms
  let bathroomCount = null;
  if (
    details.bathrooms &&
    details.bathrooms !== "N/A" &&
    details.bathrooms !== "-"
  ) {
    const parsed = parseInt(String(details.bathrooms).match(/\d+/)?.[0], 10);
    if (!isNaN(parsed) && parsed > 0) {
      bathroomCount = parsed;
    }
  }
  const hasValidBathrooms = bathroomCount !== null;

  const hasValidSqft =
    details.sqft && details.sqft !== "N/A" && details.sqft !== "-";

  return (
    // Apply simplified class if needed by CSS
    <div className="property-card simplified">
      {/* Use ImageSlideshow */}
      <div className="property-image">
        {" "}
        {/* Ensure this div has height set in App.css */}
        <ImageSlideshow
          imageUrls={property.image_urls || []}
          altText={property.title}
        />
        {/* Price Overlay */}
        <div className="property-price-overlay">
          {formatDisplayPrice(price.asking)}
        </div>
      </div>

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
          {hasValidBathrooms && (
            <div className="detail-item">
              <FontAwesomeIcon icon={faBath} />
              <span>
                {bathroomCount} {bathroomCount === 1 ? "Bath" : "Baths"}
              </span>
            </div>
          )}
          {hasValidSqft && (
            <div className="detail-item">
              <FontAwesomeIcon icon={faRulerCombined} />
              {/* Keep 'sq ft' if present, otherwise add it */}
              <span>
                {details.sqft.includes("sq ft")
                  ? details.sqft
                  : `${details.sqft} sq ft`}
              </span>
            </div>
          )}
        </div>

        {/* Footer with Source and Button */}
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
