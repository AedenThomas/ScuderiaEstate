# preprocess_helper_data.py
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime
import locale # Keep locale if you need it elsewhere

# --- Configuration ---
cleaned_data_file_path = "cleaned_data.csv" # Make sure this points to your actual data
output_dir = "predictor" # Ensure this is where predict_price.py lives
os.makedirs(output_dir, exist_ok=True)

# --- File paths for helper data ---
postcode_map_path = os.path.join(output_dir, "postcode_map.json")
borough_stats_path = os.path.join(output_dir, "borough_stats.json")
borough_growth_path = os.path.join(output_dir, "borough_growth.json") # New file

# --- Data Loading Function (same as before) ---
def load_cleaned_data(file_path):
    try:
        df = pd.read_csv(file_path,
                        dtype={'postcode': 'category',
                               'borough': 'category',
                               'propertytype': 'category',
                               'duration': 'category'},
                        parse_dates=['dateoftransfer'])
        df['dateoftransfer'] = pd.to_datetime(df['dateoftransfer'], errors='coerce')
        df['sale_year'] = df['dateoftransfer'].dt.year # Add sale_year here
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        # Ensure required columns exist
        required_cols = ['postcode', 'borough', 'price', 'tfarea', 'sale_year']
        if not all(col in df.columns for col in required_cols):
             missing = [col for col in required_cols if col not in df.columns]
             raise ValueError(f"Missing required columns in cleaned data: {missing}")
        return df.dropna(subset=required_cols) # Drop rows missing essential data
    except FileNotFoundError:
        print(f"Error: Cleaned data file not found at {file_path}")
        exit(1)
    except Exception as e:
        print(f"Error loading cleaned data: {e}")
        exit(1)

# --- Borough Growth Calculation Function ---
def calculate_borough_growth_rates(df, lookback_years=5, default_growth=0.02, min_growth=-0.05, max_growth=0.10, min_records_per_year=5, min_years_for_trend=2):
    """Calculates borough-level growth rates based on historical median price per sqm."""
    print("Calculating borough growth rates...")
    borough_growth = {}
    df = df.copy() # Avoid modifying original df

    # Calculate price per sqm, handle potential zero/NaN area
    df['tfarea_safe'] = pd.to_numeric(df['tfarea'], errors='coerce').replace(0, np.nan)
    df['price_per_sqm'] = df['price'] / df['tfarea_safe']
    df = df.dropna(subset=['price_per_sqm', 'borough', 'sale_year']) # Ensure valid data

    # Determine the range of years available in the data
    if df['sale_year'].empty:
        print("Warning: No valid sale years found in data. Using default growth for all boroughs.")
        # If you still want to proceed, assign default growth to known boroughs
        known_boroughs = df['borough'].unique()
        for borough in known_boroughs:
             borough_growth[borough] = default_growth
        return borough_growth

    max_year_in_data = int(df['sale_year'].max())
    start_year_for_calc = max_year_in_data - lookback_years + 1

    print(f"Using data from {start_year_for_calc} to {max_year_in_data} for growth calculation.")

    unique_boroughs = df['borough'].unique()
    if hasattr(unique_boroughs, 'categories'): # Handle Categorical dtype
        unique_boroughs = unique_boroughs.categories.tolist()
    else:
         unique_boroughs = unique_boroughs.tolist()

    for borough in unique_boroughs:
        borough_data = df[(df['borough'] == borough) & (df['sale_year'] >= start_year_for_calc)].copy()

        # Calculate median price per sqm per year for the borough
        # Ensure enough data points per year
        yearly_stats = borough_data.groupby('sale_year').agg(
            median_price_per_sqm=('price_per_sqm', 'median'),
            count=('price_per_sqm', 'size')
        ).reset_index()

        valid_years_data = yearly_stats[yearly_stats['count'] >= min_records_per_year].sort_values('sale_year')

        if len(valid_years_data) >= min_years_for_trend:
            first_year_data = valid_years_data.iloc[0]
            last_year_data = valid_years_data.iloc[-1]

            start_price = first_year_data['median_price_per_sqm']
            end_price = last_year_data['median_price_per_sqm']
            n_years = last_year_data['sale_year'] - first_year_data['sale_year']

            if n_years > 0 and start_price > 0 and end_price > 0:
                # Calculate CAGR
                cagr = (end_price / start_price) ** (1 / n_years) - 1
                # Cap the growth rate
                growth_rate = max(min(cagr, max_growth), min_growth)
                borough_growth[borough] = growth_rate
                # print(f"  {borough}: Calculated CAGR={cagr:.4f}, Capped Growth={growth_rate:.4f} over {n_years} years") # Debug
            else:
                # print(f"  {borough}: Not enough time span or invalid prices. Using default.") # Debug
                borough_growth[borough] = default_growth # Default if calc fails
        else:
            # print(f"  {borough}: Not enough valid years ({len(valid_years_data)}<{min_years_for_trend}) with >= {min_records_per_year} records. Using default.") # Debug
            borough_growth[borough] = default_growth # Default if not enough data
    print(f"Finished calculating growth rates for {len(borough_growth)} boroughs.")
    return borough_growth


