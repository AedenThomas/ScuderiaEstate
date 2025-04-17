import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

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
    "end of terrace": "Terraced", // Map variations
    flat: "Flats",
    apartment: "Flats",
    maisonette: "Flats",
    bungalow: "Detached", // Or map to specific if model handles it
    // Add other mappings as needed based on scraper output
  };
  if (listing.property_type && typeof listing.property_type === "string") {
    const lowerType = listing.property_type.toLowerCase();
    inputs.propertytype = typeMap[lowerType] || "Terraced"; // Use mapped or default
  }

  // Duration (Tenure) Assumption based on Type
  if (inputs.propertytype === "Flats") {
    inputs.duration = "Leasehold";
  } else {
    inputs.duration = "Freehold";
  }

  // Number of Rooms (from Bedrooms)
  if (listing.bedrooms && typeof listing.bedrooms === "string") {
    const numMatch = listing.bedrooms.match(/\d+/);
    if (numMatch) {
      inputs.numberrooms = parseInt(numMatch[0], 10);
    }
  } else if (typeof listing.bedrooms === "number" && listing.bedrooms > 0) {
    inputs.numberrooms = listing.bedrooms;
  }
  // Ensure minimum 1 room
  if (inputs.numberrooms < 1) {
    inputs.numberrooms = 1;
  }

  // Total Floor Area (from square_footage)
  if (
    listing.square_footage &&
    typeof listing.square_footage === "string" &&
    listing.square_footage !== "N/A"
  ) {
    const sqftText = listing.square_footage.replace(/,/g, ""); // Remove commas
    const sqftMatch = sqftText.match(/(\d+(\.\d+)?)\s*sq\s*ft/i);
    const sqmMatch =
      sqftText.match(/(\d+(\.\d+)?)\s*m²/i) ||
      sqftText.match(/(\d+(\.\d+)?)\s*sqm/i);

    if (sqmMatch) {
      inputs.tfarea = parseFloat(sqmMatch[1]);
    } else if (sqftMatch) {
      const sqft = parseFloat(sqftMatch[1]);
      inputs.tfarea = Math.round(sqft / 10.764); // Convert sqft to sqm
    } else {
      // Try parsing if it's just a number (assume sqm?) - Less reliable
      const numMatch = sqftText.match(/^\d+(\.\d+)?$/);
      if (numMatch) {
        console.warn(
          `Assuming square_footage "${listing.square_footage}" is in sqm.`
        );
        inputs.tfarea = parseFloat(numMatch[0]);
      }
    }
  }
  // Ensure minimum area
  if (inputs.tfarea <= 0) {
    console.warn(`Invalid tfarea calculated for ${listing.id}. Using default.`);
    inputs.tfarea = 70;
  }

  // Property Age (Using default for now)
  // You could add logic here to parse description for "new build" etc. if desired
  inputs.property_age = 20;

  console.log("Prepared Prediction Inputs:", inputs);
  return inputs;
};

