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
import LoadingScreen from "./components/LoadingScreen.js"; // Ensure .js extension if needed
// Service functions
import {
  fetchPropertyDataByPostcode,
  formatTransactionData,
  calculatePriceGrowth,
} from "./services/landRegistryService";
import { fetchDemographicData } from "./services/demographicsService";
import { fetchCrimeData } from "./services/crimeService";
// Assets & Icons
import logo from "./logo.png"; // Ensure logo.png is in src/ or adjust path
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
  inputs.property_age = 20;
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
    if (data?.length > 0) {
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
    if (center?.[0] && center?.[1] && !isNaN(center[0]) && !isNaN(center[1])) {
      try {
        map.setView(center, zoom || map.getZoom());
      } catch (e) {
        console.error("Error setting map view:", e);
      }
    }
  }, [center, zoom, map]);
  return null;
}

const formatPrice = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === "N/A" ||
    value === "Error"
  )
    return value;
  const num = Number(String(value).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return "N/A";
  // Using Intl.NumberFormat is generally better for currency
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

// --- Helper to format price for map marker ---
const formatPriceForMarker = (priceString) => {
  if (!priceString || priceString === "N/A") return "N/A";
  const num = parseInt(priceString.replace(/[^0-9]/g, ""), 10);
  if (isNaN(num)) return "N/A";
  if (num >= 1000000) return `£${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `£${(num / 1000).toFixed(0)}k`;
  return `£${num}`;
};

// --- Main App Component ---
function App() {
  // State Variables
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
  const [areaData, setAreaData] = useState({
    transactionHistory: null,
    priceGrowth: null,
    demographicData: null,
    crimeStats: null,
  });

  // --- Derived State for Loading / UI Control ---
  const showMainLoadingScreen =
    searchStartTime !== null &&
    scrapedListings.length === 0 &&
    !scraperError &&
    (isFetchingScraper || isSearchingLRDemo);
  const isAnyTaskRunning =
    isFetchingScraper ||
    isSearchingLRDemo ||
    selectedProperty?.isLoadingPrediction ||
    selectedProperty?.isLoadingLR ||
    selectedProperty?.isLoadingDemo;
  const showPropertyPanel = !!activeSearchPostcode;

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
    setIsFetchingScraper(true);
    if (eventSourceRef.current) {
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
        if (propertyData?.id) {
          if (!propertyData.image_urls) propertyData.image_urls = [];
          setScrapedListings((prev) => [...prev, propertyData]);
        } else if (propertyData?.status === "complete") {
          setIsScrapingComplete(true);
          setIsFetchingScraper(false);
          es.close();
          eventSourceRef.current = null;
        } else if (propertyData?.error) {
          setScraperError(propertyData.error);
          setIsFetchingScraper(false);
          setIsScrapingComplete(true);
          es.close();
          eventSourceRef.current = null;
        } else {
          console.warn("Unexpected SSE data:", propertyData);
        }
      } catch (error) {
        console.error("SSE parse error:", event.data, error);
      }
    };
    es.addEventListener("error", (event) => {
      let msg = "Unknown scraper SSE error.";
      try {
        msg = JSON.parse(event.data).error || msg;
      } catch (e) {
        msg = "Unparsable SSE error.";
      }
      setScraperError(msg);
      setIsFetchingScraper(false);
      setIsScrapingComplete(true);
      es.close();
      eventSourceRef.current = null;
    });
    es.addEventListener("status", (event) => {
      try {
        const d = JSON.parse(event.data);
        if (d.status === "no_results") console.log("Scraper: No results.");
        if (d.status === "initialized") console.log("Scraper: Initialized.");
      } catch (e) {
        console.error("SSE status parse error:", e);
      }
    });
    es.addEventListener("complete", () => {
      setIsScrapingComplete(true);
      setIsFetchingScraper(false);
      es.close();
      eventSourceRef.current = null;
      console.log("SSE stream complete.");
    });
    es.onerror = (err) => {
      console.error("SSE connection error:", err);
      setScraperError("SSE Connection error.");
      setIsFetchingScraper(false);
      setIsScrapingComplete(true);
      es.close();
      eventSourceRef.current = null;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
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
        setIsSearchingLRDemo(false);
        setAreaData({});
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        return;
      }
      setIsSearchingLRDemo(true);
      setIsFetchingScraper(false);
      setIsScrapingComplete(false);
      setSearchResults(null);
      setSelectedProperty(null);
      setView("listings");
      setHeatmapPoints([]);
      setActiveSearchPostcode(query);
      setSearchStartTime(Date.now());
      setMapZoom(15);
      setScrapedListings([]);
      setScraperError(null);
      setAreaData({});
      startScraperStream(query);
      let fetchedCoordinates = null;
      let landRegistryError = null;
      let demoError = null;
      let crimeSummary = null;
      try {
        fetchedCoordinates = await getCoordinatesFromPostcode(query);
        if (fetchedCoordinates) {
          setMapCenter([fetchedCoordinates.lat, fetchedCoordinates.lng]);
          fetchCrimeData(fetchedCoordinates.lat, fetchedCoordinates.lng)
            .then((summary) =>
              setAreaData((prev) => ({ ...prev, crimeStats: summary }))
            )
            .catch((err) => console.warn("Area Crime fetch error:", err));
        } else {
          console.warn("Geocoding failed.");
        }
        const lrPromise = fetchPropertyDataByPostcode(query)
          .then(formatTransactionData)
          .catch((err) => {
            landRegistryError = err.message || "LR fetch failed.";
            return [];
          });
        const demoPromise = fetchDemographicData(query).catch((err) => {
          demoError = err.message || "Demo fetch failed.";
          return null;
        });
        const [transactions, demographicsResult] = await Promise.all([
          lrPromise,
          demoPromise,
        ]);
        const priceGrowthResult =
          transactions.length > 0 ? calculatePriceGrowth(transactions) : null;
        setAreaData((prev) => ({
          ...prev,
          transactionHistory: transactions,
          priceGrowth: priceGrowthResult,
          demographicData: demographicsResult,
        }));
        const combinedError = [landRegistryError, demoError]
          .filter(Boolean)
          .join("; ");
        if (combinedError) setSearchResults({ errorMessage: combinedError });
        else if (transactions.length === 0 && !demographicsResult)
          setSearchResults({
            infoMessage:
              "No historical or demographic data found for this area.",
          });
        else setSearchResults({ success: true });
        if (transactions.length > 0 && fetchedCoordinates) {
          const prices = transactions
            .map((t) => t.price)
            .filter((p) => typeof p === "number" && !isNaN(p));
          if (prices.length > 0) {
            const minP = Math.min(...prices);
            const maxP = Math.max(...prices);
            const range = maxP - minP;
            const pts = transactions
              .filter((t) => typeof t.price === "number")
              .map((t) => {
                let i =
                  range > 0 ? 0.1 + 0.9 * ((t.price - minP) / range) : 0.5;
                i = Math.max(0.1, Math.min(1.0, i));
                const rLat = (Math.random() - 0.5) * 0.004;
                const rLng = (Math.random() - 0.5) * 0.004;
                return [
                  fetchedCoordinates.lat + rLat,
                  fetchedCoordinates.lng + rLng,
                  i,
                ];
              });
            setHeatmapPoints(pts);
          } else {
            setHeatmapPoints([]);
          }
        } else {
          setHeatmapPoints([]);
        }
      } catch (error) {
        console.error("Search execution error:", error);
        setSearchResults({
          errorMessage: `Search failed: ${
            error.message || "Please try again."
          }`,
        });
        setHeatmapPoints([]);
      } finally {
        setIsSearchingLRDemo(false);
      }
    },
    [searchQuery, startScraperStream]
  );

  // --- View Detail Handler ---
  const handleViewScrapedProperty = useCallback(
    async (scrapedListing) => {
      if (!activeSearchPostcode) return;
      setHeatmapPoints([]); // Clear heatmap

      // ... (get lat/lon, fetch listing crime) ...
      const lat = scrapedListing.latitude
        ? parseFloat(scrapedListing.latitude)
        : null;
      const lon = scrapedListing.longitude
        ? parseFloat(scrapedListing.longitude)
        : null;
      const validCoords =
        lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);
      let listingCrime = null;
      if (validCoords) {
        try {
          listingCrime = await fetchCrimeData(lat, lon);
        } catch (err) {
          console.warn("Listing crime fetch failed:", err);
        }
      }

      // --- Construct initial property for detail view ---
      const detailProperty = {
        id: scrapedListing.id || `scraped-${Date.now()}`,
        title: scrapedListing.address || "Listing",
        location:
          scrapedListing.address?.split(",").slice(-2).join(", ").trim() ||
          "Unknown",
        postcode: activeSearchPostcode.toUpperCase(),
        coordinates: validCoords ? [lat, lon] : null,
        details: {
          bedrooms: scrapedListing.bedrooms || "N/A",
          bathrooms: scrapedListing.bathrooms || "N/A",
          sqft: scrapedListing.square_footage || "N/A",
          propertyType: scrapedListing.property_type || "N/A",
          age: "N/A",
        },
        price: {
          asking: scrapedListing.price || "N/A",
          // Use AREA average price/roi as initial estimate before prediction (if available)
          estimated:
            areaData.priceGrowth &&
            !areaData.priceGrowth.error &&
            areaData.transactionHistory?.length > 0
              ? formatPrice(areaData.priceGrowth.priceRange.avg)
              : "N/A", // Assuming calculatePriceGrowth adds avg
          roi: areaData.priceGrowth?.annualizedReturn ?? "N/A",
        },
        description: scrapedListing.description || "",
        source: scrapedListing.source || "Rightmove",
        detail_url: scrapedListing.detail_url,
        image_urls: scrapedListing.image_urls || [],
        image:
          scrapedListing.image_urls?.[0] ||
          "https://placehold.co/600x400/ccc/1d1d1d?text=Detail",
        crimeStats: listingCrime, // Listing specific crime
        transactionHistory: areaData.transactionHistory, // Area data
        priceGrowth: areaData.priceGrowth, // Area data
        demographicData: areaData.demographicData, // Area data
        predictionResults: [],
        isLoadingPrediction: true,
        predictionError: null, // Prediction state
        isAreaSummary: false,
        isLoadingLR: false,
        isLoadingDemo: false, // Area data already loaded
      };

      setSelectedProperty(detailProperty);
      setView("detail");

      if (detailProperty.coordinates) {
        setMapCenter(detailProperty.coordinates);
        setMapZoom(17);
      } else if (activeSearchPostcode) {
        const c = await getCoordinatesFromPostcode(activeSearchPostcode);
        if (c) {
          setMapCenter([c.lat, c.lng]);
          setMapZoom(17);
        }
      }
      const predictionInputs = preparePredictionInputs(
        scrapedListing,
        activeSearchPostcode
      );
      const predictApiUrl = `${
        process.env.REACT_APP_API_BASE_URL || "http://localhost:3001"
      }/api/predict-price`;
      console.log(
        `[FETCH PREDICT] Calling: ${predictApiUrl} with body:`,
        JSON.stringify({ ...predictionInputs, num_years: 5 })
      ); // Log correct URL
      fetch(predictApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ ...predictionInputs, num_years: 5 }),
      })
        .then(async (response) => {
          const result = await response.json(); // Try to parse JSON regardless of status
          if (!response.ok) {
            // If not ok, use error from parsed JSON if available, or status text
            throw new Error(
              result?.error ||
                result?.details ||
                `Prediction failed: ${response.status} ${response.statusText}`
            );
          }
          if (!result?.predictions) {
            throw new Error("Invalid prediction response format");
          }
          return result.predictions;
        })
        .then((predictions) => {
          setSelectedProperty((prev) =>
            prev
              ? {
                  ...prev,
                  predictionResults: predictions,
                  isLoadingPrediction: false,
                  predictionError: null,
                }
              : null
          );
        })
        .catch((error) => {
          console.error("Prediction API Error:", error);
          // Ensure the error message itself is displayed
          setSelectedProperty((prev) =>
            prev
              ? {
                  ...prev,
                  predictionResults: [],
                  isLoadingPrediction: false,
                  predictionError:
                    error.message || "Failed to fetch prediction.",
                }
              : null
          );
        });
    },
    [activeSearchPostcode, areaData] // Dependencies
  );

  // --- Back to Listings Handler ---
  const handleBackToListings = useCallback(() => {
    setSelectedProperty(null);
    setView("listings");
    if (activeSearchPostcode) {
      getCoordinatesFromPostcode(activeSearchPostcode).then((c) => {
        if (c) {
          setMapCenter([c.lat, c.lng]);
          setMapZoom(15);
        }
      });
    } else {
      setMapCenter([54.57, -1.23]);
      setMapZoom(6);
    }
  }, [activeSearchPostcode]);

  // --- Render ---
  return (
    <div className="App">
      <LoadingScreen
        isVisible={showMainLoadingScreen}
        message={getMainLoadingMessage()}
        logoSrc={logo}
      />
      <div
        className={`app-container ${
          showPropertyPanel ? "show-panel" : "hide-panel"
        }`}
      >
        {/* Left Panel */}
        <div className={`map-panel ${!showPropertyPanel ? "full-width" : ""}`}>
          <form className="search-bar" onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Enter UK Postcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isAnyTaskRunning}
            />
            <button type="submit" disabled={isAnyTaskRunning}>
              {isAnyTaskRunning ? "Searching..." : "Search"}
            </button>
          </form>
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
            {searchResults?.infoMessage && (
              <div className="search-status info-message">
                <p>{searchResults.infoMessage}</p>
              </div>
            )}
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
            {!scraperError &&
              isScrapingComplete &&
              scrapedListings.length > 0 &&
              !isFetchingScraper &&
              !isSearchingLRDemo &&
              searchResults?.success && (
                <div className="search-status info-message">
                  <p>
                    Found {scrapedListings.length} listings. Area data loaded.
                  </p>
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
              attribution='© <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />
            <MapController center={mapCenter} zoom={mapZoom} />
            {heatmapPoints?.length > 0 && view === "listings" && (
              <HeatmapLayer data={heatmapPoints} />
            )}
            {/* Scraped Listing Markers with Price Bubbles */}
            {view === "listings" &&
              scrapedListings.map((listing) => {
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
                      key={listing.id || `scraped-${lat}-${lon}`}
                      position={[lat, lon]}
                      icon={priceMarkerIcon}
                      eventHandlers={{
                        mouseover: (e) => e.target.setZIndexOffset(1000),
                        mouseout: (e) => e.target.setZIndexOffset(0),
                      }}
                    >
                      {" "}
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
                      </Popup>{" "}
                    </Marker>
                  );
                } else return null;
              })}
            {/* Selected Property Marker */}
            {view === "detail" && selectedProperty?.coordinates && (
              <Marker
                key={`selected-${selectedProperty.id}`}
                position={selectedProperty.coordinates}
              >
                <Popup>
                  <b>{selectedProperty.title}</b>
                  <br />
                  {selectedProperty.price?.estimated !== "N/A"
                    ? `Avg Price: ${selectedProperty.price.estimated}`
                    : selectedProperty.price?.asking || "N/A"}
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>

        {/* Right Panel: Conditionally Rendered */}
        {showPropertyPanel && (
          <div className="property-panel">
            {view === "detail" && selectedProperty ? (
              // Detail View
              <PropertyDetail
                property={selectedProperty}
                onBackToListings={handleBackToListings}
              />
            ) : (
              // Listings View
              <div className="listings-section">
                <h2>
                  {isFetchingScraper && !isScrapingComplete
                    ? `Searching listings for ${activeSearchPostcode}...`
                    : `Listings near ${activeSearchPostcode} (${scrapedListings.length})`}
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
                {scrapedListings.length > 0 && (
                  <div className="property-list">
                    {scrapedListings.map((listing, index) => {
                      const propertyForCard = {
                        id: listing.id || `scraped-card-${index}`,
                        title: listing.address || "Listing",
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
                        image_urls: listing.image_urls || [],
                        image:
                          listing.image_urls?.[0] ||
                          `https://placehold.co/600x400/d1c4e9/4527a0?text=${encodeURIComponent(
                            listing.address?.split(",")[0] || "Listing"
                          )}`,
                        source: listing.source || "Rightmove",
                      };
                      return (
                        <PropertyCard
                          key={propertyForCard.id}
                          property={propertyForCard}
                          onViewProperty={() =>
                            handleViewScrapedProperty(listing)
                          }
                        />
                      );
                    })}
                  </div>
                )}
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
