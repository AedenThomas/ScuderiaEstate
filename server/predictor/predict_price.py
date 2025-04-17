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

# --- Configuration ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(SCRIPT_DIR, "trained_pipeline.pkl")
POSTCODE_MAP_PATH = os.path.join(SCRIPT_DIR, "postcode_map.json")
BOROUGH_STATS_PATH = os.path.join(SCRIPT_DIR, "borough_stats.json")
BOROUGH_GROWTH_PATH = os.path.join(SCRIPT_DIR, "borough_growth.json")  # New path

# Set locale
try:
    locale.setlocale(locale.LC_ALL, "en_GB.UTF-8")
except locale.Error:
    try:
        locale.setlocale(locale.LC_ALL, "en_US.UTF-8")
    except locale.Error:
        pass


# --- Helper Functions ---
def find_borough(postcode, postcode_map):
    """Finds borough using outward code matching (improved robustness)."""
    if pd.isna(postcode) or not isinstance(postcode, str):
        return None
    postcode = str(postcode).strip().upper().replace(" ", "")  # Normalize more

    # Exact match first
    if postcode in postcode_map:
        return postcode_map[postcode]

    # Try matching outward code (e.g., SW1A from SW1A0AA)
    outward_code = None
    if len(postcode) >= 5:  # Basic check for UK format length
        # Regex might be better, but simple slicing is often sufficient
        if postcode[-3].isdigit() and postcode[-2].isalpha() and postcode[-1].isalpha():
            outward_code = postcode[:-3]
        elif (
            postcode[-4].isdigit()
            and postcode[-3].isalpha()
            and postcode[-2].isalpha()
            and postcode[-1].isalpha()
        ):  # Handle shorter postcodes like G11AA
            outward_code = postcode[:-3]

    if outward_code:
        # Find boroughs matching the outward code prefix
        matching_boroughs = {
            pc: b
            for pc, b in postcode_map.items()
            if str(pc).replace(" ", "").startswith(outward_code)
        }

        if matching_boroughs:
            # Return the most common borough for this outward code
            borough_counts = pd.Series(matching_boroughs.values()).value_counts()
            if not borough_counts.empty:
                return borough_counts.index[0]  # Most frequent borough

    # Fallback: Try matching first 2/3 chars if outward code failed
    if len(postcode) >= 2:
        prefix = postcode[:3] if len(postcode) >= 3 else postcode[:2]
        matching_boroughs = {
            pc: b
            for pc, b in postcode_map.items()
            if str(pc).replace(" ", "").startswith(prefix)
        }
        if matching_boroughs:
            borough_counts = pd.Series(matching_boroughs.values()).value_counts()
            if not borough_counts.empty:
                return borough_counts.index[0]

    return None  # Borough not found


def engineer_features(
    df_input,
    prediction_year,
    prediction_month,
    borough_stats_map,
    borough_growth_rates,
    base_year_for_growth,
):
    """Feature engineering adjusted for multi-year prediction & growth."""
    df = df_input.copy()  # Work on a copy

    # Convert types carefully, handle potential errors
    df["property_age"] = pd.to_numeric(df["property_age"], errors="coerce").fillna(0)
    df["numberrooms"] = pd.to_numeric(df["numberrooms"], errors="coerce").fillna(1)
    df["tfarea"] = pd.to_numeric(df["tfarea"], errors="coerce")  # Keep NaN if invalid

    # --- Temporal Features for the specific prediction year ---
    df["sale_year"] = prediction_year
    df["sale_month"] = prediction_month
    df["sale_quarter"] = (prediction_month - 1) // 3 + 1

    # --- Construction Age Band ---
    # Use prediction_year to calculate age at time of prediction
    construction_year = prediction_year - df["property_age"]
    conditions = [
        (construction_year < 1900),
        (construction_year >= 1900) & (construction_year <= 1950),
        (construction_year > 1950) & (construction_year <= 2000),
        (construction_year > 2000),
    ]
    choices = ["pre1900", "1900-1950", "1951-2000", "2001+"]
    df["CONSTRUCTION_AGE_BAND"] = np.select(conditions, choices, default="2001+")

    # --- Area Features ---
    df["tfarea_safe"] = df["tfarea"].replace(0, np.nan)
    df["numberrooms_safe"] = df["numberrooms"].replace(0, np.nan)
    df["room_size"] = df["tfarea_safe"] / df["numberrooms_safe"]

    # --- Borough Features (incorporating growth) ---
    default_stats = borough_stats_map.get(
        "_DEFAULT_", {"mean": 800000, "std": 0}
    )  # Default mean price if needed
    default_growth = borough_growth_rates.get("_DEFAULT_", 0.02)

    # Get the specific borough's stats and growth rate
    borough = df["borough"].iloc[0]  # Assuming single row prediction input
    current_borough_stats = borough_stats_map.get(borough, default_stats)
    current_borough_growth = borough_growth_rates.get(borough, default_growth)

    # Calculate the year offset from the base year used for growth calculation
    year_offset = prediction_year - base_year_for_growth

    # Estimate the borough mean price adjusted for growth
    # Start with the pre-calculated mean for the 'base' period, then apply growth
    base_mean_price = current_borough_stats["mean"]
    # Apply CAGR formula: Price_future = Price_base * (1 + growth_rate)^years
    # Use max(0, year_offset) so growth is applied only for future years
    adjusted_borough_mean = base_mean_price * (
        (1 + current_borough_growth) ** max(0, year_offset)
    )

    df["borough_mean_price"] = adjusted_borough_mean

    # --- Add the necessary 'price_to_borough_mean' column ---
    # This was likely used in training relative to the mean *at that time*.
    # For prediction, we don't know the future price, so we can't calculate the *actual* future ratio.
    # Using 1.0 assumes the property will maintain its price relative to the (adjusted) borough mean.
    # This is a simplification required for prediction.
    df["price_to_borough_mean"] = 1.0

    # --- Clean up ---
    df = df.drop(columns=["tfarea_safe", "numberrooms_safe"], errors="ignore")
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    return df


