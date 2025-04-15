# -*- coding: utf-8 -*-
import pandas as pd
import numpy as np
import xgboost as xgb
import glob
import os
import warnings
from datetime import datetime
from dateutil.relativedelta import relativedelta
import joblib 
import re 
import traceback 
import time 

warnings.filterwarnings('ignore')


PRICE_PAID_DIR = './'
CERTIFICATES_FILE = 'certificates.csv'
PP_FILE_PATTERN = 'pp-*.csv'
MODEL_FILENAME = 'xgb_price_model_v3.joblib' 
FEATURES_FILENAME = 'model_features_v3.joblib'
MIN_HISTORY_POINTS = 12 # Minimum data points needed at Postcode/Sector/District level for prediction basis
DEBUG_MODE = True 


GLOBAL_MIN_DATE = None

def print_debug(message, indent=0):
    """Prints a debug message if DEBUG_MODE is True, with optional indentation."""
    if DEBUG_MODE:
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        indent_str = "  " * indent
        print(f"DEBUG [{timestamp}]: {indent_str}{message}")


def get_outward_code(postcode):
    """Extracts the outward code (e.g., 'SW1A') from a postcode string."""
    if pd.isna(postcode): return None
    postcode = str(postcode).strip().upper()
    parts = postcode.split(' ')
    return parts[0] if len(parts) > 0 and parts[0] else None

def get_postcode_district(postcode):
    """Extracts the postcode district (identical to outward code)."""
    return get_outward_code(postcode)

def get_postcode_sector(postcode):
    """Extracts the postcode sector (e.g., 'SW1A 0') from a postcode string."""
    if pd.isna(postcode): return None
    postcode = str(postcode).strip().upper()
    match = re.match(r'^([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9])[A-Z]{2}$', postcode, re.IGNORECASE)
    if match:
        return f"{match.group(1)} {match.group(2)}" # Outward + space + sector digit
    else:
        parts = postcode.split(' ')
        if len(parts) == 2 and parts[0] and len(parts[1]) > 0:
             return f"{parts[0]} {parts[1][0]}" # Fallback: outward + first digit of inward
        elif len(parts) == 1 and len(parts[0]) > 1 and re.match(r'^[A-Z]{1,2}[0-9][A-Z0-9]?$', parts[0]):
             return parts[0] 
        return None 

def load_price_data(directory, pattern):
    func_start = time.time()
    print_debug(f"Starting load_price_data from '{directory}' with pattern '{pattern}'")
    all_files = glob.glob(os.path.join(directory, pattern))
    if not all_files:
        raise FileNotFoundError(f"No files found matching pattern '{pattern}' in directory '{directory}'. Please ensure the pp-*.csv files are present.")
    print(f"Found {len(all_files)} price files: {sorted(all_files)}")
    df_list = []
    col_names = ['TUID', 'Price', 'Date', 'Postcode', 'PropType', 'OldNew', 'Duration',
                 'Addr1', 'Addr2', 'Street', 'Locality', 'Town', 'District', 'County',
                 'PPD_Cat', 'RecordStatus']
    required_cols = ['Price', 'Date', 'Postcode', 'PropType']
    total_rows_loaded = 0
    prop_type_map = {'D': 'Detached', 'S': 'Semi-Detached', 'T': 'Terraced', 'F': 'Flat', 'O': 'Other'} # Define here for use below
    for f in sorted(all_files):
        file_start = time.time()
        print_debug(f"Loading file: {f}", indent=1)
        try:
            df = pd.read_csv(
                f, header=None, names=col_names, usecols=required_cols,
                parse_dates=['Date'], dtype={'Postcode': str, 'PropType': str, 'Price': str},
                low_memory=False, on_bad_lines='warn'
            )
            initial_len = len(df)
            df['Price'] = pd.to_numeric(df['Price'], errors='coerce')
            df.dropna(subset=['Price'], inplace=True)
            rows_dropped_price = initial_len - len(df)
            if rows_dropped_price > 0:
                print_debug(f"Dropped {rows_dropped_price} rows from {f} due to invalid Price.", indent=2)

            if df.empty or df[required_cols].isnull().all().all():
                print(f"Warning: File {f} effectively empty after price conversion/check. Skipping.")
                continue

            rows_loaded = len(df)
            total_rows_loaded += rows_loaded
            # print_debug(f"Loaded {f}, shape after initial price conversion: {df.shape} (took {time.time()-file_start:.2f}s)", indent=1)
            df_list.append(df)
        except pd.errors.EmptyDataError: print(f"Warning: File {f} is empty. Skipping.")
        except ValueError as ve: print(f"Warning: Potential parsing issue in {f}. Check file content. Error: {ve}. Skipping file.")
        except Exception as e: print(f"Error loading or parsing {f}: {e}. Skipping file."); traceback.print_exc()

    if not df_list: raise ValueError("No valid price data could be loaded. Check file contents and paths.")
    full_pp_df = pd.concat(df_list, ignore_index=True)
    print(f"Combined price data shape before cleaning: {full_pp_df.shape} ({total_rows_loaded} rows)")
    print_debug(f"Finished load_price_data. Combined shape: {full_pp_df.shape} (took {time.time()-func_start:.2f}s)")
    return full_pp_df, prop_type_map # Return the map as well

