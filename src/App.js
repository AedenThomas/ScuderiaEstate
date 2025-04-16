import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

import HeatmapLayer from "./components/HeatmapLayer";
import PropertyCard from "./components/PropertyCard";
import PropertyDetail from "./components/PropertyDetail";

import {
  fetchPropertyDataByPostcode,
  formatTransactionData,
  calculatePriceGrowth,
} from "./services/landRegistryService";
import { fetchDemographicData } from "./services/demographicsService";
import { fetchCrimeData } from "./services/crimeService"; // ✅ NEW IMPORT

// Fix Leaflet marker icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

// === Geocode Function ===
const getCoordinatesFromPostcode = async (postcode) => {
  if (!postcode || typeof postcode !== "string") return null;

  const formattedPostcode = encodeURIComponent(postcode.trim().toUpperCase());
  const apiUrl = `https://nominatim.openstreetmap.org/search?postalcode=${formattedPostcode}&countrycodes=gb&format=json&limit=1&addressdetails=1`;

  try {
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Failed geocoding request.");
    const data = await response.json();
    if (data.length === 0) return null;

    const { lat, lon, address } = data[0];
    const town = address?.city || address?.town || address?.village || address?.county || null;
    return { lat: parseFloat(lat), lng: parseFloat(lon), town };
  } catch (error) {
    console.error("Geocode error:", error);
    return null;
  }
};

// === Map Centering Component ===
function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center?.length === 2 && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, zoom || map.getZoom());
    }
  }, [center, zoom, map]);
  return null;
}

