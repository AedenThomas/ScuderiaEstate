// src/services/landRegistryService.js

/**
 * Fetch property transaction data VIA PROXY from Land Registry API by postcode
 * @param {string} postcode - UK postcode to search for
 * @returns {Promise<Object>} - API response data from proxy or throws error
 */
export const fetchPropertyDataByPostcode = async (postcode) => {
  // Use the proxy server URL (running on port 3001 by default)
  const proxyBaseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';
  // Clean the postcode slightly before sending? Proxy does more cleaning.
  const cleanedPostcode = postcode.trim();
  const proxyUrl = `${proxyBaseUrl}/api/land-registry?postcode=${encodeURIComponent(cleanedPostcode)}`;

  console.log(`Fetching Land Registry data via proxy: ${proxyUrl}`);

  try {
    const response = await fetch(proxyUrl, {
        headers: {
            'Accept': 'application/json'
            // No Origin or CORS headers needed here - browser handles it
        }
    });
    let rawDataText = "Could not read raw text"; // Default
    try {
      rawDataText = await response.clone().text(); // Clone response to read text without consuming body for JSON parsing
      console.log("Raw response text from proxy:", rawDataText);
   } catch (textError) {
      console.error("Error reading raw response text:", textError);
   }
   // --- END OF ADDED LOG ---

    // Get the response body as JSON
    const data = await response.json(); // Always try to parse JSON first

    if (!response.ok) {
        // Use the error message provided by the proxy if available
        const errorMessage = data?.error || `Proxy error: ${response.status} ${response.statusText}`;
        console.error(`Proxy fetch failed: ${response.status}`, data);
        throw new Error(errorMessage);
    }

    console.log(`Proxy API Response items count: ${data?.result?.items?.length ?? 0}`);
    // Assuming the proxy forwards the original Land Registry structure on success
    return data;

  } catch (error) {
    // Catch fetch errors (network down) or errors thrown from !response.ok
    console.error("Error fetching property data via proxy:", error);
    // Re-throw the error so the calling function (in App.js) can handle it
    // Make sure the error message is useful
    throw new Error(error.message || "Network error or proxy unreachable.");
  }
};

// --- formatTransactionData and calculatePriceGrowth remain the same ---
// (Make sure they correctly handle the data structure returned by the proxy,
// which *should* be the same as the original Land Registry structure on success)

/**
 * Format transaction data from Land Registry API
 * @param {Object} apiData - Raw API response (forwarded by proxy)
 * @returns {Array} - Formatted transaction data
 */
export const formatTransactionData = (apiData) => {
  // ... (Keep existing code from previous step)
  // Check for the actual items array, which should be inside 'result'
   if (!apiData || !apiData.result || !apiData.result.items || apiData.result.items.length === 0) {
     // Check if the proxy returned an error structure instead
     if (apiData?.error) {
         console.warn(`formatTransactionData received an error object from proxy: ${apiData.error}`);
         return []; // Return empty if proxy indicated an error upstream
     }
     console.log("formatTransactionData: No transaction items found in API data.");
     return [];
   }

   const transactions = apiData.result.items.map((item) => {
      // ... (rest of mapping logic remains the same)
       let transactionDate = null;
       try {
         transactionDate = new Date(item.transactionDate);
         if (isNaN(transactionDate.getTime())) {
           console.warn(`Invalid date format encountered: ${item.transactionDate} for ID ${item.transactionId}`);
           transactionDate = null;
         }
       } catch (e) {
         console.error(`Error parsing date: ${item.transactionDate} for ID ${item.transactionId}`, e);
         transactionDate = null;
       }
       const paon = item.propertyAddress?.paon || '';
       const saon = item.propertyAddress?.saon || '';
       const street = item.propertyAddress?.street || '';
       const addressLine = `${saon} ${paon} ${street}`.replace(/\s+/g, ' ').trim();

       return {
         id: item.transactionId,
         date: transactionDate,
         price: item.pricePaid,
         address: addressLine || "Address not specified",
         town: item.propertyAddress?.town || "Unknown Town",
         postcode: item.propertyAddress?.postcode || "Unknown Postcode",
         propertyType: item.propertyType?.prefLabel?.[0]?._value || "Unknown Type",
         isNewBuild: item.newBuild === true,
       };
   })
   .filter(t => t.date !== null && typeof t.price === 'number' && !isNaN(t.price));

   console.log(`Formatted ${transactions.length} valid transactions.`);
   return transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
};


/**
 * Calculate price growth metrics from transaction data
 * @param {Array} transactions - Formatted transaction data
 * @returns {Object} - Price growth metrics
 */
export const calculatePriceGrowth = (transactions) => {
  // ... (Keep existing code from previous step)
   const noResult = { priceRange: { min: 0, max: 0 }, growth: "No result", annualizedReturn: "No result" };
   if (!Array.isArray(transactions) || transactions.length < 2) {
     console.log("Price Growth: Not enough data points (< 2).");
     return { ...noResult, growth: "Not enough data", annualizedReturn: "Not enough data"};
   }
   const sortedTransactions = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());
   if (sortedTransactions.length < 2) { return { ...noResult, growth: "Not enough data", annualizedReturn: "Not enough data"}; }
   const prices = sortedTransactions.map((t) => t.price);
   const minPrice = Math.min(...prices);
   const maxPrice = Math.max(...prices);
   const firstTransaction = sortedTransactions[0];
   const latestTransaction = sortedTransactions[sortedTransactions.length - 1];
   if (isNaN(firstTransaction.price) || isNaN(latestTransaction.price) || firstTransaction.price <= 0) {
     console.warn("Price Growth: Invalid price data for calculation.");
     return { priceRange: { min: minPrice, max: maxPrice }, growth: "Calculation error", annualizedReturn: "Calculation error" };
   }
   const priceChange = latestTransaction.price - firstTransaction.price;
   const percentageChange = (priceChange / firstTransaction.price) * 100;
   const timeDiffMs = latestTransaction.date.getTime() - firstTransaction.date.getTime();
   const yearsDiff = timeDiffMs > 0 ? timeDiffMs / (1000 * 60 * 60 * 24 * 365.25) : 0;
   let annualizedReturnFormatted = "No result";
   if (yearsDiff > 0) {
     const annualizedReturn = (Math.pow(latestTransaction.price / firstTransaction.price, 1 / yearsDiff) - 1) * 100;
     if (!isNaN(annualizedReturn)) { annualizedReturnFormatted = `${annualizedReturn.toFixed(1)}% p.a.`; }
     else { annualizedReturnFormatted = "Calculation error"; }
   } else if (yearsDiff === 0 && percentageChange !== 0) { annualizedReturnFormatted = "Significant change within same year"; }
   else if (yearsDiff === 0 && percentageChange === 0) { annualizedReturnFormatted = "0.0% p.a."; }

   console.log(`Price Growth Calculated: Growth=${percentageChange.toFixed(1)}%, Annualized=${annualizedReturnFormatted}`);
   return {
     priceRange: { min: minPrice, max: maxPrice },
     growth: `${percentageChange > 0 ? '+' : ''}${percentageChange.toFixed(1)}% over ${yearsDiff.toFixed(1)} years`,
     annualizedReturn: annualizedReturnFormatted,
   };
};