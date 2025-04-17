# server/predictor/predict_price.py
import pandas as pd
import numpy as np
import joblib
import json
import sys
import os
from datetime import datetime
import locale
import traceback

# --- Configuration --- (Keep existing)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(SCRIPT_DIR, "trained_pipeline.pkl")
POSTCODE_MAP_PATH = os.path.join(SCRIPT_DIR, "postcode_map.json")
BOROUGH_STATS_PATH = os.path.join(SCRIPT_DIR, "borough_stats.json")
BOROUGH_GROWTH_PATH = os.path.join(SCRIPT_DIR, "borough_growth.json")

# Set locale (Keep existing)
try:
    locale.setlocale(locale.LC_ALL, "en_GB.UTF-8")
except locale.Error:
    try:
        locale.setlocale(locale.LC_ALL, "en_US.UTF-8")
    except locale.Error:
        pass  # Continue without specific locale if both fail


# --- Helper Functions --- 
def find_borough(postcode, postcode_map):
    # ... (keep existing logic) ...
    return None  # Borough not found


def engineer_features(
    df_input, prediction_year, prediction_month, borough_stats_map,
    borough_growth_rates, base_year_for_growth
):
    """Feature engineering adjusted for multi-year prediction & growth."""
    # Start with a copy of the input DataFrame
    df_engineered = df_input.copy() # Use a different name initially to avoid confusion

    # --- Data Type Conversions & Handling Errors ---
    # Convert to numeric, fill NaNs resulting from conversion errors or original NaNs
    df_engineered["property_age"] = pd.to_numeric(df_engineered["property_age"], errors='coerce').fillna(0)
    df_engineered["numberrooms"] = pd.to_numeric(df_engineered["numberrooms"], errors='coerce').fillna(1).replace(0, 1) # Ensure at least 1 room
    df_engineered["tfarea"] = pd.to_numeric(df_engineered["tfarea"], errors='coerce') # Keep NaN if invalid for now

    # Ensure minimum values after potential fillna
    df_engineered["property_age"] = df_engineered["property_age"].apply(lambda x: max(0, x)) # Min age 0
    df_engineered["numberrooms"] = df_engineered["numberrooms"].apply(lambda x: max(1, x)) # Min rooms 1

    # --- Temporal Features ---
    df_engineered["sale_year"] = prediction_year
    df_engineered["sale_month"] = prediction_month
    df_engineered["sale_quarter"] = (prediction_month - 1) // 3 + 1

    # --- Construction Age Band ---
    # Use prediction_year to calculate age at time of prediction
    construction_year = prediction_year - df_engineered["property_age"]
    conditions = [
        (construction_year < 1900),
        (construction_year >= 1900) & (construction_year <= 1950),
        (construction_year > 1950) & (construction_year <= 2000),
        (construction_year > 2000),
    ]
    choices = ["pre1900", "1900-1950", "1951-2000", "2001+"]
    # Assign directly to the DataFrame being built
    df_engineered["CONSTRUCTION_AGE_BAND"] = np.select(conditions, choices, default="2001+")

    # --- Area Features ---
    # Use intermediate safe columns to avoid division by zero or NaN issues
    tfarea_safe = df_engineered["tfarea"].replace(0, np.nan)
    numberrooms_safe = df_engineered["numberrooms"].replace(0, np.nan) # Already ensured >= 1 above, but belt-and-suspenders
    # Calculate room_size, handle potential NaN/Inf from division
    df_engineered["room_size"] = (tfarea_safe / numberrooms_safe).replace([np.inf, -np.inf], np.nan)
    # Fill NaN room_size if necessary (e.g., with median or 0, depending on model needs)
    # Example: df_engineered["room_size"].fillna(df_engineered["room_size"].median(), inplace=True)
    # Or fill with 0 if that makes more sense:
    df_engineered["room_size"].fillna(0, inplace=True) # Example: fill NaN room_size with 0


    # --- Borough Features (incorporating growth) ---
    default_stats = borough_stats_map.get("_DEFAULT_", {"mean": 800000, "std": 0})
    default_growth = borough_growth_rates.get("_DEFAULT_", 0.02)

    # Apply borough logic row-wise if predicting multiple rows (though usually just one)
    def get_borough_mean(row):
        borough = row["borough"]
        current_borough_stats = borough_stats_map.get(borough, default_stats)
        current_borough_growth = borough_growth_rates.get(borough, default_growth)
        year_offset = prediction_year - base_year_for_growth
        base_mean_price = current_borough_stats["mean"]
        # Apply CAGR formula: Price_future = Price_base * (1 + growth_rate)^years
        adjusted_borough_mean = base_mean_price * ((1 + current_borough_growth) ** max(0, year_offset))
        return adjusted_borough_mean

    df_engineered["borough_mean_price"] = df_engineered.apply(get_borough_mean, axis=1)

    # --- Price Ratio Feature ---
    # Required for prediction, assumed to be 1.0 as future price isn't known
    df_engineered["price_to_borough_mean"] = 1.0

    # --- Final Cleanup ---
    # Fill any remaining NaNs if the model requires it (e.g., fill tfarea NaNs)
    # Example: df_engineered['tfarea'].fillna(df_engineered['tfarea'].median(), inplace=True)
    # Or fill with 0 if appropriate:
    df_engineered['tfarea'].fillna(70, inplace=True) # Example: fill NaN tfarea with default 70

    # Replace any lingering infinities just in case
    df_engineered.replace([np.inf, -np.inf], np.nan, inplace=True)
    # Final check for NaNs - decide how to handle based on model training
    if df_engineered.isnull().any().any():
         print("Warning: NaNs still present in engineered features:", file=sys.stderr)
         print(df_engineered.isnull().sum(), file=sys.stderr)
         # Option: Fill remaining NaNs globally (use with caution)
         # df_engineered.fillna(0, inplace=True)

    # --- Return the engineered DataFrame ---
    return df_engineered # Return the DataFrame we've been modifying