def preprocess_price_data(df, prop_type_map): 
    global GLOBAL_MIN_DATE
    func_start = time.time()
    print_debug("Starting preprocess_price_data")
    if df.empty:
        print("Warning: Input DataFrame for preprocessing is empty.")
        return pd.DataFrame()

    initial_shape = df.shape
    # print_debug(f"Input shape: {initial_shape}") 
    df = df[['Price', 'Date', 'Postcode', 'PropType']].copy()
    df.dropna(subset=['Postcode', 'Price', 'Date', 'PropType'], inplace=True) 
    # print_debug(f"Shape after initial required columns dropna: {df.shape}")

    initial_len = len(df)
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
    df.dropna(subset=['Date'], inplace=True) 
    # print_debug(f"Dropped {initial_len - len(df)} rows due to failed Date conversion.", indent=1)
    if not df.empty:
        current_min_date = df['Date'].min()
        if GLOBAL_MIN_DATE is None or current_min_date < GLOBAL_MIN_DATE:
            GLOBAL_MIN_DATE = current_min_date
            print_debug(f"Global minimum date updated to: {GLOBAL_MIN_DATE.strftime('%Y-%m-%d')}", indent=1)
    else:
        print("Warning: DataFrame empty after Date conversion.")
        return pd.DataFrame()
    # print_debug(f"Shape after Date conversion & dropna: {df.shape}")

    df['Postcode'] = df['Postcode'].astype(str).str.strip().str.upper()
    df['Postcode_Clean'] = df['Postcode'].str.replace(' ', '') 
    df['PostcodeDistrict'] = df['Postcode'].apply(get_postcode_district)
    df['PostcodeSector'] = df['Postcode'].apply(get_postcode_sector)
    initial_len = len(df)
    df.dropna(subset=['PostcodeDistrict', 'PostcodeSector'], inplace=True) # Drop rows where essential postcode parsing failed
    # print_debug(f"Dropped {initial_len - len(df)} rows due to failed District/Sector parsing.", indent=1)
    # print_debug(f"Shape after postcode parsing & dropna: {df.shape}")

    initial_len = len(df)
    df = df[df['Price'] > 1000] 
    # print_debug(f"Dropped {initial_len - len(df)} rows with Price <= 1000.", indent=1)
    # print_debug(f"Shape after price filter (>1000): {df.shape}")

    df['YearMonth'] = df['Date'].dt.to_period('M')
    df['PropTypeMapped'] = df['PropType'].astype(str).map(prop_type_map).fillna('Other')

    if df.empty:
        print("Warning: DataFrame became empty after initial cleaning steps.")
        return pd.DataFrame()

    print_debug("Aggregating price data by Postcode, Sector, District...")
    grouping_cols = ['Postcode_Clean', 'PostcodeSector', 'PostcodeDistrict', 'YearMonth']
    initial_len = len(df)
    df.dropna(subset=grouping_cols, inplace=True)
    # if initial_len > len(df): print_debug(f"Dropped {initial_len - len(df)} rows with NaN in grouping columns.", indent=1)


    agg_base = df.groupby(grouping_cols, observed=False).agg(
        MedianPrice_Postcode=('Price', 'median'), TransactionCount_Postcode=('Price', 'size')
    ).reset_index()


    monthly_prices_sec = df.groupby(['PostcodeSector', 'YearMonth'], observed=False).agg(
        MedianPrice_Sector=('Price', 'median'), TransactionCount_Sector=('Price', 'size')
    ).reset_index()
    monthly_prices_dist = df.groupby(['PostcodeDistrict', 'YearMonth'], observed=False).agg(
        MedianPrice_District=('Price', 'median'), TransactionCount_District=('Price', 'size')
    ).reset_index()
    # print_debug(f"Aggregation shapes: PC_Base({agg_base.shape}), Sector({monthly_prices_sec.shape}), District({monthly_prices_dist.shape})")


    print_debug("Aggregating property type mix...")
    prop_type_dummies = pd.get_dummies(df['PropTypeMapped'], prefix='PropType')
    df_with_dummies = pd.concat([df[grouping_cols], prop_type_dummies], axis=1)
    initial_len = len(df_with_dummies)
    df_with_dummies.dropna(subset=grouping_cols, inplace=True)
    # if initial_len > len(df_with_dummies): print_debug(f"Dropped {initial_len - len(df_with_dummies)} rows from dummies df due to NaN keys.", indent=1)

    ptype_agg_pc = df_with_dummies.groupby(['Postcode_Clean', 'YearMonth'], observed=False).sum(numeric_only=True).reset_index()
    ptype_agg_sec = df_with_dummies.groupby(['PostcodeSector', 'YearMonth'], observed=False).sum(numeric_only=True).reset_index()
    ptype_agg_dist = df_with_dummies.groupby(['PostcodeDistrict', 'YearMonth'], observed=False).sum(numeric_only=True).reset_index()

    ptype_agg_pc.columns = ['Postcode_Clean', 'YearMonth'] + [f'{col}_PC_Sum' for col in ptype_agg_pc.columns if col not in ['Postcode_Clean', 'YearMonth']]
    ptype_agg_sec.columns = ['PostcodeSector', 'YearMonth'] + [f'{col}_SEC_Sum' for col in ptype_agg_sec.columns if col not in ['PostcodeSector', 'YearMonth']]
    ptype_agg_dist.columns = ['PostcodeDistrict', 'YearMonth'] + [f'{col}_DIST_Sum' for col in ptype_agg_dist.columns if col not in ['PostcodeDistrict', 'YearMonth']]
    # print_debug(f"PropType Agg shapes after rename: PC({ptype_agg_pc.shape}), Sec({ptype_agg_sec.shape}), Dist({ptype_agg_dist.shape})")

    agg_df = agg_base
    agg_df = pd.merge(agg_df, monthly_prices_sec, on=['PostcodeSector', 'YearMonth'], how='left')
    agg_df = pd.merge(agg_df, monthly_prices_dist, on=['PostcodeDistrict', 'YearMonth'], how='left')
    # print_debug(f"Shape after merging Price Aggs: {agg_df.shape}")

    agg_df = pd.merge(agg_df, ptype_agg_pc, on=['Postcode_Clean', 'YearMonth'], how='left')
    # print_debug(f"Shape after merging PC PropType Sums: {agg_df.shape}")
    agg_df = pd.merge(agg_df, ptype_agg_sec, on=['PostcodeSector', 'YearMonth'], how='left')
    # print_debug(f"Shape after merging SEC PropType Sums: {agg_df.shape}")
    agg_df = pd.merge(agg_df, ptype_agg_dist, on=['PostcodeDistrict', 'YearMonth'], how='left')
    # print_debug(f"Shape after merging DIST PropType Sums: {agg_df.shape}")

    agg_df.rename(columns={'Postcode_Clean': 'Postcode'}, inplace=True)

    prop_type_sum_cols = agg_df.filter(regex=r'_PC_Sum$|_SEC_Sum$|_DIST_Sum$').columns
    if not prop_type_sum_cols.empty:
        agg_df[prop_type_sum_cols] = agg_df[prop_type_sum_cols].fillna(0).astype(int) # Ensure integer counts
        # print_debug(f"Filled NaNs in {len(prop_type_sum_cols)} PropType sum columns with 0.")
    else:
        print_debug("No property type sum columns found after merges to fill NaNs.")


    try:
        agg_df['YearMonth'] = agg_df['YearMonth'].dt.to_timestamp()
    except AttributeError:
        # print_debug("YearMonth not Period, attempting pd.to_datetime.")
        agg_df['YearMonth'] = pd.to_datetime(agg_df['YearMonth'], errors='coerce')
        agg_df.dropna(subset=['YearMonth'], inplace=True)

    # print(f"Shape before final cleaning steps: {agg_df.shape}")
    agg_df.drop_duplicates(subset=['Postcode', 'YearMonth'], keep='first', inplace=True)
    nan_check = agg_df[['MedianPrice_Postcode', 'TransactionCount_Postcode', 'PostcodeSector', 'PostcodeDistrict']].isnull().sum()
    if nan_check.sum() > 0:
        print_debug(f"Warning: NaNs found in key columns before returning:\n{nan_check[nan_check > 0]}")

    # print(f"Shape after final cleaning: {agg_df.shape}")
    if agg_df.empty: print("Warning: Aggregated DataFrame is empty after all processing steps.")
    print(f"Aggregated monthly data processing complete. Final shape: {agg_df.shape}")
    print_debug(f"Finished preprocess_price_data. Final shape: {agg_df.shape} (took {time.time()-func_start:.2f}s)")
    return agg_df


def load_and_process_certificates(filepath):
    func_start = time.time()
    print_debug(f"Starting load_and_process_certificates: {filepath}")
    try:
        possible_cert_cols = ['POSTCODE', 'TOTAL_FLOOR_AREA', 'NUMBER_HABITABLE_ROOMS',
                     'PROPERTY_TYPE', 'CURRENT_ENERGY_RATING', 'BUILT_FORM',
                     'CONSTRUCTION_AGE_BAND', 'TENURE']
        headers = pd.read_csv(filepath, nrows=0).columns.tolist()
        cert_cols = [col for col in possible_cert_cols if col in headers]
        if not cert_cols or 'POSTCODE' not in cert_cols:
             print(f"Warning: Essential 'POSTCODE' column or no target columns found in '{filepath}'. No cert features."); return None
        # print_debug(f"Found certificate columns: {cert_cols}")

        certs_df = pd.read_csv(
            filepath, usecols=cert_cols, dtype={col: str for col in cert_cols}, low_memory=False,
            on_bad_lines='warn'
        )

    except FileNotFoundError: print(f"Warning: Certificates file not found at '{filepath}'. No cert features."); return None
    except pd.errors.EmptyDataError: print(f"Warning: Certificates file '{filepath}' is empty. No cert features."); return None
    except Exception as e: print(f"Warning: Error loading certificates file '{filepath}': {e}. No cert features."); traceback.print_exc(); return None

    # print(f"Loaded certificates data shape: {certs_df.shape}")
    if certs_df.empty: print("Warning: Certificates DataFrame empty."); return None

    certs_df.dropna(subset=['POSTCODE'], inplace=True)
    certs_df['Postcode'] = certs_df['POSTCODE'].str.strip().str.upper().str.replace(' ', '')
    certs_df.dropna(subset=['POSTCODE'], inplace=True); certs_df = certs_df[certs_df['POSTCODE'] != '']
    if certs_df.empty: print("Warning: Certificates DataFrame empty after cleaning postcodes."); return None
    # print_debug(f"Certs shape after postcode cleaning: {certs_df.shape}")

    numeric_cols = ['TOTAL_FLOOR_AREA', 'NUMBER_HABITABLE_ROOMS']
    for col in numeric_cols:
        if col in certs_df.columns:
            certs_df[col] = pd.to_numeric(certs_df[col], errors='coerce')
            if not certs_df[col].isnull().all():
                median_val = certs_df[col].median()
                certs_df[col].fillna(median_val, inplace=True)
                # print_debug(f"Imputed NaNs in cert '{col}' with median: {median_val:.2f}")
            else:
                certs_df[col].fillna(0, inplace=True); print(f"Warning: All values in cert '{col}' null/non-numeric. Filled NaNs with 0.")
        # else: print_debug(f"Numeric cert column '{col}' not found.")

    cat_cols = ['PROPERTY_TYPE', 'CURRENT_ENERGY_RATING', 'BUILT_FORM', 'CONSTRUCTION_AGE_BAND', 'TENURE']
    unknown_synonyms = ['Unknown', 'UNKNOWN', 'NO DATA!', 'INVALID!', '', None, np.nan, 'N/A', 'NODATA']
    for col in cat_cols:
         if col in certs_df.columns:
            certs_df[col] = certs_df[col].astype(str).fillna('Unknown').str.strip().str.upper()
            certs_df[col].replace({s: 'Unknown' for s in unknown_synonyms if isinstance(s, str)}, inplace=True)
            certs_df[col] = certs_df[col].replace(['NAN', 'NONE', ''], 'Unknown')
            certs_df.loc[certs_df[col].isnull() | (certs_df[col] == ''), col] = 'Unknown'
         # else: print_debug(f"Categorical cert column '{col}' not found.")

    # print_debug("Aggregating certificate features by Postcode...")
    agg_funcs = {}
    if 'TOTAL_FLOOR_AREA' in certs_df.columns: agg_funcs['TOTAL_FLOOR_AREA'] = 'median'
    if 'NUMBER_HABITABLE_ROOMS' in certs_df.columns: agg_funcs['NUMBER_HABITABLE_ROOMS'] = 'median'
    for col in cat_cols:
        if col in certs_df.columns:
             agg_funcs[col] = lambda x: x.mode()[0] if not x.mode().empty and pd.notna(x.mode()[0]) else 'Unknown'

    if not agg_funcs:
         print("Warning: No certificate columns found to aggregate."); return None

    certs_agg = certs_df.groupby('Postcode', observed=False).agg(agg_funcs).reset_index()
    certs_agg.columns = ['Postcode'] + [f'Cert_{col}_Agg' for col in agg_funcs.keys()]

    print(f"Aggregated certificate features shape: {certs_agg.shape}")
    if certs_agg.empty: print("Warning: Aggregated certificates DataFrame is empty."); return None
    print_debug(f"Finished load_and_process_certificates. Agg shape: {certs_agg.shape} (took {time.time()-func_start:.2f}s)")
    return certs_agg