# --- Main Execution ---
print(f"Loading cleaned data from: {cleaned_data_file_path}")
cleaned_df = load_cleaned_data(cleaned_data_file_path)
print(f"Cleaned data loaded. Shape: {cleaned_df.shape}")

# --- Create and Save Postcode -> Borough Map ---
print("Creating postcode to borough map...")
cleaned_df['postcode'] = cleaned_df['postcode'].astype(str)
postcode_borough_map = cleaned_df.drop_duplicates('postcode').set_index('postcode')['borough'].to_dict()
try:
    with open(postcode_map_path, 'w') as f:
        json.dump(postcode_borough_map, f)
    print(f"Postcode map saved to: {postcode_map_path}")
except Exception as e:
    print(f"Error saving postcode map: {e}")
    # Continue if possible, but warn

# --- Calculate and Save Borough Stats (Mean/Std Price) ---
print("Calculating borough mean/std statistics...")
try:
    # Use observed=True for category groupby if pandas >= 1.1.0
    borough_stats_df = cleaned_df.groupby('borough')['price'].agg(['mean', 'std']).reset_index()
    # Convert NaN std to 0
    borough_stats_df['std'] = borough_stats_df['std'].fillna(0)
    borough_stats_dict = borough_stats_df.set_index('borough').to_dict('index')

    # Add a default entry using overall stats
    default_mean_price = cleaned_df['price'].mean()
    default_std_dev = cleaned_df['price'].std()
    borough_stats_dict['_DEFAULT_'] = {'mean': default_mean_price, 'std': default_std_dev if pd.notna(default_std_dev) else 0}

    with open(borough_stats_path, 'w') as f:
        json.dump(borough_stats_dict, f, indent=4) # Added indent for readability
    print(f"Borough stats saved to: {borough_stats_path}")

except KeyError:
    print("Error: 'price' column not found. Cannot calculate borough mean/std stats.")
    # Continue if possible, but warn
except Exception as e:
    print(f"Error calculating or saving borough stats: {e}")
    # Continue if possible, but warn


# --- Calculate and Save Borough Growth Rates ---
borough_growth_rates = calculate_borough_growth_rates(cleaned_df)
# Add a default growth rate for the _DEFAULT_ key
borough_growth_rates['_DEFAULT_'] = 0.02 # Use the default specified in the function

try:
    with open(borough_growth_path, 'w') as f:
        json.dump(borough_growth_rates, f, indent=4) # Added indent
    print(f"Borough growth rates saved to: {borough_growth_path}")
except Exception as e:
    print(f"Error saving borough growth rates: {e}")
    exit(1) # Exit if saving fails

print("\nHelper data preprocessing complete.")