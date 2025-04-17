// server/server.js
require("dotenv").config(); // Load environment variables if needed later
const express = require("express");
const axios = require("axios");
const cors = require("cors");
// const urlencode = require('urlencode'); // Correct import for this library
const app = express();
const PORT = process.env.REACT_APP_PROXY_PORT || 3001; // Use port 3001 unless specified elsewere
const { URLSearchParams } = require("url"); // Import URLSearchParams

// Configure CORS
// Allow requests specifically from your React app's origin
const corsOptions = {
  origin: process.env.REACT_APP_CLIENT_URL || "http://localhost:3000",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions));

// Optional: Middleware to parse JSON request bodies (if you send data in POST requests later)
// app.use(express.json());

const NOMIS_DATA_DEFINITIONS = {
  Sex: {
    dataset_id: "NM_2028_1",
    dimension_code: "c_sex",
    dimension_values: "0,2,1",
    description: "Population estimates by sex.",
  },
  Age: {
    dataset_id: "NM_2018_1",
    dimension_code: "c2021_age_12a",
    dimension_values: "0...11",
    description: "Population estimates by age group (12 categories).",
  },
  "Country of Birth": {
    dataset_id: "NM_2019_1",
    dimension_code: "c2021_cob_8",
    dimension_values: "0,1001,1,2,3,4,5,6,7",
    description: "Population by country of birth (condensed).",
  },
  "Length of Residence": {
    dataset_id: "NM_2036_1",
    dimension_code: "c2021_resuk_6",
    dimension_values: "0,1,2,3,4,5",
    description: "Length of residence in the UK for non-UK born residents.",
  },
  "Legal Partnership Status": {
    dataset_id: "NM_2022_1",
    dimension_code: "c2021_lpstat_12",
    dimension_values: "0,1,1001,1002,1003,1004,1005,1006",
    description: "Population aged 16+ by legal partnership status.",
  },
  "Household Composition": {
    dataset_id: "NM_2023_1",
    dimension_code: "c2021_hhcomp_15",
    dimension_values: "0,1001,1002,1007",
    description: "Households by composition (selected categories).",
  },
  "Ethnic Group": {
    dataset_id: "NM_2041_1",
    dimension_code: "c2021_eth_20",
    dimension_values: "0,1001,1002,1003,1004,1005",
    description: "Population by ethnic group (condensed).",
  },
  "National Identity": {
    dataset_id: "NM_2046_1",
    dimension_code: "c2021_natiduk_17",
    dimension_values: "0...5,9995...9997",
    description: "Population by national identity.",
  },
  Religion: {
    dataset_id: "NM_2049_1",
    dimension_code: "c2021_religion_10",
    dimension_values: "0...9",
    description: "Population by religious affiliation.",
  },
  "Household Language": {
    dataset_id: "NM_2044_1",
    dimension_code: "c2021_hhlang_5",
    dimension_values: "0...4",
    description: "Households by main language.",
  },
  "Economic Activity": {
    dataset_id: "NM_2083_1",
    dimension_code: "c2021_eastat_20",
    dimension_values: "0,1001,1002,7,1006,1007,14,1011,15,16,17,18,19",
    description: "Population aged 16+ by economic activity status.",
  },
  "Hours Worked": {
    dataset_id: "NM_2076_1",
    dimension_code: "c2021_hours_5",
    dimension_values: "0,1001,1,2,1002,3,4",
    description: "Population aged 16+ in employment by hours worked per week.",
  },
  Industry: {
    dataset_id: "NM_2017_1",
    dimension_code: "c2021_ind_19",
    dimension_values: "0...18",
    description: "Population aged 16+ in employment by industry.",
  },
  Occupation: {
    dataset_id: "NM_2080_1",
    dimension_code: "c2021_occ_10",
    dimension_values: "0...9",
    description: "Population aged 16+ in employment by occupation.",
  },
  "Travel to Work": {
    dataset_id: "NM_2078_1",
    dimension_code: "c2021_ttwmeth_12",
    dimension_values: "0...11",
    description:
      "Population aged 16+ in employment by method of travel to work.",
  },
  Tenure: {
    dataset_id: "NM_2072_1",
    dimension_code: "c2021_tenure_9",
    dimension_values: "0,1,9996,1003,9997",
    description: "Households by tenure.",
  },
  "Accommodation Type": {
    dataset_id: "NM_2062_1",
    dimension_code: "c2021_acctype_9",
    dimension_values: "0...8",
    description: "Households by accommodation type.",
  },
  "Highest Qualification": {
    dataset_id: "NM_2084_1",
    dimension_code: "c2021_hiqual_8",
    dimension_values: "0...7",
    description: "Population aged 16+ by highest level of qualification.",
  },
  Students: {
    dataset_id: "NM_2085_1",
    dimension_code: "c2021_student_3",
    dimension_values: "0...2",
    description: "Population by student status.",
  },
  "General Health": {
    dataset_id: "NM_2055_1",
    dimension_code: "c2021_health_6",
    dimension_values: "0...5",
    description: "Population by self-reported general health.",
  },
  "Sexual Orientation": {
    dataset_id: "NM_2086_1",
    dimension_code: "c2021_sexor_9",
    dimension_values: "0...8",
    description: "Population aged 16+ by sexual orientation.",
  },
};