def combine_data(agg_price_df, certs_agg_df):
    func_start = time.time()
    print_debug("Starting combine_data")
    if agg_price_df is None or agg_price_df.empty:
         print("Warning: Aggregated price data empty/None. Cannot combine."); return pd.DataFrame()

    combined_df = agg_price_df.copy()
    possible_cert_inputs = ['TOTAL_FLOOR_AREA', 'NUMBER_HABITABLE_ROOMS', 'PROPERTY_TYPE',
                            'CURRENT_ENERGY_RATING', 'BUILT_FORM', 'CONSTRUCTION_AGE_BAND', 'TENURE']
    expected_cert_cols_agg = [f'Cert_{col}_Agg' for col in possible_cert_inputs]

    if certs_agg_df is not None and not certs_agg_df.empty:
        # print_debug(f"Merging price data ({combined_df.shape}) with certs ({certs_agg_df.shape}) on 'Postcode'")
        combined_df['Postcode'] = combined_df['Postcode'].astype(str)
        certs_agg_df['Postcode'] = certs_agg_df['Postcode'].astype(str)

        initial_cols = set(combined_df.columns)
        combined_df = pd.merge(combined_df, certs_agg_df, on='Postcode', how='left')
        new_cols = set(combined_df.columns) - initial_cols
        # print_debug(f"Merge completed. Added columns from certs: {list(new_cols)}")
        print("Certificate features added where available.")

        added_placeholder_cols = []
        for col in expected_cert_cols_agg:
            if col not in combined_df.columns:
                 is_cat = any(k in col for k in ['TYPE', 'RATING', 'FORM', 'AGE', 'TENURE'])
                 combined_df[col] = 'Unknown' if is_cat else np.nan
                 added_placeholder_cols.append(col)
        if added_placeholder_cols: print_debug(f"Added placeholder columns for cert features not in file: {added_placeholder_cols}")

    else:
        print("No certificate data available to merge.")
        added_placeholder_cols = []
        for col in expected_cert_cols_agg:
             if col not in combined_df.columns:
                  is_cat = any(k in col for k in ['TYPE', 'RATING', 'FORM', 'AGE', 'TENURE'])
                  combined_df[col] = 'Unknown' if is_cat else np.nan
                  added_placeholder_cols.append(col)
        if added_placeholder_cols: print_debug(f"Added placeholder columns for missing cert features: {added_placeholder_cols}")

    print(f"Combined data shape: {combined_df.shape}")
    print_debug(f"Finished combine_data. Shape: {combined_df.shape} (took {time.time()-func_start:.2f}s)")
    return combined_df



