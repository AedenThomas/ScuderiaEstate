// src/services/streetDataService.js

/**
 * Fetches property data for a given postcode via the backend proxy using the Street Data API.
 * @param {string} postcode - The UK postcode.
 * @param {string} tier - The data tier ('basic', 'core', 'premium'). Defaults to 'basic'.
 * @param {number} results - The maximum number of results per page. Defaults to 20.
 * @returns {Promise<Object>} - The API response data from the proxy.
 * @throws {Error} If the fetch fails or the proxy returns an error status.
 */
export const fetchStreetDataByPostcode = async (
  postcode,
  tier = "basic",
  results = 20
) => {
  const proxyBaseUrl =
    process.env.REACT_APP_API_BASE_URL || "http://localhost:3001";
  const proxyUrl = `${proxyBaseUrl}/api/street-data/postcode?postcode=${encodeURIComponent(
    postcode.trim()
  )}&tier=${tier}&results=${results}`;

  console.log(`Fetching Street Data via proxy: ${proxyUrl}`);

  try {
    const response = await fetch(proxyUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage =
        data?.error ||
        data?.detail ||
        `Street Data fetch failed: ${response.status} ${response.statusText}`;
      console.error(`Proxy Street Data fetch failed: ${response.status}`, data);
      throw new Error(errorMessage);
    }

    console.log(`Street Data received from proxy for ${postcode}:`, data);
    return data; // Return the full structure { data: [...], meta: {...} }
  } catch (error) {
    console.error("Error fetching Street Data via proxy:", error);
    throw new Error(error.message || "Network error fetching Street Data.");
  }
};

/**
 * (Optional) Fetches detailed data for a single property by Street Group ID.
 * NOTE: This would require another proxy endpoint (`/api/street-data/property/{id}`)
 *       and likely higher cost (e.g., 'core' or 'premium' tier).
 *       Implement this later if needed for the detail view.
 */
// export const fetchStreetPropertyDetails = async (streetGroupId, tier = 'core') => {
//     // ... implementation using a new proxy endpoint ...
// };