// --- Helper: Get Geocodes from Postcodes.io ---
async function getGeographyCodesForPostcode(postcode) {
  const cleanedPostcode = postcode.replace(/\s+/g, "").toUpperCase();
  const postcodeApiUrl = `https://api.postcodes.io/postcodes/${cleanedPostcode}`;
  console.log(`[Proxy Geo] Querying Postcodes.io for: ${cleanedPostcode}`);
  try {
    const response = await axios.get(postcodeApiUrl, { timeout: 10000 }); // 10 sec timeout
    if (response.data && response.data.status === 200 && response.data.result) {
      const result = response.data.result;
      const codes = result.codes || {};
      const gss_lsoa_code = codes.lsoa; // e.g., E01012239
      const gss_lad_code = codes.admin_district; // e.g., E06000004

      if (gss_lsoa_code && gss_lad_code) {
        console.log(
          `[Proxy Geo] Found LSOA: ${gss_lsoa_code}, LAD: ${gss_lad_code}`
        );
        return {
          lsoa_gss: gss_lsoa_code,
          lad_gss: gss_lad_code,
        };
      } else {
        console.error(
          `[Proxy Geo] Error: Missing LSOA or LAD GSS codes for ${cleanedPostcode}.`
        );
        return null;
      }
    } else {
      console.error(
        `[Proxy Geo] Error from Postcodes.io for ${cleanedPostcode}: ${
          response.data?.error || "Unknown error"
        }`
      );
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error(
        `[Proxy Geo] HTTP Error ${error.response.status} querying Postcodes.io for ${cleanedPostcode}.`
      );
    } else if (error.request) {
      console.error(
        `[Proxy Geo] Timeout or network error querying Postcodes.io for ${cleanedPostcode}.`
      );
    } else {
      console.error(
        `[Proxy Geo] Error during postcode lookup for ${cleanedPostcode}:`,
        error.message
      );
    }
    return null;
  }
}