def engineer_features(df, prop_type_map): # Accept prop_type_map
    func_start = time.time()
    print_debug("Starting engineer_features")
    if df is None or df.empty: print("Warning: Input DataFrame for FE empty."); return pd.DataFrame()
    # print_debug(f"Input shape: {df.shape}")

    if 'YearMonth' in df.columns:
        if not pd.api.types.is_datetime64_any_dtype(df['YearMonth']):
            # print_debug("Converting YearMonth to datetime.")
            df['YearMonth'] = pd.to_datetime(df['YearMonth'], errors='coerce')
            df.dropna(subset=['YearMonth'], inplace=True)
        df = df.sort_values(by=['PostcodeDistrict', 'PostcodeSector', 'Postcode', 'YearMonth']).copy()
        df = df.set_index('YearMonth', drop=False)
        # print_debug("Data sorted and YearMonth index set.")
    else:
        print("CRITICAL ERROR: 'YearMonth' column missing. Cannot proceed with Feature Engineering.")
        return pd.DataFrame()

    if GLOBAL_MIN_DATE is None:
        print("CRITICAL ERROR: GLOBAL_MIN_DATE not set. Cannot calculate 'MonthsSinceStart'.")
        return pd.DataFrame()

    target_original_price = 'MedianPrice_Postcode'; target_log_price = 'LogMedianPrice_Postcode'
    if target_original_price in df.columns: df[target_log_price] = np.log1p(df[target_original_price])
    else: print(f"Warning: Target '{target_original_price}' not found."); df[target_log_price] = np.nan

    df['Year'] = df.index.year
    df['Month'] = df.index.month
    df['MonthsSinceStart'] = ((df.index.year - GLOBAL_MIN_DATE.year) * 12 +
                              df.index.month - GLOBAL_MIN_DATE.month)
    # print_debug("Base features (LogPrice, Year, Month, MonthsSinceStart) created.")


    # print_debug("Creating price level anchor features (Lag 1m)...")
    for col, group_col in [('MedianPrice_Sector', 'PostcodeSector'), ('MedianPrice_District', 'PostcodeDistrict')]:
        lag_col_name = f'{col}_Anchor_Lag1m'
        if col in df.columns and group_col in df.columns:
            df[lag_col_name] = df.groupby(group_col, observed=False)[col].shift(1)
        else:
            # print(f"Warning: Missing '{col}' or '{group_col}'. Cannot create '{lag_col_name}'.")
            df[lag_col_name] = np.nan
    # print_debug("Anchor features created.")

    # --- Relative Price Ratios ---
    # print_debug("Calculating relative price ratios (Current Month)...")
    for ratio_name, num_col, den_col in [('PriceRatio_PC_SEC', 'MedianPrice_Postcode', 'MedianPrice_Sector'),
                                         ('PriceRatio_SEC_DIST', 'MedianPrice_Sector', 'MedianPrice_District')]:
        if num_col in df.columns and den_col in df.columns:
            df[ratio_name] = (df[num_col] / df[den_col].replace(0, np.nan))
            df[ratio_name].fillna(1.0, inplace=True)
            df[ratio_name].replace([np.inf, -np.inf], 1.0, inplace=True)
        else:
            # print(f"Warning: Missing '{num_col}' or '{den_col}'. Ratio '{ratio_name}' set to 1.0.")
            df[ratio_name] = 1.0
    # print_debug("Relative price ratios calculated.")


    print_debug("Creating lag features...")
    levels = {'PC': 'Postcode', 'SEC': 'PostcodeSector', 'DIST': 'PostcodeDistrict'}
    lags = [1, 3, 6, 12, 18]
    features_to_lag_config = {
        'LogPrice':    {'col': target_log_price,              'level': 'PC'},
        'RatioPcS':    {'col': 'PriceRatio_PC_SEC',           'level': 'PC'},
        'RatioSecD':   {'col': 'PriceRatio_SEC_DIST',         'level': 'SEC'},
        'CountPc':     {'col': 'TransactionCount_Postcode',   'level': 'PC'},
        'CountSec':    {'col': 'TransactionCount_Sector',     'level': 'SEC'},
        'CountDist':   {'col': 'TransactionCount_District',   'level': 'DIST'}
    }
    lag_cols_created = 0 
    for name, config in features_to_lag_config.items():
        base_col, level_key = config['col'], config['level']
        if level_key not in levels: continue
        group_col = levels[level_key]
        level_suffix = level_key

        if base_col in df.columns and group_col in df.columns:
             for lag in lags:
                feature_name = f'{name}_{level_suffix}_Lag_{lag}m'
                df[feature_name] = df.groupby(group_col, observed=False)[base_col].shift(lag)
                lag_cols_created += 1
        else:
            # print(f"Warning: Missing '{base_col}' or '{group_col}' for lag '{name}'. Skip.")
            for lag in lags: df[f'{name}_{level_suffix}_Lag_{lag}m'] = np.nan
    print_debug(f"Created {lag_cols_created} raw lag feature columns.")


    # print_debug("Filling missing lag features using hierarchy...")
    anchor_sec_lag1, anchor_dist_lag1 = 'MedianPrice_Sector_Anchor_Lag1m', 'MedianPrice_District_Anchor_Lag1m'
    if anchor_sec_lag1 in df.columns and anchor_dist_lag1 in df.columns:
        df[anchor_sec_lag1].fillna(df[anchor_dist_lag1], inplace=True)

    for lag in lags:
        pc_c = f'CountPc_PC_Lag_{lag}m'
        sec_c = f'CountSec_SEC_Lag_{lag}m'
        dist_c = f'CountDist_DIST_Lag_{lag}m'
        if pc_c in df.columns and sec_c in df.columns: df[pc_c].fillna(df[sec_c], inplace=True)
        if sec_c in df.columns and dist_c in df.columns: df[sec_c].fillna(df[dist_c], inplace=True)
        if pc_c in df.columns and dist_c in df.columns: df[pc_c].fillna(df[dist_c], inplace=True)
        for col in [pc_c, sec_c, dist_c]:
            if col in df.columns: df[col].fillna(0, inplace=True)

        pc_sec_r = f'RatioPcS_PC_Lag_{lag}m'
        sec_dist_r = f'RatioSecD_SEC_Lag_{lag}m'
        if pc_sec_r in df.columns: df[pc_sec_r].fillna(1.0, inplace=True)
        if sec_dist_r in df.columns: df[sec_dist_r].fillna(1.0, inplace=True)

        log_pc = f'LogPrice_PC_Lag_{lag}m'
        if log_pc in df.columns: df[log_pc].fillna(0.0, inplace=True)
    # print_debug("Missing lags filled.")


    print_debug("Creating rolling window features...")
    windows = [3, 6, 12]
    level_config_rolling = {
        'PC': {'count_col': 'TransactionCount_Postcode', 'group_col': 'Postcode', 'ptype_sum_suffix': '_PC_Sum'},
        'SEC': {'count_col': 'TransactionCount_Sector', 'group_col': 'PostcodeSector', 'ptype_sum_suffix': '_SEC_Sum'},
        'DIST': {'count_col': 'TransactionCount_District', 'group_col': 'PostcodeDistrict', 'ptype_sum_suffix': '_DIST_Sum'}
    }
    rolling_cols_created = 0 

    for level_suffix, config in level_config_rolling.items():
        count_col, group_col = config['count_col'], config['group_col']
        ptype_sum_suffix = config['ptype_sum_suffix']

        if count_col in df.columns and group_col in df.columns:
            for window in windows:
                feature_name = f'TxCount_{level_suffix}_Roll_{window}m'
                rolling_sum = df.groupby(group_col, observed=False)[count_col].shift(1).rolling(window=window, min_periods=1).sum()
                df[feature_name] = rolling_sum.fillna(0)
                rolling_cols_created += 1


            level_prop_type_sum_cols = [col for col in df.columns if col.startswith('PropType_') and col.endswith(ptype_sum_suffix)]
            if level_prop_type_sum_cols:
                 # print_debug(f"Creating rolling property type mix features for {level_suffix} level...")
                 for window in windows:
                    total_col_name_temp = f'TotalTx_{level_suffix}_Roll_{window}m_Temp'
                    rolling_total = df.groupby(group_col, observed=False)[count_col].shift(1).rolling(window=window, min_periods=1).sum()
                    df[total_col_name_temp] = rolling_total.fillna(0)

                    for pt_sum_col in level_prop_type_sum_cols:
                        base_pt_col_match = re.match(r'^(PropType_\w+)_', pt_sum_col)
                        if not base_pt_col_match: continue
                        base_pt_col = base_pt_col_match.group(1)
                        perc_col_name = f'{base_pt_col}_{level_suffix}_Perc_{window}m'

                        if pt_sum_col in df.columns:
                            roll_sum_col_temp = f'{pt_sum_col}_RollSum_{window}m_Temp'
                            rolling_pt_sum = df.groupby(group_col, observed=False)[pt_sum_col].shift(1).rolling(window=window, min_periods=1).sum()
                            df[roll_sum_col_temp] = rolling_pt_sum.fillna(0)

                            df[perc_col_name] = (df[roll_sum_col_temp] / df[total_col_name_temp].replace(0, np.nan)).fillna(0.0)
                            df[perc_col_name].replace([np.inf, -np.inf], 0.0, inplace=True)
                            rolling_cols_created += 1
                            df.drop(columns=[roll_sum_col_temp], inplace=True, errors='ignore')
                        else:
                            df[perc_col_name] = 0.0

                    df.drop(columns=[total_col_name_temp], inplace=True, errors='ignore')
            else:
                # print(f"Warning: No property type sum columns found for level {level_suffix} (suffix: {ptype_sum_suffix}). Skipping rolling mix.")
                prop_type_base_names = [f'PropType_{pt}' for pt in prop_type_map.values()]
                for window in windows:
                    for pt_base in prop_type_base_names: df[f'{pt_base}_{level_suffix}_Perc_{window}m'] = 0.0

        else:
            # print(f"Warning: Count/Group missing for level '{level_suffix}'. Skipping rolling features.")
            for window in windows: df[f'TxCount_{level_suffix}_Roll_{window}m'] = 0.0
            prop_type_base_names = [f'PropType_{pt}' for pt in prop_type_map.values()]
            for window in windows:
                for pt_base in prop_type_base_names: df[f'{pt_base}_{level_suffix}_Perc_{window}m'] = 0.0
    print_debug(f"Created {rolling_cols_created} rolling feature columns.")



    # print_debug("Handling certificate features...")
    cert_cols = [col for col in df.columns if col.startswith('Cert_')]
    cert_cat_cols = [col for col in cert_cols if any(k in col for k in ['TYPE', 'RATING', 'FORM', 'AGE', 'TENURE'])]
    cert_num_cols = [col for col in cert_cols if any(k in col for k in ['AREA', 'ROOMS'])]

    for col in cert_cat_cols:
        if col in df.columns:
            df[col] = df[col].fillna('Unknown')
            df[col] = df[col].replace(['nan', 'NONE', 'N/A', '', 'NULL', 'NO DATA!', 'INVALID!'], 'Unknown', regex=False)

            if not pd.api.types.is_string_dtype(df[col]) and not pd.api.types.is_categorical_dtype(df[col]):
                 df[col] = df[col].astype(str)

            try:
                 if not pd.api.types.is_categorical_dtype(df[col]):
                     df[col] = pd.Categorical(df[col])

                 if 'Unknown' not in df[col].cat.categories:
                     # print_debug(f"Adding 'Unknown' category to {col}", indent=1)
                     df[col] = df[col].cat.add_categories('Unknown')

                 df[col] = df[col].fillna('Unknown') # Final fill after ensuring category exists

            except Exception as e:
                 print(f"Warning: Cannot convert cert col '{col}' to category: {e}. Leaving as object.")
                 if not pd.api.types.is_object_dtype(df[col]): df[col] = df[col].astype(object)

        # else: print_debug(f"Expected cert cat col '{col}' not found in df.")

    for col in cert_num_cols:
        if col in df.columns:
            if not pd.api.types.is_numeric_dtype(df[col]):
                 df[col] = pd.to_numeric(df[col], errors='coerce')
            if not df[col].isnull().all():
                median_val = df[col].median()
                df[col].fillna(median_val, inplace=True)
            else: df[col].fillna(0, inplace=True)
        # else: print_debug(f"Expected cert num col '{col}' not found in df.")
    # print_debug("Certificate features handled.")


    # print_debug("Performing final cleanup...")
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    initial_rows = len(df)

    if target_log_price in df.columns: df.dropna(subset=[target_log_price], inplace=True)

    essential_features = [f'CountDist_DIST_Lag_{max(lags)}m', 'MedianPrice_District_Anchor_Lag1m']
    essential_present = [col for col in essential_features if col in df.columns]
    if essential_present: df.dropna(subset=essential_present, inplace=True)
    rows_after_dropna = len(df)
    # print_debug(f"Dropped {initial_rows - rows_after_dropna} rows due to missing target/essential features.")

    numeric_cols = df.select_dtypes(include=np.number).columns
    nan_counts = df[numeric_cols].isnull().sum()
    cols_with_nans = nan_counts[nan_counts > 0]
    if not cols_with_nans.empty:
        # print_debug(f"Filling remaining NaNs with 0 in {len(cols_with_nans)} numeric columns: {cols_with_nans.index.tolist()}")
        cols_to_fill = [col for col in cols_with_nans.index if col != target_original_price]
        df[cols_to_fill] = df[cols_to_fill].fillna(0)

    if df.empty: print("CRITICAL WARNING: DataFrame empty after FE cleanup."); return pd.DataFrame()

    df = df.reset_index(drop=True) # Reset index before returning

    final_cols = df.columns.tolist()
    print(f"Feature engineering complete. Final shape: {df.shape}")
    # print_debug(f"Finished engineer_features. Shape: {df.shape}. Columns ({len(final_cols)}): {', '.join(final_cols)} (took {time.time()-func_start:.2f}s)")
    print_debug(f"Finished engineer_features (took {time.time()-func_start:.2f}s)")

    return df