# --- Main Execution ---
if __name__ == "__main__":
    results_list = []
    error_output = None  # Initialize error_output to None
    input_data_str = ""  # Store input string for debugging

    try:
        # --- 1. Load Model and Helper Data ---
        print("Python script started", file=sys.stderr, flush=True)  # Debug print
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
        model_pipeline = joblib.load(MODEL_PATH)

        if not os.path.exists(POSTCODE_MAP_PATH):
            raise FileNotFoundError(
                f"Postcode map file not found at {POSTCODE_MAP_PATH}"
            )
        with open(POSTCODE_MAP_PATH, "r") as f:
            postcode_map = json.load(f)

        if not os.path.exists(BOROUGH_STATS_PATH):
            raise FileNotFoundError(
                f"Borough stats file not found at {BOROUGH_STATS_PATH}"
            )
        with open(BOROUGH_STATS_PATH, "r") as f:
            borough_stats = json.load(f)

        if not os.path.exists(BOROUGH_GROWTH_PATH):
            raise FileNotFoundError(
                f"Borough growth file not found at {BOROUGH_GROWTH_PATH}"
            )
        with open(BOROUGH_GROWTH_PATH, "r") as f:
            borough_growth_rates = json.load(f)
        print("Helper data loaded", file=sys.stderr, flush=True)  # Debug print

        # --- 2. Read Input Data from Node.js (stdin) ---
        input_data_str = sys.stdin.read()
        if not input_data_str:
            # If no input, maybe return specific error JSON?
            error_output = {"error": "No input data received from stdin."}
            # Don't raise exception here, let the final print handle it
        else:
            try:
                input_data = json.loads(input_data_str)
            except json.JSONDecodeError as e:
                # If input is invalid JSON, set specific error
                error_output = {
                    "error": f"Invalid JSON input: {str(e)}",
                    "received_data": input_data_str[:500],
                }  # Truncate long data
                # Don't raise, let final print handle it

        # Proceed only if input was read and parsed correctly
        if not error_output:
            print(
                f"Received input: {input_data}", file=sys.stderr, flush=True
            )  # Debug print
            # Extract prediction years (default to 1 if not provided)
            num_years_to_predict = int(input_data.get("num_years", 1))
            if not (1 <= num_years_to_predict <= 5):
                num_years_to_predict = 1

            # Remove num_years from property details
            property_details = {k: v for k, v in input_data.items() if k != "num_years"}

            # --- 3. Prepare Base DataFrame ---
            # property_details["dateoftransfer"] = datetime.now().strftime("%Y-%m-%d") # Not strictly needed if pipeline doesn't use it
            user_input_df = pd.DataFrame([property_details])

            # --- 4. Find Borough ---
            raw_postcode = user_input_df.loc[0, "postcode"]
            borough = find_borough(raw_postcode, postcode_map)
            user_input_df["borough"] = borough if borough else "_DEFAULT_"
            if not borough:
                print(
                    f"Warning: Borough not found for postcode '{raw_postcode}'. Using default.",
                    file=sys.stderr,
                    flush=True,
                )

            # --- 5. Prediction Loop ---
            current_year = datetime.now().year
            current_month = datetime.now().month
            base_year_for_growth_calc = current_year
            predicted_price_current_year = None

            print(
                "Starting prediction loop...", file=sys.stderr, flush=True
            )  # Debug print
            for year_offset in range(num_years_to_predict):
                prediction_year = current_year + year_offset
                print(
                    f"Engineering features for {prediction_year}",
                    file=sys.stderr,
                    flush=True,
                )  # Debug print

                user_input_engineered_df = engineer_features(
                    user_input_df.copy(),
                    prediction_year,
                    current_month,
                    borough_stats,
                    borough_growth_rates,
                    base_year_for_growth_calc,
                )
                print(
                    f"Features engineered: {user_input_engineered_df.to_dict('records')}",
                    file=sys.stderr,
                    flush=True,
                )  # Debug print

                # Predict using the model
                # Add check for required columns before predict
                required_model_cols = (
                    model_pipeline.feature_names_in_
                )  # Or get from somewhere else if needed
                missing_cols = [
                    col
                    for col in required_model_cols
                    if col not in user_input_engineered_df.columns
                ]
                if missing_cols:
                    raise ValueError(
                        f"Missing columns required by the model: {missing_cols}"
                    )

                # Handle potential NaN in input features before prediction
                # Option 1: Fill with a default/median if appropriate for your model
                # user_input_engineered_df.fillna(0, inplace=True) # Example: Fill with 0, adjust as needed
                # Option 2: Drop rows with NaN (only if your pipeline handles it or you expect complete data)
                # user_input_engineered_df.dropna(inplace=True)
                # if user_input_engineered_df.empty:
                #     raise ValueError("Input data became empty after handling NaNs.")

                print(
                    f"Predicting for year {prediction_year}...",
                    file=sys.stderr,
                    flush=True,
                )  # Debug print
                raw_model_prediction = model_pipeline.predict(user_input_engineered_df)[
                    0
                ]
                print(
                    f"Raw prediction: {raw_model_prediction}",
                    file=sys.stderr,
                    flush=True,
                )  # Debug print

                # --- Blending Logic --- (Keep existing)
                final_predicted_price = raw_model_prediction
                if year_offset == 0:
                    predicted_price_current_year = raw_model_prediction
                if year_offset > 0 and predicted_price_current_year is not None:
                    borough_name = user_input_df["borough"].iloc[0]
                    growth_rate = borough_growth_rates.get(
                        borough_name, borough_growth_rates.get("_DEFAULT_", 0.02)
                    )
                    trend_projection = predicted_price_current_year * (
                        (1 + growth_rate) ** year_offset
                    )
                    blended_price = 0.7 * raw_model_prediction + 0.3 * trend_projection
                    final_predicted_price = blended_price

                # Validate prediction
                if pd.isna(final_predicted_price) or not np.isfinite(
                    final_predicted_price
                ):
                    raise ValueError(
                        f"Prediction resulted in NaN/infinite value for year {prediction_year}."
                    )

                # Store result
                results_list.append(
                    {
                        "year": prediction_year,
                        "predicted_price": float(final_predicted_price),
                    }
                )
            print(
                "Prediction loop finished.", file=sys.stderr, flush=True
            )  # Debug print

    # ========== Standardized Error Handling ==========
    except FileNotFoundError as e:
        error_output = {"error": f"Configuration file missing: {str(e)}"}
        print(f"ERROR: {error_output['error']}", file=sys.stderr, flush=True)
    except KeyError as e:
        error_output = {"error": f"Missing expected input field: {str(e)}"}
        print(f"ERROR: {error_output['error']}", file=sys.stderr, flush=True)
    except ValueError as e:  # Catch data validation errors
        error_output = {"error": f"Data validation error: {str(e)}"}
        print(f"ERROR: {error_output['error']}", file=sys.stderr, flush=True)
    except ImportError as e:
        error_output = {"error": f"Missing Python library: {str(e)}"}
        print(f"ERROR: {error_output['error']}", file=sys.stderr, flush=True)
    except Exception as e:
        # Generic catch-all, include traceback details in the error message
        err_type = type(e).__name__
        tb_str = traceback.format_exc()
        error_output = {
            "error": f"Unexpected prediction error: {err_type}",
            "details": str(e),
            "traceback": tb_str.splitlines(),
        }
        print(
            f"ERROR: Unexpected error during prediction.", file=sys.stderr, flush=True
        )
        print(
            tb_str, file=sys.stderr, flush=True
        )  # Print traceback to stderr for server logs

    # ========== Final Output ==========
    # ALWAYS print valid JSON to stdout
    if error_output:
        # If an error occurred at any point, print the error JSON
        print(json.dumps(error_output), flush=True)
        sys.exit(0)  # Exit gracefully even on error, sending JSON error back
    else:
        # If no errors, print the successful prediction JSON
        output_json = {"predictions": results_list}
        print(
            "Preparing to print JSON success output.", file=sys.stderr, flush=True
        )  # Debug print
        print(json.dumps(output_json), flush=True)
        sys.exit(0)  # Exit successfully

    # Fallback exit (should not be reached ideally)
    sys.exit(1)