// --- Land Registry API Endpoint (Existing) ---
app.get("/api/land-registry", async (req, res) => {
  // ... (existing Land Registry proxy code - ensure it uses the corrected postcode format)
  const { postcode } = req.query;
  if (!postcode)
    return res
      .status(400)
      .json({ error: "Postcode query parameter is required." });
  const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
  if (!postcodeRegex.test(postcode))
    return res
      .status(400)
      .json({ error: "Invalid UK postcode format provided." });

  // Keep space, trim/uppercase for Land Registry
  const formattedPostcodeLR = postcode.trim().toUpperCase();
  const targetUrlLR = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(
    formattedPostcodeLR
  )}`;

  console.log(`[Proxy LR] Received request for postcode: ${postcode}`);
  console.log(`[Proxy LR] Forwarding request to: ${targetUrlLR}`);

  try {
    const apiResponse = await axios.get(targetUrlLR, {
      headers: { Accept: "application/json" },
      timeout: 15000,
    });
    console.log(
      `[Proxy LR] Land Registry API responded with status: ${apiResponse.status}`
    );
    res.status(apiResponse.status).json(apiResponse.data);
  } catch (error) {
    console.error(
      "[Proxy LR] Error fetching data from Land Registry API:",
      error.message
    );
    if (error.response) {
      console.error(
        "[Proxy LR] Land Registry Error Status:",
        error.response.status
      );
      console.error(
        "[Proxy LR] Land Registry Error Data:",
        error.response.data
      );
      res
        .status(error.response.status)
        .json({
          error: `Land Registry API error: ${error.response.status}`,
          details: error.response.data,
        });
    } else if (error.request) {
      console.error("[Proxy LR] No response received:", error.request);
      res
        .status(504)
        .json({
          error:
            "No response received from Land Registry API (Gateway Timeout).",
        });
    } else {
      console.error("[Proxy LR] Error setting up request:", error.message);
      res
        .status(500)
        .json({ error: "Internal server error contacting Land Registry API." });
    }
  }
});

// --- NEW Demographics API Endpoint ---
app.get("/api/demographics", async (req, res) => {
  const { postcode } = req.query;

  if (!postcode) {
    return res
      .status(400)
      .json({ error: "Postcode query parameter is required." });
  }
  console.log(`[Proxy Demo] Received request for postcode: ${postcode}`);

  // 1. Get Geography Codes (LSOA, LAD)
  const geoCodes = await getGeographyCodesForPostcode(postcode);
  if (!geoCodes) {
    return res
      .status(404)
      .json({
        error: `Could not find geographic codes (LSOA/LAD) for postcode ${postcode}.`,
      });
  }

  const geographyParam = `${geoCodes.lsoa_gss},${geoCodes.lad_gss}`;
  console.log(
    `[Proxy Demo] Using geography parameter for Nomis: ${geographyParam}`
  );

  // 2. Fetch data for each topic from Nomis
  const results = {}; // Initialize empty results object
  const nomisBaseUrl = "https://www.nomisweb.co.uk/api/v01";
  let fetchErrors = [];

  // --- Define the array of promises ---
  const fetchPromises = Object.entries(NOMIS_DATA_DEFINITIONS).map(
    async ([topic, definition]) => {
      const params = {
        date: "latest",
        geography: geographyParam,
        [definition.dimension_code]: definition.dimension_values,
        measures: "20100",
      };

      const searchParams = new URLSearchParams(params);
      const queryString = searchParams.toString();
      const nomisUrl = `${nomisBaseUrl}/${definition.dataset_id}.data.json?${queryString}`;
      // console.log(`[Proxy Demo] Fetching ${topic} from: ${nomisUrl}`); // Optional detailed log

      try {
        const response = await axios.get(nomisUrl, {
          headers: { Accept: "application/json" },
          timeout: 20000,
        });
        // console.log(`[Proxy Demo] Success for ${topic} (${response.status})`); // Redundant if logged later
        return { topic, data: response.data };
      } catch (error) {
        let errorMessage = `Failed to fetch ${topic} (${definition.dataset_id}).`;
        if (error.response) {
          errorMessage += ` Status: ${error.response.status}.`;
          console.error(
            `[Proxy Demo] Nomis Error for ${topic}: ${error.response.status}`,
            error.response.data
              ? JSON.stringify(error.response.data).substring(0, 200)
              : ""
          );
        } else if (error.request) {
          errorMessage += ` No response/Timeout.`;
          console.error(`[Proxy Demo] Nomis Timeout/No Response for ${topic}`);
        } else {
          errorMessage += ` Error: ${error.message}`;
          console.error(
            `[Proxy Demo] Nomis Request Setup Error for ${topic}: ${error.message}`
          );
        }
        // Don't push to fetchErrors here, do it when processing settled results
        return { topic, data: null, error: errorMessage }; // Indicate error for this specific topic
      }
    }
  );

  // --- Wait for all promises to settle ---
  const settledResults = await Promise.allSettled(fetchPromises);

  // --- Process settled results (with added debugging) ---
  console.log(
    `[Proxy Demo] Processing ${settledResults.length} settled results...`
  );
  settledResults.forEach((result, index) => {
    // console.log(`[Proxy Demo] --- Result ${index + 1} ---`); // Optional detailed logs
    // console.log(`[Proxy Demo] Status: ${result.status}`);

    if (result.status === "fulfilled") {
      // console.log(`[Proxy Demo] Value:`, JSON.stringify(result.value, null, 2)); // Optional detailed logs

      if (result.value && result.value.topic) {
        if (result.value.data) {
          // console.log(`[Proxy Demo] Success: Adding data for topic: ${result.value.topic}`); // Optional
          results[result.value.topic] = result.value.data;
        } else if (result.value.error) {
          console.warn(
            `[Proxy Demo] Error recorded for topic ${result.value.topic}: ${result.value.error}`
          );
          results[result.value.topic] = { error: result.value.error, obs: [] }; // Add error marker to results
          if (!fetchErrors.includes(result.value.error)) {
            fetchErrors.push(result.value.error); // Collect unique errors
          }
        } else {
          console.warn(
            `[Proxy Demo] Fulfilled promise for topic ${result.value.topic} but no data or error found in value.`
          );
        }
      } else {
        console.error(
          "[Proxy Demo] Fulfilled promise but value structure is unexpected:",
          result.value
        );
      }
    } else if (result.status === "rejected") {
      console.error(`[Proxy Demo] Promise rejected. Reason:`, result.reason);
      const reasonMsg =
        result.reason?.message || result.reason || "Unknown rejection reason";
      if (!fetchErrors.includes(reasonMsg)) {
        fetchErrors.push(`Fetch failed: ${reasonMsg}`);
      }
    }
    // console.log(`[Proxy Demo] --- End Result ${index + 1} ---`); // Optional detailed logs
  });
  // --- End Processing ---

  // Check if the results object is populated
  const topicsAddedCount = Object.keys(results).length;
  console.log(
    `[Proxy Demo] Topics added to results object: ${topicsAddedCount}`
  );

  if (topicsAddedCount === 0 && fetchErrors.length > 0) {
    // If ALL fetches failed or resulted in no data added
    console.error(
      "[Proxy Demo] All demographic fetches failed or resulted in no data being added."
    );
    return res.status(502).json({
      error: "Failed to fetch any demographic data from Nomis.",
      details: fetchErrors,
    });
  }

  // Return the aggregated results
  console.log(
    `[Proxy Demo] Returning aggregated demographics for ${postcode}. Topics returned: ${topicsAddedCount}`
  );
  res.status(200).json({
    postcode: postcode,
    geoCodes: geoCodes,
    demographics: results, // Send the populated results object
    fetchErrors: fetchErrors, // Send collected errors
  });
}); // End of app.get

// --- API Proxy Endpoint ---
app.get("/api/land-registry", async (req, res) => {
  const { postcode } = req.query; // Get postcode from query param ?postcode=XYZ

  if (!postcode) {
    return res
      .status(400)
      .json({ error: "Postcode query parameter is required." });
  }

  // Basic postcode validation (you can enhance this)
  const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
  if (!postcodeRegex.test(postcode)) {
    return res
      .status(400)
      .json({ error: "Invalid UK postcode format provided." });
  }

  // --- Prepare postcode for Land Registry API ---
  // Trim, uppercase, and REMOVE spaces - this often works better for APIs
  const formattedPostcode = postcode.trim().toUpperCase();
  const itemsPerPage = 500; // Keep limit
  const targetUrl = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(
    formattedPostcode
  )}`;
  console.log(`[Proxy] Received request for postcode: ${postcode}`);
  // The logged URL should now show %20 for the space if the input had one
  console.log(`[Proxy] Forwarding request to: ${targetUrl}`);

  // ^^ Note: Still using encodeURIComponent for safety, even after removing space.

  console.log(`[Proxy] Received request for postcode: ${postcode}`);
  console.log(`[Proxy] Forwarding request to: ${targetUrl}`);

  try {
    const apiResponse = await axios.get(targetUrl, {
      headers: {
        Accept: "application/json",
        // Add any other headers the Land Registry API might require if needed
        // 'User-Agent': 'YourRealEstateApp/1.0 (contact@yourapp.com)' // Good practice
      },
      // Important: Set timeout to prevent hanging indefinitely
      timeout: 15000, // 15 seconds timeout
    });

    console.log(
      `[Proxy] Land Registry API responded with status: ${apiResponse.status}`
    );
    // Forward the successful response data from Land Registry back to the React app
    res.status(apiResponse.status).json(apiResponse.data);
  } catch (error) {
    console.error(
      "[Proxy] Error fetching data from Land Registry API:",
      error.message
    );

    // Handle specific error types from Axios
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error(
        "[Proxy] Land Registry Error Status:",
        error.response.status
      );
      console.error("[Proxy] Land Registry Error Data:", error.response.data);
      // Forward the error status and data from Land Registry
      res.status(error.response.status).json({
        error: `Land Registry API error: ${error.response.status}`,
        details: error.response.data, // Forward details if available
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error(
        "[Proxy] No response received from Land Registry:",
        error.request
      );
      res.status(504).json({
        error: "No response received from Land Registry API (Gateway Timeout).",
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error(
        "[Proxy] Error setting up Land Registry request:",
        error.message
      );
      res.status(500).json({
        error: "Internal server error while contacting Land Registry API.",
      });
    }
  }
});

// --- Basic Root Route (optional, for testing) ---
app.get("/", (req, res) => {
  res.send("Real Estate App Proxy Server is running!");
});

// --- Start the server ---
app.listen(PORT, () => {
  console.log(`[Proxy] Server listening on port ${PORT}`);
  console.log(`[Proxy] Allowing requests from: ${corsOptions.origin}`);
});
