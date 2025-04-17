// src/App.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Import Components
import HeatmapLayer from "./components/HeatmapLayer";
import PropertyCard from "./components/PropertyCard";
import PropertyDetail from "./components/PropertyDetail";
import LoadingScreen from "./components/LoadingScreen";
// Service functions
import {
  fetchPropertyDataByPostcode,
  formatTransactionData,
  calculatePriceGrowth,
} from "./services/landRegistryService";
import { fetchDemographicData } from "./services/demographicsService";
import { fetchCrimeData } from "./services/crimeService"; // ✅ NEW IMPORT
// Assets & Icons
import logo from './assets/logo.png'; // Adjust path to your logo
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";

// Fix default Leaflet icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

// --- Helper Function for Prediction Input Preparation ---
const preparePredictionInputs = (listing, postcode) => { /* ... keep existing ... */ };

// --- Geocoding Function ---
const getCoordinatesFromPostcode = async (postcode) => { /* ... keep existing ... */ };

// --- MapController Component ---
function MapController({ center, zoom }) { /* ... keep existing ... */ }

// --- Helper to format price for map marker ---
const formatPriceForMarker = (priceString) => { /* ... keep existing ... */ };

// --- Main App Component ---
function App() {
  // State Variables (Keep existing)
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchPostcode, setActiveSearchPostcode] = useState("");
  const [isSearchingLRDemo, setIsSearchingLRDemo] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [view, setView] = useState("listings");
  const [mapCenter, setMapCenter] = useState([54.57, -1.23]);
  const [mapZoom, setMapZoom] = useState(6);
  const [heatmapPoints, setHeatmapPoints] = useState([]);
  const [scrapedListings, setScrapedListings] = useState([]);
  const [isFetchingScraper, setIsFetchingScraper] = useState(false);
  const [scraperError, setScraperError] = useState(null);
  const [isScrapingComplete, setIsScrapingComplete] = useState(false);
  const eventSourceRef = useRef(null);
  const [searchStartTime, setSearchStartTime] = useState(null);

  // --- Derived State for Loading / UI Control (Keep existing) ---
  const showMainLoadingScreen = searchStartTime !== null && scrapedListings.length === 0 && !scraperError && (isFetchingScraper || isSearchingLRDemo);
  const isAnyTaskRunning = isFetchingScraper || isSearchingLRDemo || selectedProperty?.isLoadingPrediction || selectedProperty?.isLoadingLR || selectedProperty?.isLoadingDemo;
  const showPropertyPanel = !!activeSearchPostcode || !!selectedProperty;

  // --- Loading Message (Keep existing) ---
  const getMainLoadingMessage = () => { /* ... keep existing ... */ };

  // --- SSE Handler (Keep existing) ---
  const startScraperStream = useCallback((postcode) => { /* ... keep existing ... */ }, []);
  useEffect(() => { /* ... keep existing cleanup ... */ }, []); // SSE Cleanup


  // --- Search Handler ---
  const handleSearch = useCallback( async (e) => {
      if (e) e.preventDefault();
      const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
      const query = searchQuery.trim();

      if (!query || !postcodeRegex.test(query)) {
        // Reset states... (keep existing resets)
        setActiveSearchPostcode("");
        setScrapedListings([]);
        // ... other resets
        return;
      }

      // Reset states for new search (keep existing resets)
      setIsSearchingLRDemo(true);
      // ... other resets
      setActiveSearchPostcode(query); // !! Makes panel appear
      setSearchStartTime(Date.now());
      // ...

      startScraperStream(query); // Start SSE fetching

      // Data fetching variables
      let fetchedCoordinates = null;
      let landRegistryError = null;
      let demoError = null;
      let crimeSummary = null; // ✅ NEW variable for crime results

      try {
        // 1. Geocode
        fetchedCoordinates = await getCoordinatesFromPostcode(query);
        if (fetchedCoordinates) {
          setMapCenter([fetchedCoordinates.lat, fetchedCoordinates.lng]);
          setMapZoom(15); // Zoom in on successful geocode

           // ✅ 2. Fetch Crime Data (requires lat/lng) - Fetch concurrently with others
           fetchCrimeData(fetchedCoordinates.lat, fetchedCoordinates.lng)
            .then(summary => crimeSummary = summary) // Assign result directly
            .catch(err => console.warn("Crime fetch error:", err)); // Log error but don't block

        } else {
          console.warn("Geocoding failed for search query.");
          // Keep previous map center/zoom if geocoding fails
        }

        // 3. Fetch Land Registry & Demographics (concurrently)
        const landRegistryPromise = fetchPropertyDataByPostcode(query)
            .then(apiData => ({ type: "lr", data: formatTransactionData(apiData) }))
            .catch(err => ({ type: "lr", error: err.message || "Failed to fetch property data." }));
        const demographicsPromise = fetchDemographicData(query)
            .then(demoData => ({ type: "demo", data: demoData }))
            .catch(err => ({ type: "demo", error: err.message || "Failed to fetch demographic data." }));

        // Wait for LR & Demo (Crime fetch might still be running, handled later)
        const [lrResultSettled, demoResultSettled] = await Promise.allSettled([
            landRegistryPromise,
            demographicsPromise
        ]);

        // Process LR Result
        let transactions = [];
        if(lrResultSettled.status === 'fulfilled' && !lrResultSettled.value.error) {
            transactions = lrResultSettled.value.data || [];
        } else if (lrResultSettled.status === 'fulfilled' && lrResultSettled.value.error) {
            landRegistryError = lrResultSettled.value.error;
        } else { // Rejected
            landRegistryError = lrResultSettled.reason?.message || "LR fetch rejected.";
        }

        // Process Demo Result
        let demographicsResult = null;
         if(demoResultSettled.status === 'fulfilled' && !demoResultSettled.value.error) {
            demographicsResult = demoResultSettled.value.data || null;
        } else if (demoResultSettled.status === 'fulfilled' && demoResultSettled.value.error) {
            demoError = demoResultSettled.value.error;
        } else { // Rejected
            demoError = demoResultSettled.reason?.message || "Demo fetch rejected.";
        }

        // --- Wait briefly if crime fetch hasn't finished (optional, simple approach) ---
        // A more robust approach might involve Promise.allSettled on crime too, but this is simpler
        await new Promise(resolve => setTimeout(resolve, 200)); // Give crime fetch a bit more time


        // 4. Build Summary & Set State (Now includes crimeStats)
        if (transactions.length > 0 || demographicsResult) { // Show overview if *any* data is available
             const priceGrowthMetrics = transactions.length > 0 ? calculatePriceGrowth(transactions) : { growth: "N/A", annualizedReturn: "N/A", priceRange: { min: 0, max: 0 } };
             const avgPrice = transactions.length > 0 ? transactions.reduce((sum, t) => sum + t.price, 0) / transactions.length : NaN;
             const locationName = fetchedCoordinates?.town || (transactions.length > 0 ? transactions[0].town : null) || query.toUpperCase();

             const searchSummary = {
                id: `search-${query.replace(/\s/g, "")}`,
                title: `Area Overview: ${query.toUpperCase()}`,
                location: locationName,
                postcode: query.toUpperCase(),
                coordinates: fetchedCoordinates ? [fetchedCoordinates.lat, fetchedCoordinates.lng] : null,
                // Indicate this is an area summary, not a specific listing
                details: { bedrooms: 'N/A', bathrooms: 'N/A', sqft: 'N/A', age: 'N/A', propertyType: 'Area Data' },
                price: {
                    asking: 'N/A',
                    estimated: isNaN(avgPrice) ? 'N/A' : `£${Math.round(avgPrice).toLocaleString()}`,
                    roi: priceGrowthMetrics.annualizedReturn || "N/A", // Use N/A consistently
                    rentalYield: "N/A", // Area summaries don't have yield
                },
                amenities: [], transport: [], schools: [], riskScore: "N/A", // No specific amenities etc. for area
                image: `https://placehold.co/600x400/e0f7fa/00796b?text=${query.toUpperCase()}+Overview`,
                transactionHistory: transactions,
                priceGrowth: priceGrowthMetrics,
                demographicData: demographicsResult, // Can be null if fetch failed
                crimeStats: crimeSummary, // ✅ Add crime summary (can be null)
                // Add flags for easier handling in PropertyDetail
                isAreaSummary: true,
             };
             setSelectedProperty(searchSummary);
             setView("detail"); // Switch to detail view for the summary
             setSearchResults({ success: true }); // Mark search as having yielded *some* result

        } else { // Neither LR nor Demo data available
             setSearchResults({ errorMessage: landRegistryError || demoError || "No Land Registry or Demographic data found for this area." });
             // Keep view as 'listings' (which will be empty)
        }


        // Heatmap Generation (keep existing logic based on 'transactions')
        if (transactions.length > 0 && fetchedCoordinates) { /* ... generate heatmap ... */ }
        else { setHeatmapPoints([]); }

        // Update combined search status/error for LR/Demo/Crime for map panel display
        const combinedError = [landRegistryError, demoError].filter(Boolean).join("; "); // Exclude crime from main status for now
        if (combinedError) setSearchResults({ errorMessage: combinedError || "Error fetching area data." });
        // Success state already set if data was found

      } catch (error) { // Catch errors in the main try block (e.g., geocoding)
        console.error("Search execution error:", error);
        setSearchResults({ errorMessage: `Search failed: ${error.message || "Please try again."}` });
        setHeatmapPoints([]);
      } finally {
        setIsSearchingLRDemo(false); // Stop LR/Demo loading indicator
        // Scraper state is managed by SSE events
      }
    }, [searchQuery, startScraperStream] // Dependencies
  );

  // --- View Detail Handler (Modified to handle area summary) ---
  const handleViewScrapedProperty = useCallback( async (scrapedListing) => {
      if (!activeSearchPostcode) { console.error("Cannot view details without an active search postcode."); return; }
      console.log("Viewing scraped property:", scrapedListing);
      setHeatmapPoints([]);

      const lat = scrapedListing.latitude ? parseFloat(scrapedListing.latitude) : null;
      const lon = scrapedListing.longitude ? parseFloat(scrapedListing.longitude) : null;
      const validCoordinates = lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);

      // Fetch Crime data specifically for this listing's coordinates if available
      let listingCrimeSummary = null;
      if (validCoordinates) {
          try {
              listingCrimeSummary = await fetchCrimeData(lat, lon);
          } catch(err) {
               console.warn("Crime fetch failed for specific listing:", err);
          }
      }

      const initialProperty = {
        id: scrapedListing.id || `scraped-${Date.now()}`,
        title: scrapedListing.address || "Scraped Listing",
        location: scrapedListing.address?.split(",").slice(-2).join(", ").trim() || "Unknown Location",
        postcode: activeSearchPostcode.toUpperCase(), // Use search postcode as context
        coordinates: validCoordinates ? [lat, lon] : null,
        details: { bedrooms: scrapedListing.bedrooms || "N/A", bathrooms: scrapedListing.bathrooms || "N/A", sqft: scrapedListing.square_footage || "N/A", propertyType: scrapedListing.property_type || "N/A", age: "N/A", },
        price: { asking: scrapedListing.price || "N/A", estimated: "Loading...", roi: "Loading...", },
        description: scrapedListing.description || "",
        source: scrapedListing.source || "Rightmove",
        detail_url: scrapedListing.detail_url,
        image_urls: scrapedListing.image_urls || [],
        image: (scrapedListing.image_urls && scrapedListing.image_urls.length > 0) ? scrapedListing.image_urls[0] : "https://placehold.co/600x400/cccccc/1d1d1d?text=Detail+View",
        // Fetch these specifically for the postcode area, not the single listing (standard behaviour)
        transactionHistory: null, priceGrowth: null, demographicData: null,
        crimeStats: listingCrimeSummary, // ✅ Store crime data specific to listing coords (if fetched)
        isLoadingLR: true, isLoadingDemo: true, predictionResults: [], isLoadingPrediction: true, predictionError: null,
        isAreaSummary: false, // Mark as not an area summary
      };

      setSelectedProperty(initialProperty);
      setView("detail");
      if (initialProperty.coordinates) { setMapCenter(initialProperty.coordinates); setMapZoom(17); }
      else if (activeSearchPostcode) { /* ... geocode fallback ... */ }

      // Concurrent fetches for Prediction, LR, Demo for the POSTCODE AREA
      const predictionInputs = preparePredictionInputs(scrapedListing, activeSearchPostcode);
      const predictApiUrl = `${process.env.REACT_APP_API_BASE_URL || "http://localhost:3001"}/api/predict-price`;
      const predictionPromise = fetch(/* ... */).catch(/* ... */); // Keep prediction fetch
      const lrPromise = fetchPropertyDataByPostcode(activeSearchPostcode).then(formatTransactionData).catch(/* ... */); // Fetch area LR
      const demoPromise = fetchDemographicData(activeSearchPostcode).catch(/* ... */); // Fetch area Demo

      const [predictionResult, lrResult, demoResult] = await Promise.allSettled([predictionPromise, lrPromise, demoPromise]);

      // Update selectedProperty state (keep existing logic for processing results)
       setSelectedProperty((prev) => {
           if (!prev || prev.id !== initialProperty.id) return prev; // Ensure correct property
           const updates = { ...prev };
           // Process Prediction, LR, Demo results and update loading flags...
           // (Keep existing logic here)
           return updates;
       });
    }, [activeSearchPostcode]
  );


  // --- Back to Listings Handler (Keep existing) ---
  const handleBackToListings = useCallback(() => { /* ... keep existing ... */ }, [activeSearchPostcode]);


  // --- Render ---
  return (
    <div className="App">
      {/* Main Loading Screen */}
      <LoadingScreen isVisible={showMainLoadingScreen} message={getMainLoadingMessage()} logoSrc={logo} />

      {/* Main App Container */}
      <div className={`app-container ${showPropertyPanel ? 'show-panel' : 'hide-panel'}`}>

        {/* Left Panel: Map and Search */}
        <div className={`map-panel ${!showPropertyPanel ? 'full-width' : ''}`}>
           {/* Search Bar */}
           <form className="search-bar" onSubmit={handleSearch}>
                <input type="text" placeholder="Enter UK Postcode..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} disabled={isAnyTaskRunning} />
                <button type="submit" disabled={isAnyTaskRunning}>{isAnyTaskRunning ? "Searching..." : "Search"}</button>
           </form>
           {/* Status Messages */}
           <div className="search-status-container">{/* ... keep existing status messages ... */}</div>
           {/* Map */}
           <MapContainer center={mapCenter} zoom={mapZoom} className="map-container" scrollWheelZoom={true}>
             {/* ... TileLayer, MapController, HeatmapLayer ... */}
             {/* Scraped Listing Markers */}
             {view === "listings" && scrapedListings.map((listing, index) => { /* ... keep existing ... */ })}
             {/* Selected Property Marker (handles both listing and area summary) */}
             {view === "detail" && selectedProperty && selectedProperty.coordinates && (
                 <Marker key={`selected-${selectedProperty.id}`} position={selectedProperty.coordinates}>
                    <Popup><b>{selectedProperty.title}</b><br />{selectedProperty.price?.estimated !== 'N/A' ? `Avg Price: ${selectedProperty.price.estimated}` : (selectedProperty.price?.asking || 'N/A')}</Popup>
                 </Marker>
             )}
           </MapContainer>
        </div> {/* End map-panel */}

        {/* Right Panel: Conditionally Rendered */}
        {showPropertyPanel && (
          <div className="property-panel">
            {view === "detail" && selectedProperty ? (
              // Detail View (handles both listing and area summary)
              <PropertyDetail
                property={selectedProperty}
                // Pass loading states based on *selectedProperty* if available
                isLoadingLR={selectedProperty.isLoadingLR ?? false}
                isLoadingDemo={selectedProperty.isLoadingDemo ?? false}
                predictionResults={selectedProperty.predictionResults}
                isLoadingPrediction={selectedProperty.isLoadingPrediction ?? false}
                predictionError={selectedProperty.predictionError}
                // Pass general area demo data if available (used by detail view logic)
                demographicData={selectedProperty.demographicData}
                // Note: Crime data is inside selectedProperty.crimeStats
                onBackToListings={handleBackToListings}
              />
            ) : (
              // Listings View (Only shown after search triggered panel visibility)
              <>
                <div className="listings-section">
                  <h2>
                    {(isFetchingScraper && !isScrapingComplete)
                        ? `Searching listings for ${activeSearchPostcode}...`
                        : `Listings near ${activeSearchPostcode} (${scrapedListings.length})`}
                    {isFetchingScraper && !isScrapingComplete && scrapedListings.length > 0 && ( <FontAwesomeIcon icon={faSpinner} spin style={{ marginLeft: '10px', fontSize: '0.9em', opacity: 0.7 }} /> )}
                  </h2>
                  {/* Display Listings */}
                  {scrapedListings.length > 0 && (
                    <div className="property-list"> {scrapedListings.map((listing, index) => ( <PropertyCard key={/*...*/} property={/*...*/} onViewProperty={() => handleViewScrapedProperty(listing)} /> ))} </div>
                  )}
                  {/* No Results Message */}
                  {scrapedListings.length === 0 && !isFetchingScraper && isScrapingComplete && activeSearchPostcode && !scraperError && ( <div className="no-results-message"><p>No listings found for {activeSearchPostcode}. Try a nearby postcode.</p></div> )}
                </div>
              </>
            )}
          </div>
        )} {/* End Conditional Rendering of property-panel */}

      </div> {/* End app-container */}
    </div> // End App
  );
}

export default App;