// === MAIN APP COMPONENT ===
function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [view, setView] = useState("listings");
  const [mapCenter, setMapCenter] = useState([51.505, -0.09]);
  const [mapZoom, setMapZoom] = useState(12);
  const [heatmapPoints, setHeatmapPoints] = useState([]);
  const [demographicData, setDemographicData] = useState(null);
  const [isFetchingDemographics, setIsFetchingDemographics] = useState(false);
  const [demographicsError, setDemographicsError] = useState(null);

  const properties = [
    {
      id: 1,
      title: "Modern Apartment in Chelsea",
      location: "Chelsea, London",
      postcode: "SW3 5RZ",
      coordinates: [51.49, -0.17],
      details: { bedrooms: 2, bathrooms: 2, sqft: 950, age: 5 },
      price: { asking: "£850,000", estimated: "£875,000", roi: "No result", rentalYield: "3.4%" },
      amenities: ["Gym", "Concierge", "Parking"],
      transport: [{ name: "Sloane Square Station", distance: "0.3mi" }],
      schools: ["Chelsea Primary School"],
      riskScore: "2/5",
      image: "https://placehold.co/600x400/cccccc/1d1d1d?text=Chelsea+Apt",
    },
    {
      id: 2,
      title: "Stylish Loft in Kensington",
      location: "Kensington, London",
      postcode: "W8 7BU",
      coordinates: [51.5, -0.19],
      details: { bedrooms: 3, bathrooms: 3, sqft: 1100, age: 3 },
      price: { asking: "£950,000", estimated: "£1,000,000", roi: "No result", rentalYield: "4.2%" },
      amenities: ["Fitness Center", "Doorman", "Garage"],
      transport: [{ name: "Kensington High St Station", distance: "0.2mi" }],
      schools: ["Kensington Primary"],
      riskScore: "1/5",
      image: "https://placehold.co/600x400/cccccc/1d1d1d?text=Kensington+Loft",
    },
  ];

  // === HANDLE SEARCH ===
  const handleSearch = useCallback(async (e) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;

    if (!query || !postcodeRegex.test(query)) {
      setSearchResults({ errorMessage: "Please enter a valid UK postcode." });
      return;
    }

    setIsSearching(true);
    setIsFetchingDemographics(true);
    setSearchResults(null);
    setSelectedProperty(null);
    setView("listings");
    setHeatmapPoints([]);
    setDemographicData(null);
    setDemographicsError(null);

    let fetchedCoordinates = null;
    let landRegistryTransactions = [];
    let landRegistryError = null;
    let fetchedDemographics = null;
    let demoError = null;
    let crimeSummary = null; // ✅ NEW

    try {
      // 1. Geocode
      fetchedCoordinates = await getCoordinatesFromPostcode(query);
      if (fetchedCoordinates) {
        setMapCenter([fetchedCoordinates.lat, fetchedCoordinates.lng]);
        setMapZoom(15);

        // ✅ 2. Fetch Crime Data (early)
        try {
          crimeSummary = await fetchCrimeData(fetchedCoordinates.lat, fetchedCoordinates.lng);
        } catch (err) {
          console.warn("Crime fetch error:", err);
        }
      }

      // 3. Fetch Land Registry + Demographics in parallel
      const landRegistryPromise = fetchPropertyDataByPostcode(query)
        .then(apiData => formatTransactionData(apiData))
        .catch(err => {
          landRegistryError = err.message;
          return [];
        });

      const demographicsPromise = fetchDemographicData(query)
        .catch(err => {
          demoError = err.message;
          return null;
        });

      const [transactions, demographicsResult] = await Promise.all([
        landRegistryPromise,
        demographicsPromise,
      ]);

      landRegistryTransactions = transactions;
      fetchedDemographics = demographicsResult;
      setDemographicData(fetchedDemographics);
      setDemographicsError(demoError);

      // 4. Build summary
      if (landRegistryTransactions.length > 0) {
        const priceGrowthMetrics = calculatePriceGrowth(landRegistryTransactions);
        const avgPrice = landRegistryTransactions.reduce((sum, t) => sum + t.price, 0) / landRegistryTransactions.length;

        const latestTransaction = landRegistryTransactions[0];
        const locationName = fetchedCoordinates?.town || latestTransaction.town || query.toUpperCase();

        const searchSummary = {
          id: `search-${query.replace(/\s/g, "")}`,
          title: `Area Overview: ${query.toUpperCase()}`,
          location: locationName,
          postcode: query.toUpperCase(),
          coordinates: [fetchedCoordinates.lat, fetchedCoordinates.lng],
          details: { bedrooms: 'N/A', bathrooms: 'N/A', sqft: 'N/A', age: 'N/A' },
          price: {
            asking: 'N/A',
            estimated: `£${Math.round(avgPrice).toLocaleString()}`,
            roi: priceGrowthMetrics.annualizedReturn,
            rentalYield: "No result",
          },
          amenities: [], transport: [], schools: [],
          riskScore: "No result",
          image: `https://placehold.co/600x400/e0f7fa/00796b?text=${query.toUpperCase()}+Overview`,
          transactionHistory: landRegistryTransactions,
          priceGrowth: priceGrowthMetrics,
          demographicData: fetchedDemographics,
          crimeStats: crimeSummary, // ✅ New field
        };

        setSelectedProperty(searchSummary);
        setView("detail");
        setSearchResults({ success: true });
      } else if (fetchedDemographics) {
        const demoSummary = {
          id: `search-${query.replace(/\s/g, "")}`,
          title: `Area Overview: ${query.toUpperCase()}`,
          location: fetchedCoordinates?.town || query.toUpperCase(),
          postcode: query.toUpperCase(),
          coordinates: fetchedCoordinates ? [fetchedCoordinates.lat, fetchedCoordinates.lng] : null,
          details: { bedrooms: 'N/A', bathrooms: 'N/A', sqft: 'N/A', age: 'N/A' },
          price: { asking: 'N/A', estimated: 'N/A', roi: 'N/A', rentalYield: 'N/A' },
          amenities: [], transport: [], schools: [],
          riskScore: "No result",
          image: `https://placehold.co/600x400/e0f7fa/00796b?text=${query.toUpperCase()}+Overview`,
          transactionHistory: [],
          priceGrowth: { growth: "No result", annualizedReturn: "No result" },
          demographicData: fetchedDemographics,
          crimeStats: crimeSummary, // ✅ Include in fallback too
        };

        setSelectedProperty(demoSummary);
        setView("detail");
        setSearchResults(null);
      } else {
        setSearchResults({ errorMessage: landRegistryError || "No data found." });
      }
    } catch (error) {
      console.error("Search execution error:", error);
      setSearchResults({ errorMessage: `Search failed: ${error.message}` });
    } finally {
      setIsSearching(false);
      setIsFetchingDemographics(false);
    }
  }, [searchQuery]);

  const handleViewProperty = useCallback((property) => {
    setSelectedProperty(property);
    setView("detail");
    setHeatmapPoints([]);
    setDemographicData(null);
    setDemographicsError(null);
    if (property.coordinates) {
      setMapCenter(property.coordinates);
      setMapZoom(16);
    }
  }, []);

  const handleBackToListings = useCallback(() => {
    setSelectedProperty(null);
    setView("listings");
    setSearchResults(null);
    setHeatmapPoints([]);
    setDemographicData(null);
    setDemographicsError(null);
  }, []);

  return (
    <div className="App">
      <div className="app-container">
        <div className="map-panel">
          <form className="search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Enter UK Postcode (e.g., SW1A 0AA)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isSearching || isFetchingDemographics}
            />
            <button type="submit" disabled={isSearching || isFetchingDemographics}>
              {(isSearching || isFetchingDemographics) ? "Searching..." : "Search"}
            </button>
          </form>

          {view === 'listings' && searchResults?.errorMessage && (
            <div className="search-status error-message">
              <p>{searchResults.errorMessage}</p>
            </div>
          )}

          {view === 'listings' && demographicsError && !searchResults?.errorMessage && (
            <div className="search-status error-message">
              <p>Demographics: {demographicsError}</p>
            </div>
          )}

          {(isSearching || isFetchingDemographics) && (
            <div className="search-status info-message">
              <p>Loading data... {(isSearching && isFetchingDemographics) ? '(Property & Demographics)' : (isSearching ? '(Property)' : '(Demographics)')}</p>
            </div>
          )}

          <MapContainer center={mapCenter} zoom={mapZoom} className="map-container" scrollWheelZoom={true}>
            <TileLayer
              attribution='© OpenStreetMap contributors © CARTO'
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />
            <MapController center={mapCenter} zoom={mapZoom} />
            {heatmapPoints?.length > 0 && <HeatmapLayer data={heatmapPoints} />}
            {view === 'listings' && properties.map((property) => (
              property.coordinates && (
                <Marker key={`featured-${property.id}`} position={property.coordinates}>
                  <Popup>
                    <b>{property.title}</b><br />
                    {property.price?.asking || 'Price N/A'}<br />
                    <button onClick={() => handleViewProperty(property)} className="popup-button">View Details</button>
                  </Popup>
                </Marker>
              )
            ))}
            {view === 'detail' && selectedProperty?.coordinates && (
              <Marker key={selectedProperty.id} position={selectedProperty.coordinates}>
                <Popup>
                  <b>{selectedProperty.title}</b><br />
                  {selectedProperty.price?.estimated !== 'N/A'
                    ? `Avg Price: ${selectedProperty.price.estimated}`
                    : (selectedProperty.price?.asking || '')}
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>

        <div className="property-panel">
          {view === 'detail' && selectedProperty ? (
            <PropertyDetail
              property={selectedProperty}
              demographicData={selectedProperty.demographicData || demographicData}
              isFetchingDemographics={isFetchingDemographics}
              demographicsError={demographicsError}
              onBackToListings={handleBackToListings}
            />
          ) : (
            <>
              <h2>Featured Properties</h2>
              {properties.length === 0 && <p>No featured properties to display.</p>}
              <div className="property-list">
                {properties.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    onViewProperty={() => handleViewProperty(property)}
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