def train_model(df, quick_test_mode=False, quick_test_params_override=False, prop_type_map=None): # Accept prop_type_map
    func_start = time.time()
    print_debug("Starting train_model")
    target_log_price = 'LogMedianPrice_Postcode'
    if df is None or df.empty: raise ValueError("Input DataFrame for training empty/None.")
    if target_log_price not in df.columns: raise ValueError(f"Target '{target_log_price}' not in training data.")
    if df[target_log_price].isnull().any(): raise ValueError(f"Target '{target_log_price}' contains NaNs.")
    if prop_type_map is None: raise ValueError("prop_type_map must be provided to train_model.")
    # print_debug(f"Training data shape: {df.shape}")

    all_cols = df.columns.tolist()


    exclude_identifiers = ['Postcode', 'PostcodeDistrict', 'PostcodeSector', 'YearMonth', 'Postcode_Clean', 'PropTypeMapped']
    exclude_targets_raw = ['MedianPrice_Postcode', 'MedianPrice_Sector', 'MedianPrice_District', target_log_price]
    exclude_intermediates = ['PriceRatio_PC_SEC', 'PriceRatio_SEC_DIST',
                             'MedianPrice_Sector_Anchor_Lag1m', 'MedianPrice_District_Anchor_Lag1m']
    exclude_prop_type_sums = [col for col in all_cols if re.search(r'_PC_Sum$|_SEC_Sum$|_DIST_Sum$', col)]

    exclude_prop_type_base = []
    prop_type_base_names = [f'PropType_{pt}' for pt in prop_type_map.values()]
    perc_cols_exist = any(re.search(r'_PC_Perc_\d+m$|_SEC_Perc_\d+m$|_DIST_Perc_\d+m$', col) for col in all_cols)
    if perc_cols_exist:
        exclude_prop_type_base = prop_type_base_names
        # print_debug("Excluding base PropType columns as percentage features exist.", indent=1)
    # else: print_debug("Keeping base PropType columns as percentage features do not exist.", indent=1)

    exclude_cols = list(set(exclude_identifiers + exclude_targets_raw + exclude_intermediates + exclude_prop_type_sums + exclude_prop_type_base))

    potential_features = [col for col in all_cols if col not in exclude_cols]
    # print_debug(f"Initial potential features before type check: {len(potential_features)}")


    final_features = []
    invalid_dtypes = []
    # print_debug("Validating feature types for XGBoost...")
    for col in potential_features:
        if col in df.columns:
            col_dtype = df[col].dtype
            if pd.api.types.is_numeric_dtype(col_dtype):
                final_features.append(col)
            elif pd.api.types.is_categorical_dtype(col_dtype):
                 if all(isinstance(cat, (str, int, float, bool)) for cat in df[col].cat.categories):
                     final_features.append(col)
                 else:
                     invalid_dtypes.append(f"{col}: Categorical w/ complex types {df[col].cat.categories.dtype}")
                     # print(f"--- > Excluding '{col}': Complex category types.")
            # else: print(f"--- > Excluding '{col}' (dtype: {col_dtype})")
        # else: print(f"--- > Warning: Column '{col}' in potential_features but not in DataFrame.")

    if invalid_dtypes:
        print(f"\nWARNING: Excluded columns due to unsupported dtypes: {invalid_dtypes}")

    features = sorted(list(set(final_features)))
    if not features:
        raise ValueError("No valid features remaining after type checking. Review exclusion list and feature engineering.")
    if len(features) < 5:
        print(f"WARNING: Very few features ({len(features)}) remaining: {features}. Check FE/exclusion logic.")

    print(f"Final number of features for training: {len(features)}")
    # print_debug(f"Final features list: {features}") (logged later if DEBUG)

    X = df[features]
    y = df[target_log_price]

    # print_debug("Ensuring correct dtypes for XGBoost (especially categorical)...")
    cat_features_in_X = X.select_dtypes(include='category').columns.tolist()
    # if cat_features_in_X: print_debug(f"Verifying {len(cat_features_in_X)} features are 'category' dtype in X.")
    # else: print_debug("No categorical features identified in X.")

    object_cols = X.select_dtypes(include='object').columns.tolist()
    if object_cols:
         raise TypeError(f"CRITICAL ERROR: Object columns remain in X: {object_cols}. Feature engineering or type validation failed.")

    if X.isnull().any().any():
        print("INFO: NaNs detected in training features X. XGBoost 'hist' tree method will handle them.")


    params = {
        'objective': 'reg:squarederror',
        'n_estimators': 1500,
        'learning_rate': 0.02,
        'max_depth': 7,
        'subsample': 0.7,
        'colsample_bytree': 0.6,
        'random_state': 42,
        'n_jobs': -1,
        'tree_method': 'hist',
        'enable_categorical': True,
        # 'early_stopping_rounds': 50
    }

    if quick_test_mode:
        print("\n---!!! QUICK TEST MODE (DATA SUBSET USED) !!!---")

    if quick_test_params_override:
        print("\n---!!! QUICK TEST PARAMS ENABLED (FASTER/LESS ACCURATE) !!!---")
        params.update({
            'n_estimators': 50, 'learning_rate': 0.1, 'max_depth': 5,
            'subsample': 0.8, 'colsample_bytree': 0.8
        })
        quick_test_mode = True

    print(f"\nInitializing XGBoost Regressor (n_estimators={params['n_estimators']}, max_depth={params['max_depth']}, quick_test_params={quick_test_params_override})...")
    xgb_model = xgb.XGBRegressor(**params)

    print(f"Training model on {X.shape[0]} samples and {X.shape[1]} features...")
    try:
        fit_start = time.time()
        xgb_model.fit(X, y, verbose=100 if not quick_test_mode else 25)
        print_debug(f"Model fitting took {time.time() - fit_start:.2f}s")
    except Exception as e:
        print(f"\nCRITICAL ERROR DURING XGBOOST TRAINING: {e}")
        print("Check feature dtypes, NaNs, and XGBoost parameters.")
        traceback.print_exc()
        raise e

    print("Model training complete.")

    try:
        # Log the exact features used if in debug mode
        if DEBUG_MODE: print_debug(f"Features used in trained model ({len(features)}): {features}")
        feature_importances = pd.DataFrame({
            'feature': features,
            'importance': xgb_model.feature_importances_
        }).sort_values('importance', ascending=False)
        print("\nTop 20 Feature Importances:")
        print(feature_importances.head(20).to_string(index=False))
    except Exception as fi_e:
        print(f"Could not get/display feature importances: {fi_e}")

    print_debug(f"Finished train_model. Model trained. Features used: {len(features)} (took {time.time()-func_start:.2f}s)")
    return xgb_model, features



