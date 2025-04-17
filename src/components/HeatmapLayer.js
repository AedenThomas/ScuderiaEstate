import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat"; // Make sure this is installed: npm install leaflet.heat

const HeatmapLayer = ({
  data, // Expects array of [lat, lng, intensity]
  radius = 20,
  blur = 15,
  // Gradient: 0.4 (Blue/Green) -> 0.65 (Lime) -> 0.9 (Yellow) -> 1.0 (Red)
  gradient = { 0.4: "#2cba00", 0.65: "#a3ff00", 0.9: "#ffae00", 1.0: "#ff0000" },
  maxZoom = 18, // Max zoom level for the heatmap rendering
  minOpacity = 0.1, // Minimum opacity when zoomed out
  max = 1.0, // Corresponds to the max intensity value in the data array (usually 1.0 if normalized)
}) => {
  const map = useMap();

  useEffect(() => {
    let heatLayer = null;

    // Ensure map exists and data is a non-empty array with valid points
    if (!map || !Array.isArray(data) || data.length === 0) {
      // console.log("HeatmapLayer: No map or data provided.");
      // If layer exists from previous render, remove it
       map.eachLayer((layer) => {
          if (layer instanceof L.HeatLayer) {
            map.removeLayer(layer);
          }
       });
      return; // Do nothing if no data or map
    }

     // Validate data structure (simple check for first element)
     if (!Array.isArray(data[0]) || data[0].length < 3 || typeof data[0][0] !== 'number' || typeof data[0][1] !== 'number' || typeof data[0][2] !== 'number') {
         console.error("HeatmapLayer: Invalid data format. Expected [[lat, lng, intensity], ...]");
         return;
     }


    console.log(`HeatmapLayer: Rendering/Updating with ${data.length} data points.`);

    // Remove existing heatmap layer before adding a new one
    // This prevents layers stacking up on re-renders
     map.eachLayer((layer) => {
        if (layer instanceof L.HeatLayer) {
          map.removeLayer(layer);
        }
     });


    // Create heat layer instance
    heatLayer = L.heatLayer(data, {
      radius,
      blur,
      gradient,
      maxZoom,
      minOpacity,
      max, // Set the max intensity value
    });

    // Add layer to map
    heatLayer.addTo(map);

    // Cleanup function: remove the layer when the component unmounts or dependencies change significantly
    return () => {
       // console.log("HeatmapLayer: Cleaning up heatmap layer.");
      if (heatLayer && map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
      }
    };
  }, [map, data, radius, blur, gradient, maxZoom, minOpacity, max]); // Dependencies array

  // This component doesn't render anything itself
  return null;
};

export default HeatmapLayer;