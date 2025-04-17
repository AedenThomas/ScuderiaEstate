// src/App.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet"; // <-- Keep L import

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
// Assets & Icons
import logo from "./assets/logo.png"; // Adjust path to your logo
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
const preparePredictionInputs = (listing, postcode) => {
  const inputs = {
    postcode: postcode || "N/A",
    propertytype: "Terraced",
    duration: "Freehold",
    numberrooms: 3,
    tfarea: 70,
    property_age: 20,
  };

  const typeMap = {
    detached: "Detached",
    "semi-detached": "Semi-Detached",
    terraced: "Terraced",
    "end of terrace": "Terraced",
    flat: "Flats",
    apartment: "Flats",
    maisonette: "Flats",
    bungalow: "Detached",
    studio: "Flats",
  };
  if (listing.property_type && typeof listing.property_type === "string") {
    const lowerType = listing.property_type.toLowerCase().trim();
    inputs.propertytype = typeMap[lowerType] || "Terraced";
  }

  inputs.duration = inputs.propertytype === "Flats" ? "Leasehold" : "Freehold";

  if (
    listing.bedrooms &&
    (typeof listing.bedrooms === "string" ||
      typeof listing.bedrooms === "number")
  ) {
    const bedString = String(listing.bedrooms);
    const numMatch = bedString.match(/\d+/);
    if (numMatch) inputs.numberrooms = parseInt(numMatch[0], 10);
  }
  if (inputs.numberrooms < 1) inputs.numberrooms = 1;

  if (
    listing.square_footage &&
    typeof listing.square_footage === "string" &&
    listing.square_footage !== "N/A"
  ) {
    const sqftText = listing.square_footage.replace(/,/g, "");
    const sqftMatch = sqftText.match(/(\d+(\.\d+)?)\s*sq\s*ft/i);
    const sqmMatch = sqftText.match(/(\d+(\.\d+)?)\s*(?:m²|sqm|sq\.?m)/i);

    if (sqmMatch) inputs.tfarea = parseFloat(sqmMatch[1]);
    else if (sqftMatch)
      inputs.tfarea = Math.round(parseFloat(sqftMatch[1]) / 10.764);
    else {
      const numMatch = sqftText.match(/^\d+(\.\d+)?$/);
      if (numMatch) inputs.tfarea = parseFloat(numMatch[0]);
    }
  }
  if (inputs.tfarea <= 0) inputs.tfarea = 70;

  inputs.property_age = 20; // Default age
  return inputs;
};

