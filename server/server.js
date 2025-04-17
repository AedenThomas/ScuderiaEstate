// server/server.js
require("dotenv").config(); // Load environment variables if needed later
const express = require("express");
const axios = require("axios");
const cors = require("cors");
// const urlencode = require('urlencode'); // Correct import for this library
const app = express();
const PORT = process.env.REACT_APP_PROXY_PORT || 3001; // Use port 3001 unless specified elsewere
const { URLSearchParams } = require("url"); // Import URLSearchParams
const { spawn } = require("child_process"); // <-- Add child_process
const path = require("path"); // <-- Add path for script location

// Configure CORS
// Allow requests specifically from your React app's origin
const corsOptions = {
  origin: process.env.REACT_APP_CLIENT_URL || "http://localhost:3000",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions));

// Optional: Middleware to parse JSON request bodies (if you send data in POST requests later)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

app.post("/api/predict-price", (req, res) => {
  const inputDetails = req.body; // e.g., { postcode, propertytype, ..., num_years }
  console.log("[Predict API] Received details:", inputDetails);

  // --- Basic Input Validation (Keep existing checks) ---
  const requiredFields = [
    "postcode",
    "propertytype",
    "duration",
    "numberrooms",
    "tfarea",
    "property_age",
  ];
  const missingFields = requiredFields.filter(
    (field) =>
      !(field in inputDetails) ||
      inputDetails[field] === null ||
      inputDetails[field] === ""
  );

  if (missingFields.length > 0) {
    console.error("[Predict API] Missing fields:", missingFields);
    return res.status(400).json({
      error: `Missing required property details: ${missingFields.join(", ")}`,
    });
  }

  // Validate num_years if provided (optional, Python also validates)
  const num_years = inputDetails.num_years ? parseInt(inputDetails.num_years, 10) : 1;
  if (isNaN(num_years) || num_years < 1 || num_years > 5) {
      console.warn("[Predict API] Invalid num_years received, defaulting to 1 for Python script.");
      inputDetails.num_years = 1; // Ensure a valid number is sent or let Python handle default
  }


  // --- Python Script Execution ---
  const pythonExecutable =
    process.env.PYTHON_EXECUTABLE || "python3" || "python";
  const scriptPath = path.join(__dirname, "predictor", "predict_price.py");

  if (!require("fs").existsSync(scriptPath)) {
    console.error(`[Predict API] Python script not found at: ${scriptPath}`);
    return res
      .status(500)
      .json({ error: "Prediction script not found on server." });
  }

  console.log(`[Predict API] Spawning: ${pythonExecutable} ${scriptPath}`);
  const pythonProcess = spawn(pythonExecutable, [scriptPath]);

  let predictionJson = "";
  let errorJson = "";

  // Send data (including num_years) to Python script via stdin
  try {
    // Make sure to stringify the whole inputDetails object which now includes num_years
    pythonProcess.stdin.write(JSON.stringify(inputDetails));
    pythonProcess.stdin.end();
    console.log("[Predict API] Sent data to Python stdin:", JSON.stringify(inputDetails));
  } catch (error) {
    console.error("[Predict API] Error writing to Python stdin:", error);
    if (pythonProcess && !pythonProcess.killed) {
      pythonProcess.kill();
    }
    return res
      .status(500)
      .json({ error: "Failed to send data to predictor process." });
  }

  // Capture stdout (prediction result - now expects {"predictions": [...]})
  pythonProcess.stdout.on("data", (data) => {
    predictionJson += data.toString();
     console.log(`[Predict Python STDOUT]: ${data.toString().trim()}`);
  });

  // Capture stderr (errors from Python)
  pythonProcess.stderr.on("data", (data) => {
    errorJson += data.toString();
    console.error(`[Predict Python STDERR]: ${data.toString().trim()}`);
  });

  // Handle Python script exit
  pythonProcess.on("close", (code) => {
    console.log(`[Predict API] Python script exited with code ${code}`);

    if (code === 0 && predictionJson) {
      try {
        const result = JSON.parse(predictionJson);
        // **** CHANGE: Expect 'predictions' array ****
        if (result && Array.isArray(result.predictions)) {
           console.log("[Predict API] Sending prediction list:", result);
           // Success: Send the prediction results back
           res.status(200).json(result); // Send the whole {"predictions": [...]} object
        } else {
          console.error(
            "[Predict API] Received invalid prediction format (expected {predictions: [...]}:",
            predictionJson
          );
          res.status(500).json({
            error: "Received invalid prediction format from predictor.",
            rawOutput: predictionJson,
          });
        }
      } catch (parseError) {
        console.error(
          "[Predict API] Failed to parse prediction JSON:",
          parseError,
          "Data:",
          predictionJson
        );
        res.status(500).json({
          error: "Failed to parse prediction result.",
          rawOutput: predictionJson,
        });
      }
    } else {
      // Failure: Parse the error from stderr if possible
      let errorDetail = `Prediction script failed (code ${code}).`;
      let pythonError = "Unknown error";
      if (errorJson) {
        try {
          const errResult = JSON.parse(errorJson);
          pythonError = errResult.error || JSON.stringify(errResult); // Use parsed error or raw string/JSON
        } catch (e) {
          pythonError = errorJson; // Use raw stderr if not JSON
        }
        errorDetail = `Prediction script failed: ${pythonError}`;
      }
       console.error(`[Predict API] Error response being sent: ${errorDetail}`);
       // Send the error JSON from Python if available, otherwise the generic message
       let responseError = { error: errorDetail };
       try {
            if(errorJson) responseError = JSON.parse(errorJson); // Send Python's structured error
       } catch(e){ /* Ignore parse error, use generic */ }
       res.status(500).json(responseError);
    }
  });

  // Handle errors spawning the process itself
  pythonProcess.on("error", (error) => {
    console.error(
      `[Predict API] Failed to start Python process: ${error.message}`
    );
    res
      .status(500)
      .json({ error: `Failed to start predictor process: ${error.message}` });
  });
});

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
      res.status(error.response.status).json({
        error: `Land Registry API error: ${error.response.status}`,
        details: error.response.data,
      });
    } else if (error.request) {
      console.error("[Proxy LR] No response received:", error.request);
      res.status(504).json({
        error: "No response received from Land Registry API (Gateway Timeout).",
      });
    } else {
      console.error("[Proxy LR] Error setting up request:", error.message);
      res
        .status(500)
        .json({ error: "Internal server error contacting Land Registry API." });
    }
  }
});

