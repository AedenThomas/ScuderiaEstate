// src/App.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet"; // <-- Keep L import

import HeatmapLayer from "./components/HeatmapLayer";
import PropertyCard from "./components/PropertyCard";
import PropertyDetail from "./components/PropertyDetail";
import LoadingScreen from "./components/LoadingScreen";
import {
  fetchPropertyDataByPostcode,
  formatTransactionData,
  calculatePriceGrowth,
} from "./services/landRegistryService";
import { fetchDemographicData } from "./services/demographicsService";

// Fix default Leaflet icon issue (Keep this)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

// --- Helper Function for Prediction Input Preparation (Keep existing) ---
const preparePredictionInputs = (listing, postcode) => {
  const inputs = {
    postcode: postcode || "N/A", // Use the active search postcode
    propertytype: "Terraced", // Default
    duration: "Freehold", // Default assumption
    numberrooms: 3, // Default
    tfarea: 70, // Default in sqm
    property_age: 20, // Default
  };

  // Property Type Mapping
  const typeMap = {
    detached: "Detached",
    "semi-detached": "Semi-Detached",
    terraced: "Terraced",
    "end of terrace": "Terraced",
    flat: "Flats",
    apartment: "Flats",
    maisonette: "Flats",
    bungalow: "Detached",
    studio: "Flats", // Added studio
    // Add other mappings as needed based on scraper output
  };
  if (listing.property_type && typeof listing.property_type === "string") {
    const lowerType = listing.property_type.toLowerCase().trim(); // Added trim
    inputs.propertytype = typeMap[lowerType] || "Terraced"; // Use mapped or default
  }

  // Duration (Tenure) Assumption based on Type
  if (inputs.propertytype === "Flats") {
    inputs.duration = "Leasehold";
  } else {
    inputs.duration = "Freehold";
  }

  // Number of Rooms (from Bedrooms) - Improved Parsing
  if (
    listing.bedrooms &&
    (typeof listing.bedrooms === "string" ||
      typeof listing.bedrooms === "number")
  ) {
    const bedString = String(listing.bedrooms);
    const numMatch = bedString.match(/\d+/);
    if (numMatch) {
      inputs.numberrooms = parseInt(numMatch[0], 10);
    }
  }
  if (inputs.numberrooms < 1) {
    inputs.numberrooms = 1;
  } // Ensure minimum 1 room

  // Total Floor Area (from square_footage) - Slightly Improved
  if (
    listing.square_footage &&
    typeof listing.square_footage === "string" &&
    listing.square_footage !== "N/A"
  ) {
    const sqftText = listing.square_footage.replace(/,/g, ""); // Remove commas
    const sqftMatch = sqftText.match(/(\d+(\.\d+)?)\s*sq\s*ft/i);
    const sqmMatch = sqftText.match(/(\d+(\.\d+)?)\s*(?:m²|sqm|sq\.?m)/i); // More sqm patterns

    if (sqmMatch) {
      inputs.tfarea = parseFloat(sqmMatch[1]);
    } else if (sqftMatch) {
      inputs.tfarea = Math.round(parseFloat(sqftMatch[1]) / 10.764);
    } else {
      const numMatch = sqftText.match(/^\d+(\.\d+)?$/);
      if (numMatch) {
        // console.warn(`Assuming square_footage "${listing.square_footage}" is in sqm.`);
        inputs.tfarea = parseFloat(numMatch[0]);
      }
    }
  }
  if (inputs.tfarea <= 0) {
    inputs.tfarea = 70;
  } // Ensure minimum area

  // Property Age (Using default for now)
  inputs.property_age = 20;

  // console.log("Prepared Prediction Inputs:", inputs); // Keep for debugging if needed
  return inputs;
};

