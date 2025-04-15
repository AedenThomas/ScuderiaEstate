import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

import HeatmapLayer from "./components/HeatmapLayer";
import PropertyCard from "./components/PropertyCard";
// *** Make sure PropertyDetail is imported ***
import PropertyDetail from "./components/PropertyDetail";
import {
  fetchPropertyDataByPostcode as fetchLandRegistryData,
  formatTransactionData,
  calculatePriceGrowth
} from "./services/landRegistryService";
import { fetchDemographicData } from "./services/demographicsService";
import { fetchStreetDataByPostcode } from "./services/streetDataService";

// Fix default Leaflet icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Geocoding Function (keep as is)
const getCoordinatesFromPostcode = async (postcode) => {
    if (!postcode || typeof postcode !== 'string') {
      console.error("Invalid postcode provided for geocoding:", postcode);
      return null;
    }
    const formattedPostcode = encodeURIComponent(postcode.trim().toUpperCase());
    const apiUrl = `https://nominatim.openstreetmap.org/search?postalcode=${formattedPostcode}&countrycodes=gb&format=json&limit=1&addressdetails=1`;

    try {
      console.log(`Geocoding postcode: ${postcode} using URL: ${apiUrl}`);
      const response = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log("Geocoding response:", data);

      if (data && data.length > 0) {
        const { lat, lon, address } = data[0];
        const town = address?.city || address?.town || address?.village || address?.county || null;
        return { lat: parseFloat(lat), lng: parseFloat(lon), town: town };
      } else {
        console.warn(`No coordinates found for postcode: ${postcode}`);
        return null;
      }
    } catch (error) {
      console.error("Error fetching coordinates from Nominatim:", error);
      return null;
    }
};


// MapController Component (keep as is)
function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center && Array.isArray(center) && center.length === 2 && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, zoom || map.getZoom());
    }
  }, [center, zoom, map]);
  return null;
}