def predict_future_prices(postcode_raw, years_ahead, model, features_list, historical_df_full, certs_agg_df, prop_type_map): # Added prop_type_map
    func_start_time = datetime.now()
    print_debug(f"\n--- Prediction Start: {postcode_raw} ({years_ahead} years) at {func_start_time} ---", indent=0)

    # --- Input Validation ---
    if not isinstance(postcode_raw, str) or not postcode_raw.strip(): print_debug("Error: Invalid postcode."); return None
    if not isinstance(years_ahead, int) or years_ahead <= 0: print_debug("Error: Invalid years_ahead."); return None
    if model is None: print_debug("Error: Model is None."); return None
    if features_list is None or not features_list: print_debug("Error: Features list is None or empty."); return None
    if historical_df_full is None or historical_df_full.empty: print_debug("Error: Historical data is None or empty."); return None
    if 'YearMonth' not in historical_df_full.columns: print_debug("Error: Historical data must have a 'YearMonth' column."); return None
    historical_df_full['YearMonth'] = pd.to_datetime(historical_df_full['YearMonth'])
    historical_df_full = historical_df_full.set_index('YearMonth', drop=False).sort_index() # Keep column
    if not isinstance(historical_df_full.index, pd.DatetimeIndex): print_debug("Error: Historical data index setup failed."); return None
    if GLOBAL_MIN_DATE is None: print_debug("Error: GLOBAL_MIN_DATE is not set."); return None
    if prop_type_map is None: print_debug("Error: prop_type_map is not provided."); return None
    # print_debug(f"Inputs validated. Model: {type(model)}, Features: {len(features_list)}, History: {historical_df_full.shape}", indent=1)

    postcode_raw_upper = postcode_raw.strip().upper()
    postcode_clean = postcode_raw_upper.replace(' ', '')
    postcode_district = get_postcode_district(postcode_raw_upper)
    postcode_sector = get_postcode_sector(postcode_raw_upper)

    if not postcode_district or not postcode_sector:
        print(f"Error: Cannot parse District/Sector from '{postcode_raw_upper}'. Prediction aborted.")
        return None
    print(f"Predicting for: Postcode='{postcode_raw_upper}', Clean='{postcode_clean}', District='{postcode_district}', Sector='{postcode_sector}'")


    current_history = historical_df_full[historical_df_full['Postcode'] == postcode_clean].copy()
    current_history = current_history.sort_index()

    if current_history.empty:
        print(f"Warning: No historical data found specifically for postcode {postcode_clean}. Prediction may be unreliable or fail.")
        last_known_date = historical_df_full.index.max()
        history_level = "None"
        print_debug(f"No history for {postcode_clean}. Using global last date: {last_known_date.strftime('%Y-%m')}", indent=1)
    else:
        pc_points = len(current_history)
        history_level = "Postcode"
        last_known_date = current_history.index.max()
        print_debug(f"Found {pc_points} history points for {postcode_clean}. Last date: {last_known_date.strftime('%Y-%m')}", indent=1)

    if pd.isna(last_known_date):
         print(f"Error: Could not determine the last known date from historical data. Prediction aborted.")
         return None


    cols_needed_base = [
        'Postcode', 'PostcodeSector', 'PostcodeDistrict', 'YearMonth', # Include YearMonth
        'LogMedianPrice_Postcode', 'MedianPrice_Postcode', 'MedianPrice_Sector', 'MedianPrice_District',
        'PriceRatio_PC_SEC', 'PriceRatio_SEC_DIST',
        'TransactionCount_Postcode', 'TransactionCount_Sector', 'TransactionCount_District'
    ]
    prop_type_sum_cols = [col for col in historical_df_full.columns if re.search(r'_PC_Sum$|_SEC_Sum$|_DIST_Sum$', col)]
    cols_to_keep_in_history = sorted(list(set(features_list + cols_needed_base + prop_type_sum_cols)))


    missing_hist_cols = []
    for col in cols_to_keep_in_history:
        if col not in current_history.columns:
            missing_hist_cols.append(col)
            if col in historical_df_full.columns:
                dtype = historical_df_full[col].dtype
                if pd.api.types.is_numeric_dtype(dtype): current_history[col] = np.nan
                elif pd.api.types.is_categorical_dtype(dtype):
                     if 'Unknown' in historical_df_full[col].cat.categories:
                         current_history[col] = 'Unknown'
                         current_history[col] = current_history[col].astype(historical_df_full[col].dtype)
                     else: current_history[col] = pd.NA
                else: current_history[col] = pd.NA
            else:
                 if any(s in col for s in ['Price', 'Count', 'Log', 'Area', 'Rooms', 'Year', 'Month', 'Months']): current_history[col] = np.nan
                 elif any(s in col for s in ['Ratio']): current_history[col] = 1.0
                 elif any(s in col for s in ['Cert_', 'PropType', 'Postcode', 'Sector', 'District']): current_history[col] = 'Unknown'
                 else: current_history[col] = pd.NA

    if missing_hist_cols:
         print_debug(f"Added missing columns to current_history: {missing_hist_cols}", indent=1)

    current_history = current_history[cols_to_keep_in_history]
    # print_debug(f"Prepared 'current_history' for {postcode_clean}. Shape: {current_history.shape}, Columns: {len(current_history.columns)}", indent=1)


    static_cert_features = {}
    cert_feature_names_req = [f for f in features_list if f.startswith('Cert_')]

    if certs_agg_df is not None and not certs_agg_df.empty:
        certs_agg_df['Postcode'] = certs_agg_df['Postcode'].astype(str)
        pc_certs = certs_agg_df[certs_agg_df['Postcode'] == postcode_clean]
        if not pc_certs.empty:
            static_cert_features = pc_certs.iloc[0].to_dict()
            static_cert_features.pop('Postcode', None)
            # print_debug(f"Found aggregated certificate data for {postcode_clean}.", indent=1)
        # else: print_debug(f"No specific aggregated certificate data found for {postcode_clean}.", indent=1)
    # else: print_debug("No aggregated certificate data provided.", indent=1)

    for col in cert_feature_names_req:
        if col not in static_cert_features or pd.isna(static_cert_features.get(col)):
            is_cat = any(k in col for k in ['TYPE', 'RATING', 'FORM', 'AGE', 'TENURE'])
            static_cert_features[col] = 'Unknown' if is_cat else 0.0
            # print_debug(f"Set default value for missing/NaN static cert feature: {col} = {static_cert_features[col]}", indent=2)
    # print_debug(f"Static cert features prepared: {len(static_cert_features)} features.", indent=1)


    future_dates = pd.date_range(start=last_known_date + relativedelta(months=1), periods=years_ahead * 12, freq='MS', name='YearMonth')
    predictions = []
    print_debug(f"Starting prediction loop for {len(future_dates)} months...", indent=1)


    for current_date in future_dates:
        # loop_start_time = time.time() # Keep disabled unless timing loop
        # print_debug(f"--- Processing: {current_date.strftime('%Y-%m')} ---", indent=2) # Keep disabled unless debugging loop

        predict_df_single = pd.DataFrame(index=[current_date])

        # 1. Time Features
        predict_df_single['Year'] = current_date.year
        predict_df_single['Month'] = current_date.month
        predict_df_single['MonthsSinceStart'] = ((current_date.year - GLOBAL_MIN_DATE.year) * 12 +
                                                 current_date.month - GLOBAL_MIN_DATE.month)

        # 2. Static Certificate Features
        for col, value in static_cert_features.items():
            if col in features_list:
                 predict_df_single[col] = value

        # 3. Anchor Features
        prev_month = current_date - relativedelta(months=1)
        last_hist_entry = current_history.loc[current_history.index == prev_month]
        anchor_sec_val = np.nan
        anchor_dist_val = np.nan
        if not last_hist_entry.empty:
            anchor_sec_val = last_hist_entry['MedianPrice_Sector'].iloc[0]
            anchor_dist_val = last_hist_entry['MedianPrice_District'].iloc[0]
        anchor_sec_feature_name = 'MedianPrice_Sector_Anchor_Lag1m'
        anchor_dist_feature_name = 'MedianPrice_District_Anchor_Lag1m'
        if anchor_sec_feature_name in features_list:
            predict_df_single[anchor_sec_feature_name] = anchor_sec_val if pd.notna(anchor_sec_val) else anchor_dist_val
            predict_df_single[anchor_sec_feature_name].fillna(0.0, inplace=True)
        if anchor_dist_feature_name in features_list:
            predict_df_single[anchor_dist_feature_name] = anchor_dist_val
            predict_df_single[anchor_dist_feature_name].fillna(0.0, inplace=True)

        # 4. Lag Features
        lags = [1, 3, 6, 12, 18]
        lag_config_pred = {
            'LogPrice':    {'col': 'LogMedianPrice_Postcode',   'level': 'PC', 'default': 0.0},
            'RatioPcS':    {'col': 'PriceRatio_PC_SEC',           'level': 'PC', 'default': 1.0},
            'RatioSecD':   {'col': 'PriceRatio_SEC_DIST',         'level': 'SEC','default': 1.0},
            'CountPc':     {'col': 'TransactionCount_Postcode',   'level': 'PC', 'default': 0.0},
            'CountSec':    {'col': 'TransactionCount_Sector',     'level': 'SEC','default': 0.0},
            'CountDist':   {'col': 'TransactionCount_District',   'level': 'DIST','default':0.0}
        }
        for name, config in lag_config_pred.items():
            hist_col, level_suffix, default_val = config['col'], config['level'], config['default']
            for lag in lags:
                feature_name = f'{name}_{level_suffix}_Lag_{lag}m'
                if feature_name in features_list:
                    lag_date = current_date - relativedelta(months=lag)
                    lag_value_series = current_history.loc[current_history.index == lag_date, hist_col]
                    if not lag_value_series.empty:
                         lag_value = lag_value_series.iloc[0]
                         predict_df_single[feature_name] = lag_value if pd.notna(lag_value) else default_val
                    else:
                         predict_df_single[feature_name] = default_val


        windows = [3, 6, 12]
        level_config_rolling_pred = {
            'PC': {'count_col': 'TransactionCount_Postcode', 'ptype_sum_suffix': '_PC_Sum'},
            'SEC': {'count_col': 'TransactionCount_Sector', 'ptype_sum_suffix': '_SEC_Sum'},
            'DIST': {'count_col': 'TransactionCount_District', 'ptype_sum_suffix': '_DIST_Sum'}
        }
        for level_suffix, config in level_config_rolling_pred.items():
            count_col = config['count_col']; ptype_sum_suffix = config['ptype_sum_suffix']
            for window in windows:
                window_end = current_date - relativedelta(months=1)
                window_start = window_end - relativedelta(months=window-1)
                history_window = current_history.loc[window_start:window_end]
                # Rolling Counts
                count_feature_name = f'TxCount_{level_suffix}_Roll_{window}m'
                if count_feature_name in features_list:
                    if not history_window.empty and count_col in history_window.columns:
                         predict_df_single[count_feature_name] = history_window[count_col].sum(skipna=True)
                    else: predict_df_single[count_feature_name] = 0.0
                # Rolling Prop Mix
                level_prop_type_sum_cols = [col for col in current_history.columns if col.startswith('PropType_') and col.endswith(ptype_sum_suffix)]
                if level_prop_type_sum_cols:
                    total_count_in_window = 0.0
                    if not history_window.empty and count_col in history_window.columns:
                        total_count_in_window = history_window[count_col].sum(skipna=True)
                    for pt_sum_col in level_prop_type_sum_cols:
                        base_pt_col_match = re.match(r'^(PropType_\w+)_', pt_sum_col)
                        if not base_pt_col_match: continue
                        base_pt_col = base_pt_col_match.group(1)
                        perc_col_name = f'{base_pt_col}_{level_suffix}_Perc_{window}m'
                        if perc_col_name in features_list:
                             pt_sum_in_window = 0.0
                             if not history_window.empty and pt_sum_col in history_window.columns:
                                  pt_sum_in_window = history_window[pt_sum_col].sum(skipna=True)
                             perc_value = (pt_sum_in_window / total_count_in_window) if total_count_in_window > 0 else 0.0
                             predict_df_single[perc_col_name] = np.nan_to_num(perc_value)


        # print_debug("Aligning features for prediction...", indent=3)
        missing_model_features = []
        predict_X = pd.DataFrame(index=[current_date])
        for col in features_list:
            if col in predict_df_single.columns:
                 predict_X[col] = predict_df_single[col]
                 if predict_X[col].isnull().any():
                     default_val = 0.0; is_cat = False
                     if col in historical_df_full.columns and isinstance(historical_df_full[col].dtype, pd.CategoricalDtype): default_val, is_cat = 'Unknown', True
                     elif col.startswith("Cert_") and any(k in col for k in ['TYPE','RATING','FORM','AGE','TENURE']): default_val, is_cat = 'Unknown', True
                     elif col.startswith("Ratio"): default_val = 1.0
                     predict_X[col].fillna(default_val, inplace=True)
            else:
                 missing_model_features.append(col)
                 default_val = 0.0; is_cat = False
                 if col in historical_df_full.columns and isinstance(historical_df_full[col].dtype, pd.CategoricalDtype): default_val, is_cat = 'Unknown', True
                 elif col.startswith("Cert_") and any(k in col for k in ['TYPE','RATING','FORM','AGE','TENURE']): default_val, is_cat = 'Unknown', True
                 elif col.startswith("Ratio"): default_val = 1.0
                 elif col.startswith("TxCount_") or col.startswith("Count"): default_val = 0.0
                 predict_X[col] = default_val

        if missing_model_features:
            print(f"WARNING: {len(missing_model_features)} model features not generated, filled with defaults: {missing_model_features}")

        for col in predict_X.select_dtypes(include=['object', 'category']).columns:
             if col in features_list:
                 if col in historical_df_full.columns and isinstance(historical_df_full[col].dtype, pd.CategoricalDtype):
                     train_cats = historical_df_full[col].cat.categories
                     unknown_cat_present = 'Unknown' in train_cats
                     current_value = predict_X[col].iloc[0]
                     if current_value not in train_cats:
                         predict_X[col] = 'Unknown' if unknown_cat_present else pd.NA
                     try:
                         if not pd.api.types.is_categorical_dtype(predict_X[col]) or predict_X[col].cat.categories.tolist() != train_cats.tolist():
                              predict_X[col] = pd.Categorical(predict_X[col], categories=train_cats)
                     except Exception as e:
                         print(f"ERROR converting pred col '{col}' to train cats: {e}. Setting to NA.")
                         predict_X[col] = pd.NA
                 elif predict_X[col].dtype == 'object':
                      predict_X[col] = predict_X[col].astype('category')

        if predict_X.isnull().any().any():
            nan_cols = predict_X.columns[predict_X.isnull().any()].tolist()
            print(f"WARNING: NaNs remain in features for {current_date.strftime('%Y-%m')}: {nan_cols}. XGBoost should handle.")

        try:
            predict_X = predict_X[features_list]
        except KeyError as e:
            print(f"CRITICAL ERROR: Features mismatch just before prediction.")
            print(f"Missing in predict_X: {set(features_list) - set(predict_X.columns)}")
            print(f"Extra in predict_X: {set(predict_X.columns) - set(features_list)}")
            raise e

        # 7. Make Prediction
        try:
            predicted_log_price = model.predict(predict_X)[0]
            predicted_price = max(0, float(np.expm1(predicted_log_price)))
            # print_debug(f"Predicted Price: {predicted_price:,.0f} (Log: {predicted_log_price:.4f})", indent=3) # Keep disabled unless debugging values
        except Exception as e:
            print(f"CRITICAL ERROR during model.predict() for {current_date.strftime('%Y-%m')}: {e}")
            print(f"Predict_X dtypes:\n{predict_X.info()}")
            traceback.print_exc()
            return pd.DataFrame(predictions)

        predictions.append({'YearMonth': current_date, 'Predicted_Median_Price': predicted_price, 'Based_On_History': history_level})


        new_hist_data = {}
        new_hist_data['YearMonth'] = current_date
        new_hist_data['Postcode'] = postcode_clean
        new_hist_data['PostcodeSector'] = postcode_sector
        new_hist_data['PostcodeDistrict'] = postcode_district
        new_hist_data['LogMedianPrice_Postcode'] = predicted_log_price
        new_hist_data['MedianPrice_Postcode'] = predicted_price


        prev_month = current_date - relativedelta(months=1)
        prev_month_data = current_history.loc[current_history.index == prev_month] 

        if not prev_month_data.empty:
            last_row_values = prev_month_data.iloc[0]
            for col in ['MedianPrice_Sector', 'MedianPrice_District', 'TransactionCount_Sector', 'TransactionCount_District']:
                 val = last_row_values.get(col)
                 if pd.notna(val):
                     new_hist_data[col] = val
                 else:
                     new_hist_data[col] = 0.0 if 'Count' in col else predicted_price if 'Price' in col else np.nan # Use predicted price as fallback for NaN price
            new_hist_data['TransactionCount_Postcode'] = 1
            for col in prop_type_sum_cols:
                 val = last_row_values.get(col)
                 new_hist_data[col] = val if pd.notna(val) else 0
        else:
             # print_debug(f"No history found for previous month ({prev_month.strftime('%Y-%m')}). Using defaults/estimates.", indent=4)
             new_hist_data['MedianPrice_Sector'] = predicted_price
             new_hist_data['MedianPrice_District'] = predicted_price
             new_hist_data['TransactionCount_Postcode'] = 1
             new_hist_data['TransactionCount_Sector'] = 1
             new_hist_data['TransactionCount_District'] = 1
             for col in prop_type_sum_cols:
                 new_hist_data[col] = 1 if 'PropType_Other' in col else 0

        mp_sector = new_hist_data.get('MedianPrice_Sector')
        mp_district = new_hist_data.get('MedianPrice_District')
        new_hist_data['PriceRatio_PC_SEC'] = (predicted_price / mp_sector) if pd.notna(mp_sector) and mp_sector > 0 else 1.0
        new_hist_data['PriceRatio_SEC_DIST'] = (mp_sector / mp_district) if pd.notna(mp_sector) and pd.notna(mp_district) and mp_district > 0 else 1.0

        for col in features_list:
             if col not in new_hist_data:
                 new_hist_data[col] = predict_X[col].iloc[0]

        new_hist_row_df = pd.DataFrame(new_hist_data, index=[current_date])
        new_hist_row_df.index.name = 'YearMonth'

        cols_for_concat = current_history.columns.intersection(new_hist_row_df.columns)
        new_hist_row_subset = new_hist_row_df[cols_for_concat].copy()

        for col in cols_for_concat:
            hist_dtype = current_history[col].dtype
            new_dtype = new_hist_row_subset[col].dtype
            if hist_dtype == new_dtype: continue
            try:
                if pd.api.types.is_categorical_dtype(hist_dtype):
                    current_val = new_hist_row_subset[col].iloc[0]
                    if current_val not in hist_dtype.categories:
                         if 'Unknown' in hist_dtype.categories: new_hist_row_subset[col] = 'Unknown'
                         else: new_hist_row_subset[col] = pd.NA
                    new_hist_row_subset[col] = pd.Categorical(new_hist_row_subset[col], categories=hist_dtype.categories)
                elif pd.api.types.is_numeric_dtype(hist_dtype):
                    new_hist_row_subset[col] = pd.to_numeric(new_hist_row_subset[col], errors='coerce').astype(hist_dtype)
                elif pd.api.types.is_datetime64_any_dtype(hist_dtype):
                     new_hist_row_subset[col] = pd.to_datetime(new_hist_row_subset[col], errors='coerce')
                elif pd.api.types.is_string_dtype(hist_dtype) or pd.api.types.is_object_dtype(hist_dtype):
                     new_hist_row_subset[col] = new_hist_row_subset[col].astype(hist_dtype)
            except Exception as e:
                print(f"CRITICAL WARNING: Type alignment failed for column '{col}'. Hist={hist_dtype}, NewVal={new_hist_row_subset[col].iloc[0]}({new_dtype}). Error: {e}. Attempting object conversion.")
                try:
                    current_history[col] = current_history[col].astype(object)
                    new_hist_row_subset[col] = new_hist_row_subset[col].astype(object)
                except Exception as obj_e:
                     print(f"    Failed object conversion fallback for '{col}': {obj_e}")

        try:
            current_history = pd.concat([current_history, new_hist_row_subset[cols_for_concat]], ignore_index=False)
            if current_history.index.duplicated().any():
                 current_history = current_history[~current_history.index.duplicated(keep='last')]
        except Exception as e:
            print(f"ERROR during history concat for {current_date.strftime('%Y-%m')}: {e}")
            print(f"Current history dtypes:\n{current_history.info()}")
            print(f"New row dtypes:\n{new_hist_row_subset.info()}")
            traceback.print_exc()
            return pd.DataFrame(predictions)

        # loop_duration = time.time() - loop_start_time # Keep disabled unless timing loop
        # print_debug(f"--- Month {current_date.strftime('%Y-%m')} processing took {loop_duration:.3f}s ---", indent=2) # Keep disabled for cleaner output


    print(f"\nPrediction generation complete for {postcode_raw_upper}. Total time: {datetime.now() - func_start_time}")
    return pd.DataFrame(predictions)



