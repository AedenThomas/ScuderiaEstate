import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLocationDot,
  faBed,
  faBath,
  faRulerCombined,
  faClock,
  faBuilding, // Generic icon for amenities
  faTrain,
  faSchool,
  faExclamationTriangle,
  faChartLine,
  faSterlingSign, // Use sterling sign
} from "@fortawesome/free-solid-svg-icons";

// Helper to format price or show placeholder
const formatDisplayPrice = (price) => {
    if (price && price !== 'N/A' && !isNaN(Number(price.toString().replace(/[^0-9.-]+/g,"")))) {
      // Check if it already has £, otherwise add it
      return price.toString().startsWith('£') ? price : `£${Number(price.toString().replace(/[^0-9.-]+/g,"")).toLocaleString()}`;
    }
    return "N/A"; // Consistent placeholder
};

const PropertyCard = ({ property, onViewProperty }) => {
  if (!property) return null; // Handle case where property might be null

  // Default values for potentially missing data
  const details = property.details || {};
  const price = property.price || {};
  const amenities = property.amenities || [];
  const transport = property.transport || [];
  const schools = property.schools || [];

  return (
    <div className="property-card">
      <div className="property-image">
        <img src={property.image || 'https://placehold.co/600x400/e9e9e9/1d1d1d?text=No+Image'} alt={property.title || 'Property Image'} />
      </div>
      <div className="property-content">
        <h3 className="property-title">{property.title || 'Property Listing'}</h3>
        <div className="property-location">
          <FontAwesomeIcon icon={faLocationDot} />
          <span>{property.location || 'Location unknown'}</span>
          {property.postcode && <span className="postcode-card"> ({property.postcode})</span>}
        </div>

        <div className="property-details">
          <div className="detail-item">
            <FontAwesomeIcon icon={faBed} />
            <span>{details.bedrooms || '-'} Beds</span>
          </div>
          <div className="detail-item">
            <FontAwesomeIcon icon={faBath} />
            <span>{details.bathrooms || '-'} Baths</span>
          </div>
          <div className="detail-item">
            <FontAwesomeIcon icon={faRulerCombined} />
            <span>{details.sqft ? `${details.sqft} sqft` : '- sqft'}</span>
          </div>
           {/* Age might not always be relevant or available */}
          {details.age &&
              <div className="detail-item">
                  <FontAwesomeIcon icon={faClock} />
                  <span>{details.age} years old</span>
              </div>
          }
        </div>

        <div className="property-pricing">
          <div className="price-row">
            <span className="price-label">Asking Price:</span>
            <span className="price-value">{formatDisplayPrice(price.asking)}</span>
          </div>
          <div className="price-row">
            <span className="price-label">Est. Value:</span>
            <span className="price-value">{formatDisplayPrice(price.estimated)}</span>
          </div>
          <div className="price-row">
            <span className="price-label">ROI:</span>
            <span className="price-value">{price.roi && price.roi !== 'No result' ? price.roi : 'N/A'}</span>
          </div>
          <div className="price-row">
            <span className="price-label">Rental Yield:</span>
            <span className="price-value">{price.rentalYield && price.rentalYield !== 'No result' ? price.rentalYield : 'N/A'}</span>
          </div>
        </div>

        {/* Show sections only if data exists */}
        {(amenities.length > 0 || transport.length > 0 || schools.length > 0) && (
          <div className="property-sections">
            {amenities.length > 0 && (
              <div className="section">
                <h4>
                  <FontAwesomeIcon icon={faBuilding} /> Amenities
                </h4>
                <ul className="compact-list">
                  {amenities.slice(0, 2).map((amenity, index) => ( // Show only first few
                    <li key={index}><span>{amenity}</span></li>
                  ))}
                  {amenities.length > 2 && <li><span>...</span></li>}
                </ul>
              </div>
            )}

            {transport.length > 0 && (
              <div className="section">
                <h4>
                  <FontAwesomeIcon icon={faTrain} /> Transport
                </h4>
                <ul className="compact-list">
                   {transport.slice(0, 1).map((item, index) => ( // Show only first one
                      <li key={index}><span>{item.name} ({item.distance})</span></li>
                   ))}
                   {transport.length > 1 && <li><span>...</span></li>}
                </ul>
              </div>
            )}

             {schools.length > 0 && (
              <div className="section">
                <h4>
                  <FontAwesomeIcon icon={faSchool} /> Schools
                </h4>
                <ul className="compact-list">
                    {schools.slice(0, 1).map((school, index) => ( // Show only first one
                      <li key={index}><span>{school}</span></li>
                    ))}
                    {schools.length > 1 && <li><span>...</span></li>}
                </ul>
              </div>
             )}
          </div>
        )}

        <div className="property-footer">
          <div className="risk-score">
            <FontAwesomeIcon icon={faExclamationTriangle} />
            <span>Risk: {property.riskScore && property.riskScore !== 'N/A' ? property.riskScore : 'N/A'}</span>
          </div>
          <button className="view-property-btn" onClick={onViewProperty}>
            View Details
          </button>
        </div>
      </div>
    </div>
  );
};

export default PropertyCard;