// --- Main App Component ---
function App() {
    const [searchQuery, setSearchQuery] = useState("");
    const [currentSearchPostcode, setCurrentSearchPostcode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [searchError, setSearchError] = useState(null);

    // Data States
    const [featuredProperties] = useState([
        {
         id: 1, title: "Modern Apartment in Chelsea", location: "Chelsea, London", postcode: "SW3 5RZ", coordinates: [51.49, -0.17], details: { bedrooms: 2, bathrooms: 2, sqft: 950, age: 5 }, price: { asking: "£850,000", estimated: "£875,000", roi: "N/A", rentalYield: "3.4%" }, amenities: ["Gym", "Concierge", "Parking"], transport: [{ name: "Sloane Square Station", distance: "0.3mi" }], schools: ["Chelsea Primary School"], riskScore: "2/5", image: "https://placehold.co/600x400/cccccc/1d1d1d?text=Chelsea+Apt", dataSource: 'featured' // Add dataSource
        },
        {
         id: 2, title: "Stylish Loft in Kensington", location: "Kensington, London", postcode: "W8 7BU", coordinates: [51.5, -0.19], details: { bedrooms: 3, bathrooms: 3, sqft: 1100, age: 3 }, price: { asking: "£950,000", estimated: "£1,000,000", roi: "N/A", rentalYield: "4.2%" }, amenities: ["Fitness Center", "Doorman", "Garage"], transport: [{ name: "Kensington High St Station", distance: "0.2mi" }], schools: ["Kensington Primary"], riskScore: "1/5", image: "https://placehold.co/600x400/cccccc/1d1d1d?text=Kensington+Loft", dataSource: 'featured' // Add dataSource
        },
    ]);
    const [streetProperties, setStreetProperties] = useState([]);
    const [landRegistryTransactions, setLandRegistryTransactions] = useState([]); // Store raw transactions
    const [landRegistrySummary, setLandRegistrySummary] = useState(null);
    const [demographicData, setDemographicData] = useState(null); // Holds { postcode, geoCodes, demographics, fetchErrors }
    const [selectedProperty, setSelectedProperty] = useState(null); // Can be featured or Street Data item

    // UI State
    const [view, setView] = useState("featuredListings"); // 'featuredListings', 'streetDataListings', 'detail'
    const [mapCenter, setMapCenter] = useState([51.505, -0.09]);
    const [mapZoom, setMapZoom] = useState(12);
    const [heatmapPoints, setHeatmapPoints] = useState([]);

  // --- Search Handler ---
  const handleSearch = useCallback(async (e) => {
    if (e) e.preventDefault();
    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
    const query = searchQuery.trim();
    if (!query || !postcodeRegex.test(query)) { setSearchError("Please enter a valid UK postcode."); return; }

    setIsLoading(true);
    setSearchError(null);
    setSelectedProperty(null);
    setStreetProperties([]);
    setLandRegistryTransactions([]); // Clear raw transactions
    setLandRegistrySummary(null);
    setDemographicData(null);
    setHeatmapPoints([]);
    setCurrentSearchPostcode(query.toUpperCase());
    setView("featuredListings");

    let initialMapCenter = [51.505, -0.09];
    let initialMapZoom = 12;
    let fetchedCoordinates = null;
    let landRegistryError = null, demoError = null, streetDataError = null;
    let localSearchError = null;

    try {
        // 1. Geocode
        fetchedCoordinates = await getCoordinatesFromPostcode(query);
        if (fetchedCoordinates) {
            initialMapCenter = [fetchedCoordinates.lat, fetchedCoordinates.lng];
            initialMapZoom = 15;
            setMapCenter(initialMapCenter);
            setMapZoom(initialMapZoom);
        } else {
             console.warn("Geocoding failed for search.");
             setMapCenter(initialMapCenter); setMapZoom(initialMapZoom);
        }

        // 2. Fetch Data
        const streetDataPromise = fetchStreetDataByPostcode(query, 'basic', 25).catch(err => { console.error("Street Data Fetch Error:", err); streetDataError = err.message || "Failed to fetch Street Data."; return null; });
        const landRegistryPromise = fetchLandRegistryData(query).then(apiData => formatTransactionData(apiData)).catch(err => { console.error("Land Registry Fetch/Format Error:", err); landRegistryError = err.message || "Failed to fetch Land Registry."; return []; });
        const demographicsPromise = fetchDemographicData(query).catch(err => { console.error("Demographics Fetch Error:", err); demoError = err.message || "Failed to fetch demographics."; return null; });

        const [streetDataResult, lrTransactions, demographicsResult] = await Promise.all([streetDataPromise, landRegistryPromise, demographicsPromise]);

        // 3. Process Results
        let hasStreetData = false, hasLandRegistryData = false;

        // Street Data
        if (streetDataResult?.data?.length > 0) {
            console.log(`Found ${streetDataResult.data.length} properties from Street Data.`);
            setStreetProperties(streetDataResult.data.map(p => ({ ...p, dataSource: 'streetData' }))); // Add dataSource flag
            setView("streetDataListings");
            hasStreetData = true;
            // Map Bounds Calculation
            try {
                 const bounds = L.latLngBounds(); let validCoordsCount = 0;
                 streetDataResult.data.forEach(prop => { const coords = prop.attributes?.location?.coordinates; if (coords?.latitude && coords?.longitude) { bounds.extend([coords.latitude, coords.longitude]); validCoordsCount++; } });
                 if (validCoordsCount > 0 && bounds.isValid()) { console.log("Calculated valid bounds."); setMapCenter(bounds.getCenter()); setMapZoom(initialMapZoom); }
                 else { setMapCenter(initialMapCenter); setMapZoom(initialMapZoom); }
            } catch (boundsError) { console.error("Bounds Error:", boundsError); setMapCenter(initialMapCenter); setMapZoom(initialMapZoom); }
        } else {
             console.log("No properties found via Street Data or error.");
             if (streetDataError) localSearchError = streetDataError;
        }

        // Land Registry
        if (lrTransactions.length > 0) {
            hasLandRegistryData = true;
            setLandRegistryTransactions(lrTransactions); // Store raw transactions
            // Heatmap
            if (fetchedCoordinates) {
                const prices = lrTransactions.map(t => t.price); const minPrice = Math.min(...prices); const maxPrice = Math.max(...prices); const priceRange = maxPrice - minPrice;
                const points = lrTransactions.map(t => { let intensity = priceRange > 0 ? 0.1 + 0.9 * ((t.price - minPrice) / priceRange) : 0.5; intensity = Math.max(0.1, Math.min(1.0, intensity)); const randomOffsetLat = (Math.random() - 0.5) * 0.004; const randomOffsetLng = (Math.random() - 0.5) * 0.004; return [fetchedCoordinates.lat + randomOffsetLat, fetchedCoordinates.lng + randomOffsetLng, intensity]; });
                setHeatmapPoints(points);
            } else { setHeatmapPoints([]); }
            // Summary
            const priceGrowthMetrics = calculatePriceGrowth(lrTransactions);
            const averagePrice = lrTransactions.reduce((sum, t) => sum + t.price, 0) / lrTransactions.length;
            const latestTransaction = lrTransactions[0];
            const locationName = fetchedCoordinates?.town || latestTransaction.town || query.toUpperCase();
            const summary = { type: 'landRegistrySummary', title: `Land Registry Overview: ${query.toUpperCase()}`, location: locationName, averagePrice: `£${Math.round(averagePrice).toLocaleString()}`, priceGrowth: priceGrowthMetrics, transactionCount: lrTransactions.length };
            setLandRegistrySummary(summary);
        } else {
            console.log("No Land Registry data or error.");
            setHeatmapPoints([]); setLandRegistrySummary(null); setLandRegistryTransactions([]);
            if (landRegistryError && !localSearchError) console.warn("LR Error:", landRegistryError);
        }

        // Demographics
        if (demographicsResult) { setDemographicData(demographicsResult); }
        else { setDemographicData(null); if (demoError && !localSearchError) console.warn("Demo Error:", demoError); }

        // Final Error / View Check
        if (localSearchError) { setSearchError(localSearchError); setView('featuredListings'); }
        else if (!hasStreetData && !hasLandRegistryData) { setSearchError(`No property or transaction data found for ${query.toUpperCase()}.`); setView('featuredListings'); }
        // If only LR data exists, we might want a dedicated view, but for now, featured is fine.
        else if (!hasStreetData && hasLandRegistryData) { setView('featuredListings'); /* Or implement LR view */ }
        // If hasStreetData, view is already 'streetDataListings'

    } catch (error) {
      console.error("Overall search error:", error);
      setSearchError(`Search failed: ${error.message || 'Please try again.'}`);
      setView('featuredListings');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);


  // --- View Handler for Street Data Properties ---
  // *** UPDATED to set view to 'detail' ***
  const handleViewStreetProperty = useCallback((property) => {
      console.log("View details requested for Street Group ID:", property.id);
      setSelectedProperty(property); // Set the clicked Street Data property

      // Center map on the selected property
      if (property.attributes?.location?.coordinates) {
          const { latitude, longitude } = property.attributes.location.coordinates;
          setMapCenter([latitude, longitude]);
          setMapZoom(17); // Zoom closer
      }
      // Clear heatmap when focusing on one property? Optional.
      // setHeatmapPoints([]);

      setView("detail"); // <<< SWITCH TO DETAIL VIEW
  }, []); // No dependencies needed currently


    const handleBackToListings = useCallback(() => {
        setSelectedProperty(null);
        // *** Decide where to go back TO ***
        // If streetProperties has data, go back to that list, otherwise featured
        if (streetProperties.length > 0 && currentSearchPostcode) {
             setView("streetDataListings");
             // Maybe recenter map on postcode area?
             // Optional: Refetch geocode if needed or use stored initialMapCenter/Zoom
             // For simplicity, let's keep the map as is for now.
        } else {
             setView("featuredListings");
             // Clear search context if going back to featured
             setStreetProperties([]);
             setSearchError(null);
             setHeatmapPoints([]);
             setLandRegistrySummary(null);
             setLandRegistryTransactions([]);
             setDemographicData(null);
             setCurrentSearchPostcode("");
             setMapCenter([51.505, -0.09]); // Reset map view
             setMapZoom(12);
        }

    }, [streetProperties, currentSearchPostcode]); // Dependencies


  // --- Render ---
  return (
    <div className="App">
      <div className="app-container">
        {/* Left Panel */}
        <div className="map-panel">
          <form className="search-bar" onSubmit={handleSearch}>
            <input
              type="text" placeholder="Enter UK Postcode (e.g., SW1A 0AA)"
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} disabled={isLoading}
            />
            <button type="submit" disabled={isLoading}>{isLoading ? "Searching..." : "Search"}</button>
          </form>

          {/* Status/Error Display */}
          {isLoading && <div className="search-status info-message"><p>Loading data for {searchQuery.toUpperCase()}...</p></div>}
          {searchError && !isLoading && <div className="search-status error-message"><p>{searchError}</p></div>}
          {view === 'streetDataListings' && !isLoading && !searchError && (
            <div className="search-status info-message">
              <p>Showing {streetProperties.length} properties found near {currentSearchPostcode}.</p>
              {/* Keep LR/Demo summary? Optional */}
              {landRegistrySummary && <p>LR: {landRegistrySummary.transactionCount} transactions. Avg Price: {landRegistrySummary.averagePrice}.</p>}
              {demographicData && <p>Demographic data loaded.</p>}
            </div>
          )}

          <MapContainer center={mapCenter} zoom={mapZoom} className="map-container" scrollWheelZoom={true}>
            <TileLayer attribution='...' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            <MapController center={mapCenter} zoom={mapZoom} />
            {heatmapPoints?.length > 0 && view !== 'detail' && <HeatmapLayer data={heatmapPoints} />}

            {/* Featured Markers */}
            {view === 'featuredListings' && featuredProperties.map((property) => (
              property.coordinates &&
              <Marker key={`featured-${property.id}`} position={property.coordinates}>
                <Popup><b>{property.title}</b><br/>{property.price?.asking}<br/><button onClick={() => { setSelectedProperty(property); setView('detail'); setMapCenter(property.coordinates); setMapZoom(16); }} className="popup-button">View Details</button></Popup>
              </Marker>
            ))}

            {/* Street Data Markers */}
            {/* Show markers even when view is 'detail' if they came from streetData? */}
            {(view === 'streetDataListings' || (view === 'detail' && selectedProperty?.dataSource === 'streetData')) &&
              streetProperties.map((property) => {
                const coords = property.attributes?.location?.coordinates;
                const getAttribute = (prop, path) => path.split('.').reduce((o, k) => (o && o[k] != null) ? o[k] : null, prop.attributes);
                if (coords?.latitude && coords?.longitude) {
                    // Highlight the selected marker
                    const isSelected = selectedProperty && selectedProperty.id === property.id;
                    // You might need a custom icon or logic here to visually differentiate
                    return (
                        <Marker key={property.id} position={[coords.latitude, coords.longitude]} /* icon={isSelected ? highlightedIcon : defaultIcon} */>
                            <Popup>
                                <b>{getAttribute(property, 'address.street_group_format.address_lines') || 'Address N/A'}</b><br/>
                                Postcode: {getAttribute(property, 'address.street_group_format.postcode') || 'N/A'}<br/>
                                Type: {getAttribute(property, 'property_type.value') || 'N/A'} <br/>
                                {/* Change button text based on view state */}
                                <button onClick={() => handleViewStreetProperty(property)} className="popup-button">
                                    {view === 'detail' && isSelected ? 'Map Focused' : 'View Area Data'}
                                </button>
                            </Popup>
                        </Marker>
                    );
                }
                return null;
            })}

             {/* Selected Property Marker (for Detail View - specific marker if needed) */}
             {/* This might be redundant if the marker is already shown above */}
             {/*
             {view === 'detail' && selectedProperty?.coordinates && selectedProperty?.dataSource === 'featured' && (
               <Marker key={selectedProperty.id} position={selectedProperty.coordinates}>
                 <Popup><b>{selectedProperty.title || 'Selected Property'}</b></Popup>
               </Marker>
             )}
             */}

          </MapContainer>
        </div>

        {/* --- Right Panel --- */}
        <div className="property-panel">
          {view === 'detail' && selectedProperty ? (
            // *** Pass AREA level data to PropertyDetail ***
            <PropertyDetail
              property={selectedProperty} // The specific clicked property (featured or streetData)
              demographicData={demographicData} // Area demographics
              landRegistryTransactions={landRegistryTransactions} // Area transactions
              // Pass summary too if needed by PropertyDetail
              landRegistrySummary={landRegistrySummary}
              onBackToListings={handleBackToListings}
            />
          ) : view === 'streetDataListings' ? (
            <>
              <h2>Properties near {currentSearchPostcode}</h2>
              <div className="property-list">
                {streetProperties.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    dataSource="streetData"
                    // *** Use the updated handler ***
                    onViewProperty={() => handleViewStreetProperty(property)}
                  />
                ))}
              </div>
            </>
          ) : (
            // Default Featured Listings View
            <>
              <h2>Featured Properties</h2>
              <div className="property-list">
                {featuredProperties.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    dataSource="featured"
                    onViewProperty={() => {
                      setSelectedProperty(property);
                      setView('detail');
                      if (property.coordinates) {
                        setMapCenter(property.coordinates);
                        setMapZoom(16);
                      }
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;