if __name__ == "__main__":
    main_start_time = datetime.now()
    print(f"--- Script Start: {main_start_time.strftime('%Y-%m-%d %H:%M:%S')} ---")

    FORCE_RETRAIN = False
    QUICK_TEST_DATA = False
    QUICK_TEST_PARAMS = False


    model, feature_names, historical_data, aggregated_certs, prop_type_map = None, None, None, None, None
    model_loaded = False


    if not FORCE_RETRAIN and os.path.exists(MODEL_FILENAME) and os.path.exists(FEATURES_FILENAME):
        print(f"Attempting to load existing model from {MODEL_FILENAME}...")
        try:
            load_model_start = time.time()
            model = joblib.load(MODEL_FILENAME)
            feature_names = joblib.load(FEATURES_FILENAME)
            model_loaded = True
            print(f"Model and features loaded successfully. (took {time.time() - load_model_start:.2f}s)")
            print(f"Model trained with {len(feature_names)} features.")
        except Exception as e:
            print(f"Error loading model/features: {e}. Will retrain.")
            model, feature_names = None, None; model_loaded = False
            traceback.print_exc()
    else:
        if FORCE_RETRAIN: print("FORCE_RETRAIN is True. Training new model.")
        else: print("Model or features file not found. Training new model.")


    print("\n--- Preparing Historical Data ---")
    data_prep_start = time.time()
    try:
        raw_pp_data, prop_type_map = load_price_data(PRICE_PAID_DIR, PP_FILE_PATTERN)
        monthly_aggregated_prices = preprocess_price_data(raw_pp_data, prop_type_map)
        del raw_pp_data
        aggregated_certs = load_and_process_certificates(CERTIFICATES_FILE)
        combined_data = combine_data(monthly_aggregated_prices, aggregated_certs)
        del monthly_aggregated_prices
        historical_data = engineer_features(combined_data, prop_type_map)
        del combined_data

        if historical_data is None or historical_data.empty:
            raise ValueError("Feature engineering resulted in empty DataFrame. Cannot proceed.")

        print(f"Historical data preparation complete. Shape: {historical_data.shape}. (took {time.time() - data_prep_start:.2f}s)")
        print_debug(f"Global Min Date set to: {GLOBAL_MIN_DATE}")

    except Exception as data_err:
        print(f"\nCRITICAL ERROR during data preparation: {data_err}")
        traceback.print_exc()
        historical_data = None


    if not model_loaded and historical_data is not None:
        print("-" * 30 + f"\n--- Starting Model Training (Quick Train Data: {QUICK_TEST_DATA}, Quick Params: {QUICK_TEST_PARAMS}) ---\n" + "-" * 30)
        try:
            train_prep_start = time.time()
            data_to_train = historical_data 

            if QUICK_TEST_DATA:
                print("\n---!!! SUBSAMPLING DATA FOR QUICK TESTING (INVALID RESULTS) !!!---")
                n_samples = max(5000, int(len(data_to_train) * 0.05))
                n_samples = min(n_samples, len(data_to_train))
                data_to_train = data_to_train.sample(n=n_samples, random_state=42)
                print(f"--- Using subset for training: {data_to_train.shape} ---")

            # print_debug(f"Data selection for training took {time.time() - train_prep_start:.2f}s")

            model, feature_names = train_model(
                data_to_train,
                quick_test_mode=QUICK_TEST_DATA,
                quick_test_params_override=QUICK_TEST_PARAMS,
                prop_type_map=prop_type_map
            )
            del data_to_train

            if not QUICK_TEST_DATA and not QUICK_TEST_PARAMS:
                print("\n--- Saving Model and Features ---")
                print(f"Saving model to: {MODEL_FILENAME}...")
                joblib.dump(model, MODEL_FILENAME)
                print(f"Saving features list ({len(feature_names)} features) to: {FEATURES_FILENAME}...")
                joblib.dump(feature_names, FEATURES_FILENAME)
                model_loaded = True
            else:
                print("\n--- QUICK TEST MODE: Model/features not saved. ---")
                model_loaded = True

        except Exception as train_e:
            print(f"\nERROR during model training: {train_e}")
            traceback.print_exc()
            model = None


    if model and feature_names is not None and historical_data is not None and not historical_data.empty:
         print("\n" + "=" * 40)
         print("      Model Ready for Predictions")
         print("=" * 40)

         while True:
            print("\n--- Make a Prediction ---")
            try:
                target_postcode = input("Enter UK postcode (or type 'quit' to exit): ")
            except EOFError:
                print("\nInput stream closed. Exiting.")
                break

            if target_postcode.lower().strip() == 'quit':
                break

            target_postcode = target_postcode.strip()
            if not target_postcode:
                print("Please enter a postcode.")
                continue

            if not re.match(r'^[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}$', target_postcode, re.IGNORECASE):
                 print("Warning: Postcode format may be invalid, but attempting prediction anyway.")

            years_to_predict = 5

            try:
                # print_debug(f"Calling predict_future_prices for '{target_postcode}' ({years_to_predict} years)") # Keep disabled unless debugging calls
                future_predictions_df = predict_future_prices(
                    target_postcode,
                    years_to_predict,
                    model,
                    feature_names,
                    historical_data.copy(),
                    aggregated_certs,
                    prop_type_map
                )
            except Exception as pred_e:
                print(f"\nUnexpected ERROR during prediction call for {target_postcode}: {pred_e}")
                traceback.print_exc()
                future_predictions_df = None

            if future_predictions_df is not None and not future_predictions_df.empty:
                print(f"\n--- Predicted Median Prices for {target_postcode.upper()} ({years_to_predict} Years) ---")
                try:
                    future_predictions_df['YearMonthFmt'] = pd.to_datetime(future_predictions_df['YearMonth']).dt.strftime('%Y-%m')
                    future_predictions_df['Predicted_Median_Price'] = future_predictions_df['Predicted_Median_Price'].round(0).astype(int)
                    future_predictions_df['Year'] = pd.to_datetime(future_predictions_df['YearMonth']).dt.year

                    base_level = future_predictions_df['Based_On_History'].iloc[0]
                    print(f"Prediction primarily based on: {base_level} level data")

                    for year in sorted(future_predictions_df['Year'].unique()):
                        print(f"\n-- {year} --")
                        print(future_predictions_df[future_predictions_df['Year'] == year][['YearMonthFmt', 'Predicted_Median_Price']].to_string(index=False, header=True))

                except Exception as fmt_e:
                    print(f"Warning: Error formatting prediction results: {fmt_e}")
                    print(future_predictions_df)

            elif future_predictions_df is None:
                 print(f"Prediction failed for {target_postcode} due to an error during the process.")
            else:
                 print(f"No predictions could be generated for {target_postcode}. Insufficient historical data or other issue.")

    elif not model:
        print("\nModel not loaded or trained. Cannot start prediction loop.")
    elif historical_data is None or historical_data.empty:
         print("\nHistorical data preparation failed or resulted in empty data. Cannot start prediction loop.")

    print(f"\nExiting program. Total time: {datetime.now() - main_start_time}")