// --- Geocoding Function ---
const getCoordinatesFromPostcode = async (postcode) => {
  if (!postcode || typeof postcode !== "string") {
    console.error("Invalid postcode provided for geocoding:", postcode);
    return null;
  }
  const formattedPostcode = encodeURIComponent(postcode.trim().toUpperCase());
  const apiUrl = `https://nominatim.openstreetmap.org/search?postalcode=${formattedPostcode}&countrycodes=gb&format=json&limit=1&addressdetails=1`;

  try {
    console.log(`Geocoding postcode: ${postcode} using URL: ${apiUrl}`);
    const response = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Geocoding API error: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    console.log("Geocoding response:", data);
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

// --- Main App Component ---
function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchPostcode, setActiveSearchPostcode] = useState("");
  const [isSearchingLRDemo, setIsSearchingLRDemo] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [view, setView] = useState("listings");
  const [mapCenter, setMapCenter] = useState([54.57, -1.23]);
  const [mapZoom, setMapZoom] = useState(13);
  const [heatmapPoints, setHeatmapPoints] = useState([]);

  const [scrapedListings, setScrapedListings] = useState([]);
  const [isFetchingScraper, setIsFetchingScraper] = useState(false);
  const [scraperError, setScraperError] = useState(null);
  const [isScrapingComplete, setIsScrapingComplete] = useState(false);
  const eventSourceRef = useRef(null);

  const [featuredProperties] = useState([
    {
      id: 1,
      title: "Modern Apartment in Chelsea",
      location: "Chelsea, London",
      postcode: "SW3 5RZ",
      coordinates: [51.49, -0.17],
      details: { bedrooms: 2, bathrooms: 2, sqft: 950, age: 5 },
      price: {
        asking: "£850,000",
        estimated: "£875,000",
        roi: "No result",
        rentalYield: "3.4%",
      },
      amenities: ["Gym", "Concierge", "Parking"],
      transport: [{ name: "Sloane Square Station", distance: "0.3mi" }],
      schools: ["Chelsea Primary School"],
      riskScore: "2/5",
      image: "https://placehold.co/600x400/cccccc/1d1d1d?text=Chelsea+Apt",
      source: "Featured",
    },
    {
      id: 2,
      title: "Stylish Loft in Kensington",
      location: "Kensington, London",
      postcode: "W8 7BU",
      coordinates: [51.5, -0.19],
      details: { bedrooms: 3, bathrooms: 3, sqft: 1100, age: 3 },
      price: {
        asking: "£950,000",
        estimated: "£1,000,000",
        roi: "No result",
        rentalYield: "4.2%",
      },
      amenities: ["Fitness Center", "Doorman", "Garage"],
      transport: [{ name: "Kensington High St Station", distance: "0.2mi" }],
      schools: ["Kensington Primary"],
      riskScore: "1/5",
      image: "https://placehold.co/600x400/cccccc/1d1d1d?text=Kensington+Loft",
      source: "Featured",
    },
  ]);

  // Determine if the main loading screen should be visible
  const [searchStartTime, setSearchStartTime] = useState(null);
  const isLoading =
    (isFetchingScraper || isSearchingLRDemo) &&
    (scrapedListings.length === 0 ||
      (searchStartTime && Date.now() - searchStartTime < 2000));

  const getLoadingMessage = () => {
    if (!activeSearchPostcode) return "Preparing search...";
    if (scrapedListings.length > 0)
      return `Found ${scrapedListings.length} properties...`;
    return `Searching ${activeSearchPostcode}`;
  };

  // --- Search Handler ---
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
        setScrapedListings((prevListings) => [...prevListings, propertyData]);
      } catch (error) {
        console.error("Failed to parse SSE property data:", event.data, error);
      }
    };

    es.addEventListener("error", (event) => {
      console.error("SSE 'error' event received:", event.data);
      try {
        const errorData = JSON.parse(event.data);
        setScraperError(errorData.error || "Unknown scraper error occurred.");
      } catch (e) {
        setScraperError("Received an unparsable error from scraper.");
      }
      setIsFetchingScraper(false);
      setIsScrapingComplete(true);
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("status", (event) => {
      console.log("SSE 'status' event received:", event.data);
      try {
        const statusData = JSON.parse(event.data);
        if (statusData.status === "no_results") {
          console.log("Scraper reported no results found.");
        } else if (statusData.status === "initialized") {
          console.log("Scraper initialized and starting search");
        }
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
      setScraperError("Connection error while fetching listings.");
      setIsFetchingScraper(false);
      setIsScrapingComplete(true);
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        console.log("Closing EventSource connection on component unmount.");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

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
      setSearchResults(null);
      setSelectedProperty(null);
      setView("listings");
      setHeatmapPoints([]);
      setActiveSearchPostcode(query);
      setSearchStartTime(Date.now());

      startScraperStream(query);

      let fetchedCoordinates = null;
      let landRegistryError = null;
      let demoError = null;

      try {
        fetchedCoordinates = await getCoordinatesFromPostcode(query);
        if (fetchedCoordinates) {
          setMapCenter([fetchedCoordinates.lat, fetchedCoordinates.lng]);
          setMapZoom(15);
        } else {
          console.warn("Geocoding failed for search query.");
          setMapCenter([54.57, -1.23]);
          setMapZoom(13);
        }

        console.log("Starting concurrent fetches: LR, Demo");
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
        console.log("Concurrent LR/Demo fetch results:", results);

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
            console.log(`Generated ${points.length} heatmap points.`);
          } else {
            setHeatmapPoints([]);
          }
        } else {
          setHeatmapPoints([]);
        }

        if (
          !transactions.length &&
          !demographicsResult &&
          (landRegistryError || demoError)
        ) {
          const combinedError = [landRegistryError, demoError]
            .filter(Boolean)
            .join("; ");
          setSearchResults({
            errorMessage:
              combinedError || "No historical or demographic data found.",
          });
        } else {
          setSearchResults({ success: true });
        }
      } catch (error) {
        console.error("Error during LR/Demo fetch execution:", error);
        setSearchResults({
          errorMessage: `Area data fetch failed: ${
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

  const handleViewScrapedProperty = useCallback(
    async (scrapedListing) => {
      if (!activeSearchPostcode) {
        console.error("Cannot view details without an active search postcode.");
        return;
      }

      console.log("Viewing scraped property:", scrapedListing);
      setHeatmapPoints([]);

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
        setMapZoom(17);
      }

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
          if (!response.ok) {
            throw new Error(
              result.error || `Prediction failed: ${response.status}`
            );
          }
          if (!result || !Array.isArray(result.predictions)) {
            throw new Error("Invalid prediction response format");
          }
          return result.predictions;
        })
        .catch((error) => {
          console.error("Prediction API Error:", error);
          return { error: error.message || "Failed to fetch prediction." };
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

      const [predictionResult, lrResult, demoResult] = await Promise.allSettled(
        [predictionPromise, lrPromise, demoPromise]
      );

      setSelectedProperty((prev) => {
        if (!prev || prev.id !== initialProperty.id) return prev;

        const updates = { ...prev };

        if (predictionResult.status === "fulfilled") {
          if (predictionResult.value.error) {
            updates.predictionError = predictionResult.value.error;
            updates.predictionResults = [];
          } else {
            updates.predictionResults = predictionResult.value;
            updates.predictionError = null;
          }
        } else {
          updates.predictionError =
            predictionResult.reason?.message || "Prediction fetch rejected.";
          updates.predictionResults = [];
        }
        updates.isLoadingPrediction = false;

        let fetchedTransactions = [];
        let detailLrError = null;
        if (lrResult.status === "fulfilled") {
          if (lrResult.value.isLrError) {
            detailLrError = lrResult.value.error;
          } else {
            fetchedTransactions = lrResult.value || [];
          }
        } else {
          detailLrError = lrResult.reason?.message || "LR fetch rejected.";
        }
        updates.transactionHistory = detailLrError ? [] : fetchedTransactions;
        updates.priceGrowth =
          !detailLrError && fetchedTransactions.length > 0
            ? calculatePriceGrowth(fetchedTransactions)
            : {
                growth: detailLrError || "N/A",
                annualizedReturn: detailLrError || "N/A",
              };
        updates.price.estimated =
          !detailLrError && fetchedTransactions.length > 0
            ? `£${Math.round(
                fetchedTransactions.reduce((sum, t) => sum + t.price, 0) /
                  fetchedTransactions.length
              ).toLocaleString()}`
            : "N/A";
        updates.price.roi = updates.priceGrowth?.annualizedReturn || "N/A";
        updates.isLoadingLR = false;

        if (demoResult.status === "fulfilled") {
          if (demoResult.value.isDemoError) {
            updates.demographicData = { error: demoResult.value.error };
          } else {
            updates.demographicData = demoResult.value || null;
          }
        } else {
          updates.demographicData = {
            error: demoResult.reason?.message || "Demo fetch rejected.",
          };
        }
        updates.isLoadingDemo = false;

        return updates;
      });
    },
    [activeSearchPostcode]
  );

  const handleViewFeaturedProperty = useCallback((property) => {
    setScrapedListings([]);
    setScraperError(null);
    setHeatmapPoints([]);
    setSearchResults(null);
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
  }, []);

  return (
    <div className="App">
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

          <div className="search-status-container">
            {(isSearchingLRDemo || isFetchingScraper) &&
              scrapedListings.length > 0 && (
                <div className="search-status info-message loading-indicator">
                  <p>
                    Loading {isFetchingScraper ? "Listings" : ""}
                    {isFetchingScraper && isSearchingLRDemo ? " & " : ""}
                    {isSearchingLRDemo ? "Area Data" : ""}...
                    {isFetchingScraper &&
                      !isScrapingComplete &&
                      ` (${scrapedListings.length} found)`}
                  </p>
                </div>
              )}
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
            {isScrapingComplete && !scraperError && (
              <div className="search-status info-message">
                <p>
                  Finished loading listings ({scrapedListings.length} found).
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
              attribution="..."
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />
            <MapController center={mapCenter} zoom={mapZoom} />
            {heatmapPoints && heatmapPoints.length > 0 && (
              <HeatmapLayer data={heatmapPoints} />
            )}

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

            {view === "listings" &&
              scrapedListings.map((listing, index) => {
                const lat = parseFloat(listing.latitude);
                const lon = parseFloat(listing.longitude);
                if (!isNaN(lat) && !isNaN(lon)) {
                  return (
                    <Marker
                      key={listing.id || `scraped-${index}`}
                      position={[lat, lon]}
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
                }
              })}

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
              predictionResults={selectedProperty.predictionResults}
              isLoadingPrediction={selectedProperty.isLoadingPrediction}
              predictionError={selectedProperty.predictionError}
              onBackToListings={handleBackToListings}
            />
          ) : (
            <>
              {scrapedListings.length > 0 && (
                <div className="listings-section">
                  <h2>
                    Listings Found ({scrapedListings.length}){" "}
                    {isFetchingScraper && !isScrapingComplete
                      ? "(Loading...)"
                      : ""}
                  </h2>
                  <div className="property-list">
                    {scrapedListings.map((listing, index) => {
                      const lat = parseFloat(listing.latitude);
                      const lon = parseFloat(listing.longitude);
                      const validCoordinates = !isNaN(lat) && !isNaN(lon);
                      return (
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
                            price: { asking: listing.price || "N/A" },
                            details: {
                              bedrooms: listing.bedrooms || "N/A",
                              bathrooms: listing.bathrooms || "N/A",
                            },
                            image: `https://placehold.co/600x400/d1c4e9/4527a0?text=${encodeURIComponent(
                              listing.address?.split(",")[0] || "Listing"
                            )}`,
                            source: listing.source || "Rightmove",
                          }}
                          onViewProperty={() =>
                            handleViewScrapedProperty(listing)
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {featuredProperties.length > 0 &&
                scrapedListings.length === 0 &&
                !isFetchingScraper &&
                !scraperError && (
                  <div className="listings-section featured-section">
                    <h2>Featured Properties</h2>
                    <div className="property-list">
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
                  </div>
                )}

              {scrapedListings.length === 0 &&
                !isFetchingScraper &&
                !isSearchingLRDemo && (
                  <div className="no-results-message">
                    {!activeSearchPostcode && (
                      <p>
                        Enter a postcode to search for listings and area data.
                      </p>
                    )}
                    {activeSearchPostcode &&
                      !scraperError &&
                      isScrapingComplete && (
                        <p>No listings found for {activeSearchPostcode}.</p>
                      )}
                    {activeSearchPostcode && scraperError && (
                      <p className="error-text">
                        Could not load listings: {scraperError}
                      </p>
                    )}
                    {activeSearchPostcode && searchResults?.errorMessage && (
                      <p className="error-text">
                        Could not load area data: {searchResults.errorMessage}
                      </p>
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