// --- Geocoding Function (Keep existing) ---
const getCoordinatesFromPostcode = async (postcode) => {
  if (!postcode || typeof postcode !== "string") {
    console.error("Invalid postcode provided for geocoding:", postcode);
    return null;
  }
  const formattedPostcode = encodeURIComponent(postcode.trim().toUpperCase());
  const apiUrl = `https://nominatim.openstreetmap.org/search?postalcode=${formattedPostcode}&countrycodes=gb&format=json&limit=1&addressdetails=1`;

  try {
    // console.log(`Geocoding postcode: ${postcode} using URL: ${apiUrl}`);
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Geocoding API error: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    // console.log("Geocoding response:", data);
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

// --- MapController Component (Keep existing) ---
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
  // Extract number, convert to k or M
  const num = parseInt(priceString.replace(/[^0-9]/g, ""), 10);
  if (isNaN(num)) return "N/A";
  if (num >= 1000000) {
    return `£${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `£${(num / 1000).toFixed(0)}k`;
  }
  return `£${num}`;
};

// --- Main App Component ---
function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchPostcode, setActiveSearchPostcode] = useState("");
  const [isSearchingLRDemo, setIsSearchingLRDemo] = useState(false);
  const [searchResults, setSearchResults] = useState(null); // Combined status/error
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [view, setView] = useState("listings"); // 'listings' or 'detail'
  const [mapCenter, setMapCenter] = useState([54.57, -1.23]); // Default UK center-ish
  const [mapZoom, setMapZoom] = useState(6); // Zoom out initially
  const [heatmapPoints, setHeatmapPoints] = useState([]);

  const [scrapedListings, setScrapedListings] = useState([]);
  const [isFetchingScraper, setIsFetchingScraper] = useState(false);
  const [scraperError, setScraperError] = useState(null);
  const [isScrapingComplete, setIsScrapingComplete] = useState(false);
  const eventSourceRef = useRef(null);

  // Featured properties remain the same
  const [featuredProperties] = useState([
    /* ... keep existing featured properties ... */
  ]);

  // Combined loading state logic
  const [searchStartTime, setSearchStartTime] = useState(null);
  const isLoading =
    (isFetchingScraper || isSearchingLRDemo) &&
    (!isScrapingComplete || Date.now() - (searchStartTime || 0) < 1500); // Show loading if fetching or recently started

  const getLoadingMessage = () => {
    if (!activeSearchPostcode) return "Preparing search...";
    if (scrapedListings.length > 0 && !isScrapingComplete)
      return `Found ${scrapedListings.length} listings...`;
    if (isFetchingScraper)
      return `Searching listings for ${activeSearchPostcode}`;
    if (isSearchingLRDemo)
      return `Loading area data for ${activeSearchPostcode}`;
    return `Searching ${activeSearchPostcode}`;
  };

  // --- startScraperStream (Keep existing SSE logic) ---
  const startScraperStream = useCallback((postcode) => {
    setScrapedListings([]);
    setScraperError(null);
    setIsScrapingComplete(false);
    setIsFetchingScraper(true);

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

    es.onopen = () => {
      console.log("SSE Connection Opened");
    };

    es.onmessage = (event) => {
      try {
        const propertyData = JSON.parse(event.data);
        // Basic validation
        if (propertyData && propertyData.id) {
          setScrapedListings((prevListings) => [...prevListings, propertyData]);
        } else {
          console.warn("Received invalid property data via SSE:", propertyData);
        }
      } catch (error) {
        console.error("Failed to parse SSE property data:", event.data, error);
      }
    };

    es.addEventListener("error", (event) => {
      console.error("SSE 'error' event received:", event.data);
      let errorMsg = "Unknown scraper error occurred.";
      try {
        const errorData = JSON.parse(event.data);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = "Received an unparsable error from scraper.";
      }
      setScraperError(errorMsg);
      setIsFetchingScraper(false);
      setIsScrapingComplete(true); // Mark as complete even on error
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("status", (event) => {
      // console.log("SSE 'status' event received:", event.data); // Less verbose logging
      try {
        const statusData = JSON.parse(event.data);
        if (statusData.status === "no_results") {
          console.log("Scraper reported no results found.");
        } else if (statusData.status === "initialized") {
          console.log("Scraper initialized.");
        }
        // Add handling for other statuses if needed
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
      // General connection error
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

  // --- handleSearch (Largely the same, added focus on mapZoom) ---
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
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        return;
      }

      setIsSearchingLRDemo(true);
      setIsFetchingScraper(true); // Start both loadings
      setSearchResults(null);
      setSelectedProperty(null);
      setView("listings");
      setHeatmapPoints([]);
      setActiveSearchPostcode(query);
      setSearchStartTime(Date.now());
      setMapZoom(15); // Zoom in when searching

      startScraperStream(query); // Start SSE

      let fetchedCoordinates = null;
      let landRegistryError = null;
      let demoError = null;

      try {
        fetchedCoordinates = await getCoordinatesFromPostcode(query);
        if (fetchedCoordinates) {
          setMapCenter([fetchedCoordinates.lat, fetchedCoordinates.lng]);
          // setMapZoom(15); // Zoom already set above
        } else {
          console.warn("Geocoding failed for search query.");
          // Keep default center/zoom if geocoding fails
        }

        // console.log("Starting concurrent fetches: LR, Demo"); // Less verbose
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
        // console.log("Concurrent LR/Demo fetch results:", results); // Less verbose

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

        // Generate Heatmap Points (Keep existing logic)
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
            // console.log(`Generated ${points.length} heatmap points.`);
          } else {
            setHeatmapPoints([]);
          }
        } else {
          setHeatmapPoints([]);
        }

        // Update combined search status/error
        if (landRegistryError || demoError) {
          const combinedError = [landRegistryError, demoError]
            .filter(Boolean)
            .join("; ");
          setSearchResults({
            errorMessage: combinedError || "Error fetching area data.",
          });
        } else if (transactions.length === 0 && !demographicsResult) {
          // setSearchResults({ infoMessage: "No historical or demographic data found for this area." }); // Less intrusive
        } else {
          setSearchResults({ success: true }); // Indicate success
        }
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
        // Note: isFetchingScraper is controlled by SSE events
      }
    },
    [searchQuery, startScraperStream]
  ); // Dependencies

  // --- handleViewScrapedProperty (Largely the same, minor cleanup) ---
  const handleViewScrapedProperty = useCallback(
    async (scrapedListing) => {
      if (!activeSearchPostcode) {
        console.error("Cannot view details without an active search postcode.");
        return;
      }

      console.log("Viewing scraped property:", scrapedListing);
      setHeatmapPoints([]); // Clear heatmap when viewing detail

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
          age: "N/A", // Prediction model uses default if not scraped
        },
        price: {
          asking: scrapedListing.price || "N/A",
          estimated: "Loading...",
          roi: "Loading...",
        },
        description: scrapedListing.description || "",
        source: scrapedListing.source || "Rightmove",
        detail_url: scrapedListing.detail_url,
        transactionHistory: null,
        priceGrowth: null,
        demographicData: null,
        isLoadingLR: true,
        isLoadingDemo: true,
        predictionResults: [],
        isLoadingPrediction: true,
        predictionError: null,
      };

      setSelectedProperty(initialProperty);
      setView("detail");
      if (initialProperty.coordinates) {
        setMapCenter(initialProperty.coordinates);
        setMapZoom(17); // Zoom closer on detail view
      } else if (activeSearchPostcode) {
        // If listing has no coords, try geocoding the search postcode again
        const coords = await getCoordinatesFromPostcode(activeSearchPostcode);
        if (coords) {
          setMapCenter([coords.lat, coords.lng]);
          setMapZoom(17);
        }
      }

      // --- Fetch Prediction, LR, Demo data concurrently ---
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
        body: JSON.stringify({ ...predictionInputs, num_years: 5 }), // Request 5 years
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) {
            throw new Error(
              result.error || `Prediction failed: ${response.status}`
            );
          }
          if (!result || !Array.isArray(result.predictions)) {
            throw new Error("Invalid prediction response format");
          }
          return result.predictions; // Return array of predictions
        })
        .catch((error) => {
          console.error("Prediction API Error:", error);
          return {
            isPredictionError: true,
            error: error.message || "Failed to fetch prediction.",
          }; // Mark as error
        });

      const lrPromise = fetchPropertyDataByPostcode(activeSearchPostcode)
        .then(formatTransactionData) // Format successful response
        .catch((err) => ({
          isLrError: true,
          error: err.message || "Failed to load transaction history.",
        })); // Mark LR errors

      const demoPromise = fetchDemographicData(activeSearchPostcode).catch(
        (err) => ({
          isDemoError: true,
          error: err.message || "Failed to load demographics.",
        })
      ); // Mark Demo errors

      // --- Wait for all promises ---
      const [predictionResult, lrResult, demoResult] = await Promise.allSettled(
        [predictionPromise, lrPromise, demoPromise]
      );

      // --- Update selectedProperty state once all data is fetched/failed ---
      setSelectedProperty((prev) => {
        // Ensure we are updating the correct property if user clicks fast
        if (!prev || prev.id !== initialProperty.id) return prev;

        const updates = { ...prev };

        // Process Prediction Result
        updates.isLoadingPrediction = false;
        if (predictionResult.status === "fulfilled") {
          const value = predictionResult.value;
          if (value.isPredictionError) {
            updates.predictionError = value.error;
            updates.predictionResults = [];
          } else {
            updates.predictionResults = value; // Assign the array
            updates.predictionError = null;
          }
        } else {
          // Promise rejected
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
          if (value.isLrError) {
            detailLrError = value.error;
          } else {
            fetchedTransactions = value || [];
          }
        } else {
          detailLrError = lrResult.reason?.message || "LR fetch rejected.";
        }

        updates.transactionHistory = detailLrError ? [] : fetchedTransactions; // Store history or empty on error
        // Calculate growth only if NO error and we have transactions
        updates.priceGrowth =
          !detailLrError && fetchedTransactions.length > 0
            ? calculatePriceGrowth(fetchedTransactions)
            : {
                growth: detailLrError || "N/A",
                annualizedReturn: detailLrError || "N/A",
              };
        // Estimate price based on avg only if NO error and have transactions
        updates.price.estimated =
          !detailLrError && fetchedTransactions.length > 0
            ? `£${Math.round(
                fetchedTransactions.reduce((sum, t) => sum + t.price, 0) /
                  fetchedTransactions.length
              ).toLocaleString()}`
            : detailLrError
            ? "Error"
            : "N/A"; // Show Error or N/A
        updates.price.roi =
          updates.priceGrowth?.annualizedReturn ||
          (detailLrError ? "Error" : "N/A");

        // Process Demographics Result
        updates.isLoadingDemo = false;
        if (demoResult.status === "fulfilled") {
          const value = demoResult.value;
          if (value.isDemoError) {
            updates.demographicData = { error: value.error };
          } else {
            updates.demographicData = value || null;
          }
        } else {
          updates.demographicData = {
            error: demoResult.reason?.message || "Demo fetch rejected.",
          };
        }

        return updates; // Return the updated state
      });
    },
    [activeSearchPostcode]
  ); // Dependency

  // --- Other handlers (Keep existing) ---
  const handleViewFeaturedProperty = useCallback((property) => {
    // Reset search state
    setScrapedListings([]);
    setScraperError(null);
    setIsFetchingScraper(false);
    setIsScrapingComplete(false);
    setActiveSearchPostcode(""); // Clear active search when viewing featured
    setSearchResults(null);
    setHeatmapPoints([]);

    setSelectedProperty({
      ...property,
      isLoadingLR: false,
      isLoadingDemo: false,
      source: "Featured",
    });
    setView("detail");
    if (property.coordinates) {
      setMapCenter(property.coordinates);
      setMapZoom(16);
    }
  }, []);

  const handleBackToListings = useCallback(() => {
    setSelectedProperty(null);
    setView("listings");
    // Optionally re-center map based on last search postcode? Or default?
    if (activeSearchPostcode) {
      // Re-geocode or use stored coords if available
      getCoordinatesFromPostcode(activeSearchPostcode).then((coords) => {
        if (coords) {
          setMapCenter([coords.lat, coords.lng]);
          setMapZoom(15); // Back to search zoom level
        }
      });
    } else {
      setMapCenter([54.57, -1.23]); // Default center
      setMapZoom(6); // Default zoom
    }
  }, [activeSearchPostcode]);

  return (
    <div className="App">
      {/* Loading Screen - slightly adjusted logic */}
      <LoadingScreen
        isVisible={isLoading}
        message={getLoadingMessage()}
        itemsFound={scrapedListings.length}
      />

      <div className="app-container">
        {/* --- Left Panel: Map and Search --- */}
        <div className="map-panel">
          <form className="search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Enter UK Postcode (e.g., SW1A 0AA)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isSearchingLRDemo || isFetchingScraper}
            />
            <button
              type="submit"
              disabled={isSearchingLRDemo || isFetchingScraper}
            >
              {isSearchingLRDemo || isFetchingScraper
                ? "Searching..."
                : "Search"}
            </button>
          </form>

          {/* Search Status Messages Container */}
          <div className="search-status-container">
            {/* Show specific errors first */}
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
            {/* Show loading message only if no errors displayed */}
            {!scraperError &&
              !searchResults?.errorMessage &&
              (isSearchingLRDemo || isFetchingScraper) &&
              !isScrapingComplete && (
                <div className="search-status info-message loading-indicator">
                  <p>{getLoadingMessage()}</p>
                </div>
              )}
            {/* Show completion message */}
            {!scraperError &&
              isScrapingComplete &&
              scrapedListings.length > 0 && (
                <div className="search-status info-message">
                  <p>Found {scrapedListings.length} listings.</p>
                </div>
              )}
          </div>

          <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            className="map-container"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>' // Correct attribution
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" // Using CartoDB Light
            />
            <MapController center={mapCenter} zoom={mapZoom} />

            {/* Heatmap Layer (Keep existing) */}
            {heatmapPoints &&
              heatmapPoints.length > 0 &&
              view === "listings" && <HeatmapLayer data={heatmapPoints} />}

            {/* --- Markers for Scraped Listings (Using DivIcon for Price) --- */}
            {view === "listings" &&
              scrapedListings.map((listing, index) => {
                const lat = parseFloat(listing.latitude);
                const lon = parseFloat(listing.longitude);
                if (!isNaN(lat) && !isNaN(lon)) {
                  const priceText = formatPriceForMarker(listing.price);
                  const priceMarkerIcon = L.divIcon({
                    html: `<div class="price-marker">${priceText}</div>`,
                    className: "price-marker-container", // Add a container class if needed for positioning/styling
                    iconSize: L.point(60, 25, true), // Adjust size as needed
                    iconAnchor: [30, 25], // Point below the price
                  });

                  return (
                    <Marker
                      key={listing.id || `scraped-${index}`}
                      position={[lat, lon]}
                      icon={priceMarkerIcon} // Use the custom price marker
                      // Optional: Raise marker on hover for better interaction
                      eventHandlers={{
                        mouseover: (e) => {
                          e.target.setZIndexOffset(1000);
                        },
                        mouseout: (e) => {
                          e.target.setZIndexOffset(0);
                        },
                      }}
                    >
                      <Popup>
                        <b>{listing.address || "Listing"}</b>
                        <br />
                        Price: {listing.price || "N/A"}
                        <br />
                        {listing.bedrooms !== "N/A" &&
                          `${listing.bedrooms} Beds `}
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
                } else {
                  return null;
                } // Don't render marker if no coords
              })}

            {/* Markers for Featured Properties (Keep existing) */}
            {view === "listings" &&
              featuredProperties.map(
                (property) =>
                  property.coordinates && (
                    <Marker
                      key={`featured-${property.id}`}
                      position={property.coordinates}
                    >
                      <Popup>
                        <b>{property.title}</b>
                        <br />
                        {property.price?.asking || "Price N/A"}
                        <br />
                        <button
                          onClick={() => handleViewFeaturedProperty(property)}
                          className="popup-button"
                        >
                          View Details
                        </button>
                      </Popup>
                    </Marker>
                  )
              )}

            {/* Marker for Selected Property in Detail View (Keep existing) */}
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
        </div>

        {/* --- Right Panel: Listings or Details --- */}
        <div className="property-panel">
          {view === "detail" && selectedProperty ? (
            <PropertyDetail
              property={selectedProperty}
              isLoadingLR={selectedProperty.isLoadingLR}
              isLoadingDemo={selectedProperty.isLoadingDemo}
              // Pass prediction data
              predictionResults={selectedProperty.predictionResults}
              isLoadingPrediction={selectedProperty.isLoadingPrediction}
              predictionError={selectedProperty.predictionError}
              onBackToListings={handleBackToListings}
            />
          ) : (
            <>
              {/* --- Listings View --- */}
              <div className="listings-section">
                {/* Title changes based on state */}
                <h2>
                  {activeSearchPostcode
                    ? isFetchingScraper && !isScrapingComplete
                      ? `Searching Listings for ${activeSearchPostcode}...`
                      : `Listings near ${activeSearchPostcode} (${scrapedListings.length})`
                    : "Featured Properties"}
                </h2>

                {/* Show listings if available */}
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
                            sqft: listing.square_footage || "N/A", // Pass sqft
                          },
                          image: `https://placehold.co/600x400/d1c4e9/4527a0?text=${encodeURIComponent(
                            listing.address?.split(",")[0] || "Listing"
                          )}`, // Placeholder image
                          source: listing.source || "Rightmove",
                        }}
                        onViewProperty={() =>
                          handleViewScrapedProperty(listing)
                        }
                      />
                    ))}
                  </div>
                )}

                {/* Show featured only if no active search AND no listings */}
                {!activeSearchPostcode &&
                  scrapedListings.length === 0 &&
                  featuredProperties.length > 0 && (
                    <div className="property-list featured-list">
                      {featuredProperties.map((property) => (
                        <PropertyCard
                          key={property.id}
                          property={property}
                          onViewProperty={() =>
                            handleViewFeaturedProperty(property)
                          }
                        />
                      ))}
                    </div>
                  )}

                {/* No Results / Initial State Message */}
                {scrapedListings.length === 0 && !isFetchingScraper && (
                  <div className="no-results-message">
                    {!activeSearchPostcode && (
                      <p>
                        Enter a postcode above to search for listings and
                        insights.
                      </p>
                    )}
                    {activeSearchPostcode &&
                      !scraperError &&
                      isScrapingComplete && (
                        <p>
                          No listings found for {activeSearchPostcode}. Try a
                          nearby postcode.
                        </p>
                      )}
                    {/* Errors are shown in the map panel status area */}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