# --- Main Execution ---
if __name__ == "__main__":
    results_list = []  # To store predictions for each year
    error_output = None  # To store potential errors

    try:
        # 1. Load Model and Helper Data
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

        # 2. Read Input Data from Node.js (stdin)
        input_data_str = sys.stdin.read()
        if not input_data_str:
            raise ValueError("No input data received from stdin.")
        input_data = json.loads(input_data_str)

        # Extract prediction years (default to 1 if not provided)
        num_years_to_predict = int(input_data.get("num_years", 1))
        if not (1 <= num_years_to_predict <= 5):
            num_years_to_predict = 1  # Force to 1 if invalid range

        # Remove num_years from property details if it exists
        property_details = {k: v for k, v in input_data.items() if k != "num_years"}

        # 3. Prepare Base DataFrame
        property_details["dateoftransfer"] = datetime.now().strftime(
            "%Y-%m-%d"
        )  # Still needed for structure? Check pipeline steps.
        user_input_df = pd.DataFrame([property_details])

        # 4. Find Borough
        raw_postcode = user_input_df.loc[0, "postcode"]
        borough = find_borough(raw_postcode, postcode_map)
        if borough is None:
            user_input_df["borough"] = "_DEFAULT_"
            # Optionally send a warning back? For now, proceed with default.
            # print(f"Warning: Borough not found for postcode '{raw_postcode}'. Using default.", file=sys.stderr)
        else:
            user_input_df["borough"] = borough

        # 5. Prediction Loop
        current_year = datetime.now().year
        current_month = datetime.now().month
        base_year_for_growth_calc = (
            current_year  # Assume growth rates apply from this year forward
        )

        predicted_price_current_year = (
            None  # Store current year prediction for trend blending
        )

        for year_offset in range(num_years_to_predict):  # Loop 0 to num_years-1
            prediction_year = current_year + year_offset

            # Engineer features for the specific prediction year
            user_input_engineered_df = engineer_features(
                user_input_df.copy(),  # Pass a fresh copy each time
                prediction_year,
                current_month,
                borough_stats,
                borough_growth_rates,
                base_year_for_growth_calc,  # The year from which growth applies
            )

            # Predict using the model for this year's features
            raw_model_prediction = model_pipeline.predict(user_input_engineered_df)[0]

            # --- Blending Logic ---
            final_predicted_price = raw_model_prediction  # Use raw prediction for the current year (offset 0)

            if year_offset == 0:
                predicted_price_current_year = (
                    raw_model_prediction  # Store base for future trends
                )

            if year_offset > 0 and predicted_price_current_year is not None:
                # Calculate the trend projection based on the current year's prediction and growth rate
                borough_name = user_input_df["borough"].iloc[0]
                growth_rate = borough_growth_rates.get(
                    borough_name, borough_growth_rates.get("_DEFAULT_", 0.02)
                )
                trend_projection = predicted_price_current_year * (
                    (1 + growth_rate) ** year_offset
                )

                # Blend: 70% model prediction for *that* year, 30% trend projection from base
                blended_price = 0.7 * raw_model_prediction + 0.3 * trend_projection
                final_predicted_price = blended_price

            # Validate prediction
            if pd.isna(final_predicted_price) or not np.isfinite(final_predicted_price):
                raise ValueError(
                    f"Prediction resulted in NaN or infinite value for year {prediction_year}."
                )

            # Store result
            results_list.append(
                {
                    "year": prediction_year,
                    "predicted_price": float(
                        final_predicted_price
                    ),  # Ensure float for JSON
                }
            )

    except FileNotFoundError as e:
        error_output = {"error": f"Missing file: {str(e)}"}
    except json.JSONDecodeError as e:
        error_output = {
            "error": f"Invalid JSON input: {str(e)}",
            "received_data": input_data_str,
        }
    except ValueError as e:
        error_output = {"error": f"Data error: {str(e)}"}
    except KeyError as e:
        error_output = {"error": f"Missing expected input field: {str(e)}"}
    except Exception as e:
        err_type = type(e).__name__
        error_output = {"error": f"Prediction failed: {err_type} - {str(e)}"}
        # Optional: print traceback to stderr for server logs
        # print(traceback.format_exc(), file=sys.stderr, flush=True)

    # 6. Output Result (JSON)
    if error_output:
        print(json.dumps(error_output), file=sys.stderr, flush=True)
        sys.exit(1)
    else:
        # Send the list of predictions
        output_json = {"predictions": results_list}
        print(json.dumps(output_json), flush=True)
        sys.exit(0)