// --- NEW Scraper Endpoint using SSE ---
app.get("/api/scrape-listings", (req, res) => {
  // REMOVED async - SSE is event-driven
  const { postcode } = req.query;

  if (!postcode) {
    return res
      .status(400)
      .json({ error: "Postcode query parameter is required." });
  }
  const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;
  if (!postcodeRegex.test(postcode)) {
    return res
      .status(400)
      .json({ error: "Invalid UK postcode format provided." });
  }

  console.log(`[Proxy Scrape SSE] Received request for postcode: ${postcode}`);

  // --- Set Headers for SSE ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // Send headers immediately

  // Send an immediate "initialized" event to the client
  res.write(
    `event: status\ndata: ${JSON.stringify({
      status: "initialized",
      message: "Starting property search...",
    })}\n\n`
  );

  const scriptPath = path.join(__dirname, "scrapers", "scrape.py");
  const pythonExecutable =
    process.env.PYTHON_EXECUTABLE || "python3" || "python";
  let stdoutBuffer = ""; // Buffer for potentially incomplete lines
  let pythonProcess = null; // Declare process variable outside

  try {
    console.log(
      `[Proxy Scrape SSE] Executing: ${pythonExecutable} ${scriptPath} --postcode ${postcode}`
    );
    pythonProcess = spawn(pythonExecutable, [
      // Assign to the outer variable
      scriptPath,
      "--postcode",
      postcode,
    ]);

    // --- Handle stdout stream ---
    pythonProcess.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      let newlineIndex;

      // Process all complete lines in the buffer
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.substring(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1); // Remove processed line + newline

        if (line) {
          // Process only non-empty lines
          console.log(`[Scraper STDOUT Line]: ${line.substring(0, 100)}...`); // Log received line
          try {
            const parsedData = JSON.parse(line);

            // Determine message type based on parsed data structure
            if (parsedData.error) {
              console.error(
                "[Proxy Scrape SSE] Forwarding error event:",
                parsedData.error
              );
              res.write(`event: error\ndata: ${line}\n\n`); // Send error event
            } else if (parsedData.status === "complete") {
              console.log("[Proxy Scrape SSE] Forwarding complete event");
              res.write(`event: complete\ndata: ${line}\n\n`); // Send complete event
            } else if (parsedData.status === "no_results") {
              console.log("[Proxy Scrape SSE] Forwarding no_results status");
              res.write(`event: status\ndata: ${line}\n\n`); // Send custom status event
            } else {
              // Assume it's property data
              // console.log("[Proxy Scrape SSE] Forwarding property data event"); // Can be verbose
              res.write(`data: ${line}\n\n`); // Send standard message event
            }
          } catch (parseError) {
            console.error(
              `[Proxy Scrape SSE] Failed to parse JSON line: ${line}`,
              parseError
            );
            // Optionally send a parse error back to client? Or just log server-side.
            // res.write(`event: error\ndata: ${JSON.stringify({error: "Failed to parse data from scraper"})}\n\n`);
          }
        }
      } // end while loop
    });

    // --- Handle stderr stream (for debugging) ---
    pythonProcess.stderr.on("data", (data) => {
      // Log stderr from Python script for debugging
      console.error(`[Scraper STDERR]: ${data.toString().trim()}`);
    });

    // --- Handle Python script errors ---
    pythonProcess.on("error", (error) => {
      console.error(
        `[Proxy Scrape SSE] Failed to start subprocess: ${error.message}`
      );
      if (!res.writableEnded) {
        // Check if response stream is still open
        // Send error event before closing
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: `Failed to start scraper: ${error.message}`,
          })}\n\n`
        );
        res.end(); // Close the connection on spawn error
      }
    });

    // --- Handle Python script exit ---
    pythonProcess.on("close", (code) => {
      console.log(`[Proxy Scrape SSE] Python script exited with code ${code}`);
      if (!res.writableEnded) {
        // Check if response stream is still open
        if (code !== 0) {
          // If exited non-zero and no 'error' event was sent yet for this specific exit
          // It's possible an error JSON was printed just before exit
          console.error(
            `[Proxy Scrape SSE] Script exited non-zero (${code}), ensuring error state sent.`
          );
          // We might have already sent specific errors via stdout JSON parsing
          // Send a generic exit error ONLY if no specific error was likely sent.
          // This part is tricky. Relying on Python to print JSON errors is better.
          // We could send a final generic error if needed:
          // res.write(`event: error\ndata: ${JSON.stringify({ error: `Scraper exited with code ${code}` })}\n\n`);
        } else {
          // If exited cleanly (code 0), ensure 'complete' was sent.
          // Python script should send the 'complete' JSON itself.
          // We could force send a complete event here if needed, but it's better if Python does it.
          // res.write(`event: complete\ndata: ${JSON.stringify({ status: "complete", exitCode: code })}\n\n`);
        }
        console.log("[Proxy Scrape SSE] Closing SSE connection.");
        res.end(); // Close the SSE connection when Python process finishes
      }
    });

    // --- Handle Client Disconnect ---
    req.on("close", () => {
      console.log("[Proxy Scrape SSE] Client disconnected.");
      if (pythonProcess && !pythonProcess.killed) {
        console.log("[Proxy Scrape SSE] Killing Python process...");
        pythonProcess.kill("SIGTERM"); // Send termination signal
      }
      // Ensure response ends if not already
      if (!res.writableEnded) {
        res.end();
      }
    });
  } catch (error) {
    console.error(
      `[Proxy Scrape SSE] Error setting up scraper execution: ${error.message}`
    );
    if (!res.writableEnded) {
      try {
        // Try to send an error before closing if headers haven't been sent
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: "Internal server error starting scraper." });
        } else {
          // If headers sent, use SSE format for error
          res.write(
            `event: error\ndata: ${JSON.stringify({
              error: `Internal server error: ${error.message}`,
            })}\n\n`
          );
          res.end();
        }
      } catch (e) {
        console.error("Error sending error response:", e);
        if (!res.writableEnded) res.end();
      }
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
    return res.status(404).json({
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