// --- Geocoding Function ---
const getCoordinatesFromPostcode = async (postcode) => {
  if (!postcode || typeof postcode !== "string") return null;
  const formattedPostcode = encodeURIComponent(postcode.trim().toUpperCase());
  const apiUrl = `https://nominatim.openstreetmap.org/search?postalcode=${formattedPostcode}&countrycodes=gb&format=json&limit=1&addressdetails=1`;
  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Geocoding API error: ${response.status}`);
    const data = await response.json();
    if (data && data.length > 0) {
      const { lat, lon, address } = data[0];
      const town =
        address?.city ||
        address?.town ||
        address?.village ||
        address?.county ||
        address?.state ||
        null;
      return { lat: parseFloat(lat), lng: parseFloat(lon), town: town };
    } else {
      console.warn(`No coordinates found for postcode: ${postcode}`);
      return null;
    }
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
};

// --- MapController Component ---
function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (
      center &&
      Array.isArray(center) &&
      center.length === 2 &&
      !isNaN(center[0]) &&
      !isNaN(center[1]) &&
      typeof zoom === "number" &&
      !isNaN(zoom)
    ) {
      try {
        map.setView(center, zoom);
      } catch (e) {
        console.error("Error setting map view:", e);
      }
    } else if (
      center &&
      Array.isArray(center) &&
      center.length === 2 &&
      !isNaN(center[0]) &&
      !isNaN(center[1])
    ) {
      try {
        map.setView(center);
      } catch (e) {
        console.error("Error setting map center:", e);
      }
    }
  }, [center, zoom, map]);
  return null;
}

// --- Helper to format price for map marker ---
const formatPriceForMarker = (priceString) => {
  if (!priceString || priceString === "N/A") return "N/A";
  const num = parseInt(priceString.replace(/[^0-9]/g, ""), 10);
  if (isNaN(num)) return "N/A";
  if (num >= 1000000) return `£${(num / 1000000).toFixed(1)}M`;
  else if (num >= 1000) return `£${(num / 1000).toFixed(0)}k`;
  return `£${num}`;
};

// --- Main App Component ---
function App() {
  // State Variables
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchPostcode, setActiveSearchPostcode] = useState(""); // Controls visibility of right panel
  const [isSearchingLRDemo, setIsSearchingLRDemo] = useState(false); // Specific loading state for Land Registry / Demographics
  const [searchResults, setSearchResults] = useState(null); // API result status/errors for LR/Demo
  const [selectedProperty, setSelectedProperty] = useState(null); // For detail view
  const [view, setView] = useState("listings"); // Current view in right panel ('listings' or 'detail')
  const [mapCenter, setMapCenter] = useState([54.57, -1.23]); // Initial UK center
  const [mapZoom, setMapZoom] = useState(6); // Initial zoom
  const [heatmapPoints, setHeatmapPoints] = useState([]); // Data for heatmap layer

  // Scraper related state
  const [scrapedListings, setScrapedListings] = useState([]); // Listings from SSE
  const [isFetchingScraper, setIsFetchingScraper] = useState(false); // Is SSE connection active/fetching?
  const [scraperError, setScraperError] = useState(null); // Error message from scraper
  const [isScrapingComplete, setIsScrapingComplete] = useState(false); // Did scraper send 'complete'?
  const eventSourceRef = useRef(null); // Ref to hold the EventSource object

  // Search timing state
  const [searchStartTime, setSearchStartTime] = useState(null); // Track when search was initiated

  // --- Derived State for Loading / UI Control ---
  // Show main full-screen loading ONLY when search started AND no listings received yet AND no error
  const showMainLoadingScreen =
    searchStartTime !== null &&
    scrapedListings.length === 0 &&
    !scraperError &&
    (isFetchingScraper || isSearchingLRDemo);

  // Is *any* background task running? (For disabling search button/input)
  const isAnyTaskRunning =
    isFetchingScraper ||
    isSearchingLRDemo ||
    selectedProperty?.isLoadingPrediction ||
    selectedProperty?.isLoadingLR ||
    selectedProperty?.isLoadingDemo;

  // Should the right property panel be visible?
  const showPropertyPanel = !!activeSearchPostcode || !!selectedProperty; // Show if postcode searched or detail viewed

  // --- Loading Message ---
  const getMainLoadingMessage = () => {
    if (!activeSearchPostcode) return "Preparing search...";
    if (isFetchingScraper)
      return `Searching listings near ${activeSearchPostcode}`;
    if (isSearchingLRDemo)
      return `Loading area data for ${activeSearchPostcode}`;
    return `Searching ${activeSearchPostcode}`;
  };

  // --- SSE Handler ---
  const startScraperStream = useCallback((postcode) => {
    setScrapedListings([]);
    setScraperError(null);
    setIsScrapingComplete(false);
    setIsFetchingScraper(true); // Mark scraper as fetching
    // Note: searchStartTime is set in handleSearch before calling this

    if (eventSourceRef.current) {
      console.log("Closing previous EventSource connection.");
      eventSourceRef.current.close();
    }

    const url = `${
      process.env.REACT_APP_API_BASE_URL || "http://localhost:3001"
    }/api/scrape-listings?postcode=${encodeURIComponent(postcode)}`;
    console.log(`Connecting to SSE: ${url}`);
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => console.log("SSE Connection Opened");

    es.onmessage = (event) => {
      try {
        const propertyData = JSON.parse(event.data);
        if (propertyData && propertyData.id) {
          if (!propertyData.image_urls) propertyData.image_urls = []; // Initialize if missing
          setScrapedListings((prevListings) => [...prevListings, propertyData]);
        } else if (propertyData && propertyData.status === "complete") {
          console.log("SSE 'complete' status received via onmessage");
          setIsScrapingComplete(true);
          setIsFetchingScraper(false);
          es.close();
          eventSourceRef.current = null;
        } else if (propertyData && propertyData.error) {
          console.error(
            "SSE error received via onmessage:",
            propertyData.error
          );
          setScraperError(propertyData.error);
          setIsFetchingScraper(false);
          setIsScrapingComplete(true);
          es.close();
          eventSourceRef.current = null;
        } else {
          console.warn(
            "Received unexpected data via SSE onmessage:",
            propertyData
          );
        }
      } catch (error) {
        console.error("Failed to parse SSE property data:", event.data, error);
      }
    };

    es.addEventListener("error", (event) => {
      console.error("SSE 'error' event received:", event.data);
      let errorMsg = "Unknown scraper error occurred.";
      try {
        errorMsg = JSON.parse(event.data).error || errorMsg;
      } catch (e) {
        errorMsg = "Received an unparsable error from scraper.";
      }
      setScraperError(errorMsg);
      setIsFetchingScraper(false);
      setIsScrapingComplete(true);
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("status", (event) => {
      try {
        const statusData = JSON.parse(event.data);
        if (statusData.status === "no_results")
          console.log("Scraper reported no results found.");
        else if (statusData.status === "initialized")
          console.log("Scraper initialized.");
      } catch (e) {
        console.error("Failed to parse SSE status data:", event.data, e);
      }
    });

    es.addEventListener("complete", (event) => {
      console.log("SSE 'complete' event received:", event.data);
      setIsScrapingComplete(true);
      setIsFetchingScraper(false);
      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = (err) => {
      console.error("EventSource failed:", err);
      setScraperError("Connection error during listing search.");
      setIsFetchingScraper(false);
      setIsScrapingComplete(true);
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Cleanup SSE connection on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        console.log("Closing EventSource connection on component unmount.");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // --- Search Handler ---
  const handleSearch = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
      const query = searchQuery.trim();

      if (!query || !postcodeRegex.test(query)) {
        setSearchResults({ errorMessage: "Please enter a valid UK postcode." });
        setActiveSearchPostcode("");
        setScrapedListings([]);
        setScraperError(null);
        setIsFetchingScraper(false);
        setIsScrapingComplete(false);
        setSearchStartTime(null);
        setIsSearchingLRDemo(false); // Reset LR/Demo state too
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        return;
      }

      // Reset states for new search
      setIsSearchingLRDemo(true); // Start LR/Demo loading
      setIsFetchingScraper(false); // Will be set true by startScraperStream
      setIsScrapingComplete(false);
      setSearchResults(null);
      setSelectedProperty(null);
      setView("listings");
      setHeatmapPoints([]);
      setActiveSearchPostcode(query); // !! This makes the panel appear
      setSearchStartTime(Date.now()); // Set start time
      setMapZoom(15);
      setScrapedListings([]);
      setScraperError(null);

      startScraperStream(query); // Start SSE fetching

      // Concurrent fetches for Geo, LR, Demo
      let fetchedCoordinates = null;
      let landRegistryError = null;
      let demoError = null;
      try {
        fetchedCoordinates = await getCoordinatesFromPostcode(query);
        if (fetchedCoordinates)
          setMapCenter([fetchedCoordinates.lat, fetchedCoordinates.lng]);
        else console.warn("Geocoding failed for search query.");

        const landRegistryPromise = fetchPropertyDataByPostcode(query)
          .then((apiData) => ({
            type: "lr",
            data: formatTransactionData(apiData),
          }))
          .catch((err) => ({
            type: "lr",
            error: err.message || "Failed to fetch property data.",
          }));
        const demographicsPromise = fetchDemographicData(query)
          .then((demoData) => ({ type: "demo", data: demoData }))
          .catch((err) => ({
            type: "demo",
            error: err.message || "Failed to fetch demographic data.",
          }));

        const results = await Promise.allSettled([
          landRegistryPromise,
          demographicsPromise,
        ]);

        let transactions = [];
        let demographicsResult = null;
        results.forEach((result) => {
          if (result.status === "fulfilled") {
            const value = result.value || {};
            if (value.error) {
              if (value.type === "lr") landRegistryError = value.error;
              if (value.type === "demo") demoError = value.error;
            } else {
              if (value.type === "lr") transactions = value.data || [];
              if (value.type === "demo")
                demographicsResult = value.data || null;
            }
          } else {
            const reason = result.reason?.message || "Unknown fetch error";
            console.error("A LR/Demo fetch promise was rejected:", reason);
            if (
              reason.toLowerCase().includes("property data") ||
              reason.toLowerCase().includes("land registry")
            )
              landRegistryError = landRegistryError || reason;
            else if (reason.toLowerCase().includes("demographic"))
              demoError = demoError || reason;
          }
        });

        // Heatmap Generation
        if (transactions.length > 0 && fetchedCoordinates) {
          const prices = transactions
            .map((t) => t.price)
            .filter((p) => typeof p === "number" && !isNaN(p));
          if (prices.length > 0) {
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const priceRange = maxPrice - minPrice;
            const points = transactions
              .filter((t) => typeof t.price === "number" && !isNaN(t.price))
              .map((t) => {
                let intensity =
                  priceRange > 0
                    ? 0.1 + 0.9 * ((t.price - minPrice) / priceRange)
                    : 0.5;
                intensity = Math.max(0.1, Math.min(1.0, intensity));
                const randomOffsetLat = (Math.random() - 0.5) * 0.004;
                const randomOffsetLng = (Math.random() - 0.5) * 0.004;
                return [
                  fetchedCoordinates.lat + randomOffsetLat,
                  fetchedCoordinates.lng + randomOffsetLng,
                  intensity,
                ];
              });
            setHeatmapPoints(points);
          } else {
            setHeatmapPoints([]);
          }
        } else {
          setHeatmapPoints([]);
        }

        // Update combined search status/error for LR/Demo
        if (landRegistryError || demoError)
          setSearchResults({
            errorMessage:
              [landRegistryError, demoError].filter(Boolean).join("; ") ||
              "Error fetching area data.",
          });
        else setSearchResults({ success: true });
      } catch (error) {
        console.error("Error during handleSearch execution:", error);
        setSearchResults({
          errorMessage: `Search failed: ${
            error.message || "Please try again."
          }`,
        });
        setHeatmapPoints([]);
      } finally {
        setIsSearchingLRDemo(false); // Stop LR/Demo loading indicator
      }
    },
    [searchQuery, startScraperStream] // Dependencies
  );

  // --- View Detail Handler ---
  const handleViewScrapedProperty = useCallback(
    async (scrapedListing) => {
      if (!activeSearchPostcode) {
        console.error("Cannot view details without an active search postcode.");
        return;
      }
      console.log("Viewing scraped property:", scrapedListing);
      setHeatmapPoints([]); // Clear heatmap for detail view

      const lat = scrapedListing.latitude
        ? parseFloat(scrapedListing.latitude)
        : null;
      const lon = scrapedListing.longitude
        ? parseFloat(scrapedListing.longitude)
        : null;
      const validCoordinates =
        lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);

      const initialProperty = {
        id: scrapedListing.id || `scraped-${Date.now()}`,
        title: scrapedListing.address || "Scraped Listing",
        location:
          scrapedListing.address?.split(",").slice(-2).join(", ").trim() ||
          "Unknown Location",
        postcode: activeSearchPostcode.toUpperCase(),
        coordinates: validCoordinates ? [lat, lon] : null,
        details: {
          bedrooms: scrapedListing.bedrooms || "N/A",
          bathrooms: scrapedListing.bathrooms || "N/A",
          sqft: scrapedListing.square_footage || "N/A",
          propertyType: scrapedListing.property_type || "N/A",
          age: "N/A",
        },
        price: {
          asking: scrapedListing.price || "N/A",
          estimated: "Loading...",
          roi: "Loading...",
        },
        description: scrapedListing.description || "",
        source: scrapedListing.source || "Rightmove",
        detail_url: scrapedListing.detail_url,
        image_urls: scrapedListing.image_urls || [], // Use scraped URLs
        image:
          scrapedListing.image_urls && scrapedListing.image_urls.length > 0
            ? scrapedListing.image_urls[0]
            : "https://placehold.co/600x400/cccccc/1d1d1d?text=Detail+View",
        transactionHistory: null,
        priceGrowth: null,
        demographicData: null,
        isLoadingLR: true,
        isLoadingDemo: true,
        predictionResults: [],
        isLoadingPrediction: true,
        predictionError: null,
      };

      setSelectedProperty(initialProperty); // Set this first to show detail panel
      setView("detail");
      if (initialProperty.coordinates) {
        setMapCenter(initialProperty.coordinates);
        setMapZoom(17);
      } else if (activeSearchPostcode) {
        const coords = await getCoordinatesFromPostcode(activeSearchPostcode);
        if (coords) {
          setMapCenter([coords.lat, coords.lng]);
          setMapZoom(17);
        }
      }

      // Concurrent fetches for Prediction, LR, Demo data
      const predictionInputs = preparePredictionInputs(
        scrapedListing,
        activeSearchPostcode
      );
      const predictApiUrl = `${
        process.env.REACT_APP_API_BASE_URL || "http://localhost:3001"
      }/api/predict-price`;
      const predictionPromise = fetch(predictApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ ...predictionInputs, num_years: 5 }),
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error || `Prediction failed: ${response.status}`
            );
          if (!result || !Array.isArray(result.predictions))
            throw new Error("Invalid prediction response format");
          return result.predictions;
        })
        .catch((error) => {
          console.error("Prediction API Error:", error);
          return {
            isPredictionError: true,
            error: error.message || "Failed to fetch prediction.",
          };
        });
      const lrPromise = fetchPropertyDataByPostcode(activeSearchPostcode)
        .then(formatTransactionData)
        .catch((err) => ({
          isLrError: true,
          error: err.message || "Failed to load transaction history.",
        }));
      const demoPromise = fetchDemographicData(activeSearchPostcode).catch(
        (err) => ({
          isDemoError: true,
          error: err.message || "Failed to load demographics.",
        })
      );

      // Wait for all promises
      const [predictionResult, lrResult, demoResult] = await Promise.allSettled(
        [predictionPromise, lrPromise, demoPromise]
      );

      // Update selectedProperty state once data is fetched/failed
      setSelectedProperty((prev) => {
        if (!prev || prev.id !== initialProperty.id) return prev; // Ensure correct property update
        const updates = { ...prev };
        // Process Prediction Result
        updates.isLoadingPrediction = false;
        if (predictionResult.status === "fulfilled") {
          const value = predictionResult.value;
          if (value.isPredictionError) {
            updates.predictionError = value.error;
            updates.predictionResults = [];
          } else {
            updates.predictionResults = value;
            updates.predictionError = null;
          }
        } else {
          updates.predictionError =
            predictionResult.reason?.message || "Prediction request failed.";
          updates.predictionResults = [];
        }
        // Process Land Registry Result
        updates.isLoadingLR = false;
        let fetchedTransactions = [];
        let detailLrError = null;
        if (lrResult.status === "fulfilled") {
          const value = lrResult.value;
          if (value.isLrError) detailLrError = value.error;
          else fetchedTransactions = value || [];
        } else detailLrError = lrResult.reason?.message || "LR fetch rejected.";
        updates.transactionHistory = detailLrError ? [] : fetchedTransactions;
        updates.priceGrowth =
          !detailLrError && fetchedTransactions.length > 0
            ? calculatePriceGrowth(fetchedTransactions)
            : {
                error: detailLrError,
                growth: detailLrError || "N/A",
                annualizedReturn: detailLrError || "N/A",
              };
        updates.price.estimated =
          !detailLrError && fetchedTransactions.length > 0
            ? `£${Math.round(
                fetchedTransactions.reduce((sum, t) => sum + t.price, 0) /
                  fetchedTransactions.length
              ).toLocaleString()}`
            : detailLrError
            ? "Error"
            : "N/A";
        updates.price.roi =
          updates.priceGrowth?.annualizedReturn && !updates.priceGrowth?.error
            ? updates.priceGrowth.annualizedReturn
            : detailLrError
            ? "Error"
            : "N/A";
        // Process Demographics Result
        updates.isLoadingDemo = false;
        if (demoResult.status === "fulfilled") {
          const value = demoResult.value;
          if (value.isDemoError)
            updates.demographicData = { error: value.error };
          else updates.demographicData = value || null;
        } else
          updates.demographicData = {
            error: demoResult.reason?.message || "Demo fetch rejected.",
          };
        return updates;
      });
    },
    [activeSearchPostcode] // Dependency
  );

  // --- Back to Listings Handler ---
  const handleBackToListings = useCallback(() => {
    setSelectedProperty(null); // Clear selected property
    setView("listings"); // Set view back to listings
    // Keep activeSearchPostcode set so the panel remains visible
    // Re-center map based on the postcode that was searched
    if (activeSearchPostcode) {
      getCoordinatesFromPostcode(activeSearchPostcode).then((coords) => {
        if (coords) {
          setMapCenter([coords.lat, coords.lng]);
          setMapZoom(15);
        } // Back to search zoom level
      });
    } else {
      // Should ideally not happen if panel is visible, but fallback
      setMapCenter([54.57, -1.23]);
      setMapZoom(6);
    }
  }, [activeSearchPostcode]); // Depend on activeSearchPostcode

  // --- Render ---
  return (
    <div className="App">
      {/* Main Loading Screen (Full Screen, shows initially) */}
      <LoadingScreen
        isVisible={showMainLoadingScreen}
        message={getMainLoadingMessage()}
        logoSrc={logo}
      />
      {/* Main App Container */}
      <div
        className={`app-container ${
          showPropertyPanel ? "show-panel" : "hide-panel"
        }`}
      >
        {/* Left Panel: Map and Search */}
        <div className={`map-panel ${!showPropertyPanel ? "full-width" : ""}`}>
          <form className="search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Enter UK Postcode (e.g., SW1A 0AA)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isAnyTaskRunning} // Disable while any task runs
            />
            <button type="submit" disabled={isAnyTaskRunning}>
              {isAnyTaskRunning ? "Searching..." : "Search"}
            </button>
          </form>

          {/* Search Status Messages Overlay */}
          <div className="search-status-container">
            {scraperError && (
              <div className="search-status error-message">
                <p>Listings Error: {scraperError}</p>
              </div>
            )}
            {searchResults?.errorMessage && (
              <div className="search-status error-message">
                <p>Area Data Error: {searchResults.errorMessage}</p>
              </div>
            )}
            {/* Subtle loading if scraping continues after first result */}
            {!scraperError &&
              isFetchingScraper &&
              scrapedListings.length > 0 &&
              !isScrapingComplete && (
                <div className="search-status info-message loading-indicator subtle-loading">
                  <p>
                    <FontAwesomeIcon icon={faSpinner} spin /> Loading more
                    listings...
                  </p>
                </div>
              )}
            {/* Completion message (optional) */}
            {!scraperError &&
              isScrapingComplete &&
              scrapedListings.length > 0 &&
              !isFetchingScraper &&
              !isSearchingLRDemo && (
                <div className="search-status info-message">
                  <p>Found {scrapedListings.length} listings.</p>
                </div>
              )}
          </div>

          {/* Map Component */}
          <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            className="map-container"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='© <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />
            <MapController center={mapCenter} zoom={mapZoom} />
            {heatmapPoints &&
              heatmapPoints.length > 0 &&
              view === "listings" && <HeatmapLayer data={heatmapPoints} />}

            {/* Markers for Scraped Listings */}
            {view === "listings" &&
              scrapedListings.map((listing, index) => {
                const lat = parseFloat(listing.latitude);
                const lon = parseFloat(listing.longitude);
                if (!isNaN(lat) && !isNaN(lon)) {
                  const priceText = formatPriceForMarker(listing.price);
                  const priceMarkerIcon = L.divIcon({
                    html: `<div class="price-marker">${priceText}</div>`,
                    className: "price-marker-container",
                    iconSize: L.point(60, 25, true),
                    iconAnchor: [30, 25],
                  });
                  return (
                    <Marker
                      key={listing.id || `scraped-${index}`}
                      position={[lat, lon]}
                      icon={priceMarkerIcon}
                      eventHandlers={{
                        mouseover: (e) => e.target.setZIndexOffset(1000),
                        mouseout: (e) => e.target.setZIndexOffset(0),
                      }}
                    >
                      <Popup>
                        <b>{listing.address || "Listing"}</b>
                        <br />
                        Price: {listing.price || "N/A"}
                        <br />
                        {listing.bedrooms !== "N/A" &&
                          `${listing.bedrooms} Beds `}{" "}
                        {listing.bathrooms !== "N/A" &&
                          `| ${listing.bathrooms} Baths`}
                        <br />
                        <button
                          onClick={() => handleViewScrapedProperty(listing)}
                          className="popup-button"
                        >
                          View Details
                        </button>
                      </Popup>
                    </Marker>
                  );
                } else return null;
              })}

            {/* Marker for Selected Property in Detail View */}
            {view === "detail" &&
              selectedProperty &&
              selectedProperty.coordinates &&
              !isNaN(selectedProperty.coordinates[0]) &&
              !isNaN(selectedProperty.coordinates[1]) && (
                <Marker
                  key={`selected-${selectedProperty.id}`}
                  position={selectedProperty.coordinates}
                >
                  <Popup>
                    <b>{selectedProperty.title}</b>
                    <br />
                    {selectedProperty.price?.asking || "N/A"}
                  </Popup>
                </Marker>
              )}
          </MapContainer>
        </div>{" "}
        {/* End map-panel */}
        {/* Right Panel: Conditionally Rendered Listings or Details */}
        {showPropertyPanel && (
          <div className="property-panel">
            {view === "detail" && selectedProperty ? (
              // Detail View
              <PropertyDetail
                property={selectedProperty}
                isLoadingLR={selectedProperty.isLoadingLR ?? false}
                isLoadingDemo={selectedProperty.isLoadingDemo ?? false}
                predictionResults={selectedProperty.predictionResults}
                isLoadingPrediction={
                  selectedProperty.isLoadingPrediction ?? false
                }
                predictionError={selectedProperty.predictionError}
                onBackToListings={handleBackToListings}
              />
            ) : (
              // Listings View (Only shown after search)
              <>
                <div className="listings-section">
                  <h2>
                    {isFetchingScraper && !isScrapingComplete
                      ? `Searching listings for ${activeSearchPostcode}...`
                      : `Listings near ${activeSearchPostcode} (${scrapedListings.length})`}
                    {/* Optional subtle spinner */}
                    {isFetchingScraper &&
                      !isScrapingComplete &&
                      scrapedListings.length > 0 && (
                        <FontAwesomeIcon
                          icon={faSpinner}
                          spin
                          style={{
                            marginLeft: "10px",
                            fontSize: "0.9em",
                            opacity: 0.7,
                          }}
                        />
                      )}
                  </h2>

                  {/* Display Listings */}
                  {scrapedListings.length > 0 && (
                    <div className="property-list">
                      {scrapedListings.map((listing, index) => (
                        <PropertyCard
                          key={listing.id || `scraped-card-${index}`}
                          property={{
                            id: listing.id || `scraped-card-${index}`,
                            title: listing.address || "Scraped Listing",
                            location:
                              listing.address
                                ?.split(",")
                                .slice(-2)
                                .join(", ")
                                .trim() || activeSearchPostcode.toUpperCase(),
                            postcode: activeSearchPostcode.toUpperCase(),
                            price: { asking: listing.price || "N/A" },
                            details: {
                              bedrooms: listing.bedrooms || "N/A",
                              bathrooms: listing.bathrooms || "N/A",
                              sqft: listing.square_footage || "N/A",
                            },
                            image_urls: listing.image_urls || [], // Pass URLs for slideshow
                            image:
                              listing.image_urls &&
                              listing.image_urls.length > 0
                                ? listing.image_urls[0]
                                : `https://placehold.co/600x400/d1c4e9/4527a0?text=${encodeURIComponent(
                                    listing.address?.split(",")[0] || "Listing"
                                  )}`, // Primary image for placeholder logic maybe
                            source: listing.source || "Rightmove",
                          }}
                          onViewProperty={() =>
                            handleViewScrapedProperty(listing)
                          }
                        />
                      ))}
                    </div>
                  )}

                  {/* No Results Message */}
                  {scrapedListings.length === 0 &&
                    !isFetchingScraper &&
                    isScrapingComplete &&
                    activeSearchPostcode &&
                    !scraperError && (
                      <div className="no-results-message">
                        <p>
                          No listings found for {activeSearchPostcode}. Try a
                          nearby postcode.
                        </p>
                      </div>
                    )}
                  {/* Note: Scraper errors are shown in the map panel status area */}
                </div>
              </>
            )}
          </div>
        )}{" "}
        {/* End Conditional Rendering of property-panel */}
      </div>{" "}
      {/* End app-container */}
    </div> // End App
  );
}

export default App;
