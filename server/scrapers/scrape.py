# /server/scrapers/scrape.py
# MODIFIED FOR SSE STREAMING OUTPUT

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    WebDriverException,
    InvalidSelectorException,
    NoSuchWindowException,
    ElementClickInterceptedException,
)
from bs4 import BeautifulSoup
import json
import time
import random
import re
import argparse
import sys
import traceback

# --- Constants ---
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36"


# --- Helper to print JSON output for SSE ---
def print_sse_json(data):
    """Prints JSON data to stdout and flushes the buffer."""
    try:
        print(json.dumps(data), flush=True)
    except Exception as e:
        # Fallback if data cannot be JSON serialized
        print(
            json.dumps(
                {
                    "error": f"Failed to serialize data for SSE: {e}",
                    "original_data_type": str(type(data)),
                }
            ),
            flush=True,
        )


class RightmoveScraper:
    # --- __init__, close_driver, robust_click, search_by_postcode ---
    # --- remain EXACTLY the same as the previous version          ---
    def __init__(self, postcode="TS178BT"):
        # self.results = [] # No longer needed to store all results here
        self.postcode = postcode
        self.search_postcode = postcode[:3]
        self.processed_properties_count = 0  # Track if any properties were processed
        print(
            f"Initializing scraper for postcode: {postcode}, using search term: {self.search_postcode}",
            file=sys.stderr,
        )
        # ... rest of __init__ is the same ...
        chrome_options = Options()
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_argument(f"user-agent={USER_AGENT}")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)

        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.driver.set_page_load_timeout(45)
            print("WebDriver initialized successfully.", file=sys.stderr)
        except WebDriverException as e:
            # Print fatal error to stdout for SSE handling
            print_sse_json({"error": f"Failed to initialize WebDriver: {str(e)}"})
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print_sse_json(
                {"error": f"An unexpected error occurred during driver setup: {str(e)}"}
            )
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)

    def close_driver(self):
        if hasattr(self, "driver") and self.driver:
            # ... same logic as before ...
            try:
                print("Closing WebDriver.", file=sys.stderr)
                handles = self.driver.window_handles
                for handle in handles[1:]:
                    try:
                        self.driver.switch_to.window(handle)
                        self.driver.close()
                    except (NoSuchWindowException, WebDriverException):
                        pass
                if handles:
                    try:
                        self.driver.switch_to.window(handles[0])
                    except (NoSuchWindowException, WebDriverException):
                        pass
                self.driver.quit()
            except WebDriverException as qe:
                if "invalid session id" in str(qe) or "session deleted" in str(qe):
                    print(
                        "Warning: WebDriver session already invalid or closed during quit.",
                        file=sys.stderr,
                    )
                else:
                    # Log warning to stderr, don't send to stdout as it might interfere with SSE
                    print(
                        f"Warning: Error closing WebDriver: {str(qe)}", file=sys.stderr
                    )
            except Exception as e:
                print(
                    f"Warning: Unexpected error closing WebDriver: {str(e)}",
                    file=sys.stderr,
                )

    def robust_click(self, element_locator, timeout=10):
        # ... same logic as before ...
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.element_to_be_clickable(element_locator)
            )
            try:
                self.driver.execute_script("arguments[0].click();", element)
                return True
            except Exception:
                element.click()
                return True
        except ElementClickInterceptedException:
            try:
                element = WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located(element_locator)
                )
                self.driver.execute_script(
                    "arguments[0].scrollIntoView({block: 'center'});", element
                )
                time.sleep(0.5)
                element_clickable = WebDriverWait(self.driver, 5).until(
                    EC.element_to_be_clickable(element_locator)
                )
                self.driver.execute_script("arguments[0].click();", element_clickable)
                return True
            except Exception as e:
                print(
                    f"  Click failed even after scroll for {element_locator}: {e}",
                    file=sys.stderr,
                )
                return False
        except TimeoutException:
            print(
                f"  Timeout waiting for element {element_locator} to be clickable.",
                file=sys.stderr,
            )
            return False
        except Exception as e:
            print(f"  Error clicking element {element_locator}: {e}", file=sys.stderr)
            return False

    def search_by_postcode(self):
        print(
            f"Navigating to Rightmove homepage and searching for postcode: {self.search_postcode}",
            file=sys.stderr,
        )
        try:
            self.driver.get("https://www.rightmove.co.uk/")

            # Wait for a key element like the search box to confirm basic page load
            search_box_locator = (
                By.CSS_SELECTOR,
                "input.dsrm_inputText.ta_userInput#ta_searchInput",
            )
            try:
                WebDriverWait(self.driver, 15).until(
                    EC.presence_of_element_located(search_box_locator)
                )
                print("Homepage basic structure loaded.", file=sys.stderr)
            except TimeoutException:
                raise Exception(
                    "Homepage did not load correctly (search box not found)."
                )

            # --- Optimized Cookie Handling ---
            print("Checking for cookie banner...", file=sys.stderr)
            accept_locator_xpath = '//button[contains(text(), "Accept") or contains(text(), "ACCEPT ALL")]'  # Flexible XPath
            try:
                # Use find_elements for a non-blocking check. Returns empty list if not found.
                accept_buttons = self.driver.find_elements(
                    By.XPATH, accept_locator_xpath
                )

                if accept_buttons:
                    # Found potential button(s). Try to click the first one.
                    button_to_click = accept_buttons[0]
                    # Check if it's actually visible/interactable before clicking
                    if button_to_click.is_displayed() and button_to_click.is_enabled():
                        try:
                            print(
                                "Cookie banner found. Attempting to click...",
                                file=sys.stderr,
                            )
                            button_to_click.click()
                            print("Clicked cookie accept button.", file=sys.stderr)
                            time.sleep(
                                random.uniform(0.2, 0.4)
                            )  # Minimal pause ONLY after successful click
                        except ElementNotInteractableException:
                            # Fallback if click is intercepted or element obscured
                            try:
                                print(
                                    "Cookie button not directly interactable, trying JS click...",
                                    file=sys.stderr,
                                )
                                self.driver.execute_script(
                                    "arguments[0].click();", button_to_click
                                )
                                print(
                                    "Clicked cookie accept button via JS.",
                                    file=sys.stderr,
                                )
                                time.sleep(
                                    random.uniform(0.2, 0.4)
                                )  # Minimal pause ONLY after successful click
                            except Exception as js_e:
                                print(
                                    f"Warning: JS click on cookie button failed: {js_e}",
                                    file=sys.stderr,
                                )
                        except Exception as click_e:
                            print(
                                f"Warning: Error clicking cookie button: {click_e}",
                                file=sys.stderr,
                            )
                    else:
                        # Found in DOM but not visible/enabled. Ignore it.
                        print(
                            "Cookie button found but not interactable, proceeding without click.",
                            file=sys.stderr,
                        )
                else:
                    # Button not found by find_elements - common case if already accepted.
                    print(
                        "Cookie banner button not found (or already handled), proceeding.",
                        file=sys.stderr,
                    )

            except Exception as cookie_e:
                # Catch unexpected errors during the check itself (e.g., invalid XPath temporarily)
                print(
                    f"Warning: Error during cookie banner check logic: {cookie_e}",
                    file=sys.stderr,
                )
            # --- End of Optimized Cookie Handling ---

            # --- Search Box Interaction (Using previous optimized version) ---
            search_box = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable(search_box_locator)
            )
            search_box.clear()
            search_box.send_keys(self.search_postcode)

            # --- Autocomplete ---
            autocomplete_list_locator = (By.CSS_SELECTOR, "ul.ta_searchResults")
            autocomplete_first_item_locator = (
                By.CSS_SELECTOR,
                "ul.ta_searchResults li.ta_searchResultRow",
            )
            try:
                WebDriverWait(self.driver, 7).until(
                    EC.visibility_of_element_located(autocomplete_list_locator)
                )
            except TimeoutException:
                raise Exception(
                    "Autocomplete suggestions did not appear after typing postcode."
                )

            if not self.robust_click(autocomplete_first_item_locator, timeout=7):
                raise Exception("Failed to click autocomplete result.")

            # --- 'For Sale' Button ---
            for_sale_locator = (
                By.CSS_SELECTOR,
                "button.dsrm_button[data-testid='forSaleCta']",
            )
            WebDriverWait(self.driver, 7).until(
                EC.element_to_be_clickable(for_sale_locator)
            )
            if not self.robust_click(for_sale_locator, timeout=7):
                raise Exception("Failed to click 'For Sale' button.")

            # --- Search Button ---
            search_button_locator = (By.CSS_SELECTOR, "button.dsrm_button#submit")
            WebDriverWait(self.driver, 7).until(
                EC.element_to_be_clickable(search_button_locator)
            )
            if not self.robust_click(search_button_locator, timeout=7):
                raise Exception("Failed to click 'Search Properties' button.")

            # --- Wait for Results Page ---
            results_price_locator = (By.CSS_SELECTOR, ".PropertyPrice_price__VL65t")
            WebDriverWait(self.driver, 15).until(
                EC.presence_of_element_located(results_price_locator)
            )
            print("Successfully navigated to search results page", file=sys.stderr)
            return True

        except Exception as e:
            # Make sure to handle the error reporting (e.g., print_sse_json if needed)
            print(
                f"Error during search navigation: {type(e).__name__} - {e}",
                file=sys.stderr,
            )
            traceback.print_exc(file=sys.stderr)
            # Example SSE error reporting:
            # print_sse_json({"error": f"Search navigation failed: {type(e).__name__} - {e}"})
            return False

    # --- Parse method MODIFIED to print each result ---
    def parse(self, html):
        if not html:
            print("No HTML content to parse.", file=sys.stderr)
            return

        print(
            "Parsing list page HTML and preparing for sequential detail fetch...",
            file=sys.stderr,
        )
        page_processed_count = 0
        soup = BeautifulSoup(html, "lxml")

        prices = soup.find_all("div", class_="PropertyPrice_price__VL65t")
        addresses = soup.find_all("address", class_="PropertyAddress_address__LYRPq")
        descriptions = soup.find_all("p", class_="PropertyCardSummary_summary__oIv57")
        bedrooms = soup.find_all(
            "span", class_="PropertyInformation_bedroomsCount___2b5R"
        )
        all_spans = soup.find_all("span", {"aria-label": True})
        links = soup.select("a.propertyCard-link")

        num_properties_to_process = len(links)

        for i in range(num_properties_to_process):
            property_data = {
                "id": f"rm_temp_{i}",
                "price": "N/A",
                "address": "N/A",
                "description": "N/A",
                "bedrooms": "N/A",
                "bathrooms": "N/A",
                "square_footage": "N/A",
                "property_type": "N/A",
                "latitude": "N/A",
                "longitude": "N/A",
                "detail_url": "N/A",
                "source": "Rightmove",
            }
            is_fatal_error = False  # Flag to stop processing if session dies

            try:
                # --- Extract basic info (same as before) ---
                if i < len(prices):
                    property_data["price"] = prices[i].get_text(strip=True)
                if i < len(addresses):
                    property_data["address"] = addresses[i].get_text(strip=True)
                if i < len(descriptions):
                    property_data["description"] = descriptions[i].get_text(strip=True)
                if i < len(bedrooms):
                    bedroom_text = bedrooms[i].get_text(strip=True)
                    match_bed = re.search(r"\d+", bedroom_text)
                    if match_bed:
                        property_data["bedrooms"] = match_bed.group(0)
                if i < len(all_spans):  # Bathroom logic (same potential unreliability)
                    aria_label = all_spans[i].get("aria-label", "").lower()
                    if "bathroom" in aria_label or (
                        "in property" in aria_label and aria_label.split()[0].isdigit()
                    ):
                        match_bath = re.search(
                            r"(\d+)\s+bathroom", aria_label, re.IGNORECASE
                        )
                        if match_bath:
                            property_data["bathrooms"] = match_bath.group(1)
                        elif aria_label.split() and aria_label.split()[0].isdigit():
                            property_data["bathrooms"] = aria_label.split()[0]

                link_element = links[i]
                href = link_element.get("href")
                if href and href.startswith("/properties/"):
                    property_data["detail_url"] = "https://www.rightmove.co.uk" + href
                    match_id = re.search(r"/properties/(\d+)", href)
                    if match_id:
                        property_data["id"] = f"rm_{match_id.group(1)}"
                else:
                    print(
                        f" Skipping detail fetch for card {i+1}: Invalid link {href}",
                        file=sys.stderr,
                    )
                    # Print basic info even if link bad? Maybe not, could be confusing. Let's skip.
                    continue

                # --- Fetch details sequentially (same core logic) ---
                # print(f"  Fetching details for card {i+1}: {property_data['id']}", file=sys.stderr) # Reduce verbosity
                original_window = self.driver.current_window_handle
                new_window = None
                detail_fetch_error = None  # Track non-fatal errors for this property

                try:
                    self.driver.execute_script(
                        "window.open(arguments[0]);", property_data["detail_url"]
                    )
                    WebDriverWait(self.driver, 10).until(
                        EC.number_of_windows_to_be(len(self.driver.window_handles))
                    )
                    new_window_handle = [
                        w for w in self.driver.window_handles if w != original_window
                    ]
                    if not new_window_handle:
                        raise Exception("New window did not open.")
                    new_window = new_window_handle[0]
                    self.driver.switch_to.window(new_window)

                    detail_page_marker_selector = "._2uQQ3SV0eMHL1P6t5ZDo2q"
                    try:
                        WebDriverWait(self.driver, 15).until(
                            EC.presence_of_element_located(
                                (By.CSS_SELECTOR, detail_page_marker_selector)
                            )
                        )
                    except TimeoutException:
                        print(
                            f"   Warning: Detail page marker '{detail_page_marker_selector}' not found for {property_data['id']}.",
                            file=sys.stderr,
                        )
                    time.sleep(random.uniform(0.3, 0.7))

                    # --- Coordinate Extraction (Primary Goal) ---
                    try:
                        page_source = self.driver.page_source
                        match = re.search(
                            r'"latitude"\s*:\s*([0-9.]+)\s*,\s*"longitude"\s*:\s*(-?[0-9.]+)',
                            page_source,
                        )
                        if match:
                            property_data["latitude"] = match.group(1)
                            property_data["longitude"] = match.group(2)
                        # else: print(f"    Coordinates regex pattern not found for {property_data['id']}.", file=sys.stderr) # Reduce verbosity
                    except Exception as e_coords:
                        print(
                            f"    Error extracting coordinates: {e_coords}",
                            file=sys.stderr,
                        )
                        detail_fetch_error = (
                            f"Coord error: {e_coords}"  # Log non-fatal error
                        )

                    # --- SqFt / Type Extraction (Secondary) ---
                    if (
                        not detail_fetch_error
                    ):  # Only attempt if coordinate extraction didn't already fail critically
                        try:  # SqFt
                            sqft_element = self.driver.find_element(
                                By.XPATH,
                                "//*[contains(text(), 'sq ft') or contains(text(), 'sq. ft.') or contains(text(), 'sqm') or contains(text(), 'm²')]",
                            )
                            sqft_text = sqft_element.text.strip()
                            match_sqft = re.search(
                                r"([\d,]+)\s*sq\s*ft", sqft_text, re.IGNORECASE
                            )
                            match_sqm = re.search(
                                r"([\d.,]+)\s*m²", sqft_text, re.IGNORECASE
                            )
                            if match_sqft:
                                property_data["square_footage"] = (
                                    match_sqft.group(1).replace(",", "") + " sq ft"
                                )
                            elif match_sqm:
                                sqm_val = float(match_sqm.group(1).replace(",", ""))
                                sqft_val = round(sqm_val * 10.764)
                                property_data["square_footage"] = (
                                    f"{sqft_val} sq ft (from {match_sqm.group(1)} m²)"
                                )
                            else:
                                property_data["square_footage"] = sqft_text
                        except NoSuchElementException:
                            pass
                        except Exception as e_sqft:
                            print(
                                f"    Error extracting sqft: {e_sqft}", file=sys.stderr
                            )  # Log non-fatal

                        try:  # Type
                            try:
                                prop_elem = self.driver.find_element(
                                    By.CSS_SELECTOR, "p._1hV1kqpVceE9m-QrX_hWDN"
                                )
                                property_data["property_type"] = prop_elem.text.strip()
                            except NoSuchElementException:
                                found_type = False
                                known_types = [
                                    "flat",
                                    "apartment",
                                    "house",
                                    "bungalow",
                                    "studio",
                                    "maisonette",
                                    "duplex",
                                    "terraced",
                                    "semi-detached",
                                    "detached",
                                    "end of terrace",
                                    "cottage",
                                    "townhouse",
                                    "mews",
                                    "mobile home",
                                    "park home",
                                    "land",
                                    "farmhouse",
                                    "barn conversion",
                                    "retirement property",
                                    "houseboat",
                                    "block of apartments",
                                    "penthouse",
                                    "link-detached",
                                ]
                                for tag_name in ["h1", "h2", "div", "p"]:
                                    elements = self.driver.find_elements(
                                        By.TAG_NAME, tag_name
                                    )
                                    for elem in elements:
                                        try:
                                            text = elem.text.strip().lower()
                                            if 0 < len(text) < 100:
                                                for ktype in known_types:
                                                    if re.search(
                                                        r"\b"
                                                        + re.escape(ktype)
                                                        + r"\b",
                                                        text,
                                                    ):
                                                        property_data[
                                                            "property_type"
                                                        ] = ktype.capitalize()
                                                        found_type = True
                                                        break
                                        except Exception:
                                            continue
                                        if found_type:
                                            break
                                    if found_type:
                                        break
                        except Exception as e_prop:
                            print(
                                f"    Error extracting property type: {e_prop}",
                                file=sys.stderr,
                            )  # Log non-fatal

                except (
                    TimeoutException,
                    NoSuchWindowException,
                    WebDriverException,
                    Exception,
                ) as e_detail:
                    # Handle potentially fatal errors during tab management/loading
                    print(
                        f"   Error during detail fetch for {property_data['id']}: {type(e_detail).__name__} - {e_detail}",
                        file=sys.stderr,
                    )
                    detail_fetch_error = f"Fetch error: {type(e_detail).__name__}"  # Store generic error type
                    # Check if it's a session-killing error
                    if isinstance(e_detail, WebDriverException) and (
                        "invalid session id" in str(e_detail).lower()
                        or "session deleted" in str(e_detail).lower()
                        or "unable to connect" in str(e_detail).lower()
                    ):
                        print(
                            "!!! FATAL WebDriverException detected. Aborting script.",
                            file=sys.stderr,
                        )
                        print_sse_json(
                            {"error": f"Fatal WebDriverException: {e_detail}"}
                        )  # Send fatal error to SSE
                        is_fatal_error = True  # Set flag
                        raise  # Re-raise to stop the run method
                    if isinstance(e_detail, NoSuchWindowException):
                        new_window = None  # Window is gone
                finally:
                    # --- Careful cleanup (same as before) ---
                    try:
                        current_handles_before_close = self.driver.window_handles
                        if new_window and new_window in current_handles_before_close:
                            self.driver.close()
                        current_handles_after_close = self.driver.window_handles
                        if original_window in current_handles_after_close:
                            self.driver.switch_to.window(original_window)
                        elif current_handles_after_close:
                            self.driver.switch_to.window(current_handles_after_close[0])
                        # Don't raise fatal error here if already handled or window gone
                    except (NoSuchWindowException, WebDriverException) as e_cleanup:
                        print(
                            f"   Non-critical error during window cleanup for {property_data['id']}: {e_cleanup}",
                            file=sys.stderr,
                        )
                        # If session dies here, the outer loop will catch it next iteration

                # --- Print the processed property data to stdout ---
                # Include error if one occurred during detail fetch for this property
                if detail_fetch_error:
                    property_data["fetch_error"] = detail_fetch_error
                    print(
                        f"  Processed card {i+1} ({property_data['id']}) with fetch error.",
                        file=sys.stderr,
                    )

                # Send the data (even if details failed but basic info is present)
                print_sse_json(property_data)
                page_processed_count += 1
                self.processed_properties_count += 1  # Increment global counter

            except WebDriverException as e_outer_wd:
                # Catch fatal WebDriver errors in the outer loop immediately
                print(
                    f"!! FATAL WebDriverException processing card index {i}: {e_outer_wd}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
                print_sse_json({"error": f"Fatal WebDriverException: {e_outer_wd}"})
                raise  # Stop the run
            except Exception as e_outer:
                print(
                    f"!! Major error processing property card index {i}: {e_outer}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
                # Log error to stderr, but maybe don't send to SSE unless it's fatal
                # Optionally send a specific error for this card:
                # print_sse_json({"error": f"Failed processing card {i}: {e_outer}", "card_index": i})
                # Decide whether to continue or break based on error type if needed

        print(
            f"Finished parsing page. Processed {page_processed_count}/{num_properties_to_process} properties.",
            file=sys.stderr,
        )

    # --- Run method MODIFIED for SSE output ---
    def run(self):
        print("Starting scraper run...", file=sys.stderr)
        script_error = None  # For storing script-level errors (navigation, pagination)
        start_time = time.time()
        try:
            if self.search_by_postcode():
                print("\nProcessing page 1...", file=sys.stderr)
                html = self.driver.page_source
                self.parse(html)  # Prints results as they are found

                max_pages = 1
                for page in range(1, max_pages):
                    print(f"\nChecking for page {page + 1}...", file=sys.stderr)
                    try:
                        next_button_locator = (
                            By.CSS_SELECTOR,
                            "button.pagination-button.pagination-direction.pagination-direction--next",
                        )
                        try:
                            next_button_present = WebDriverWait(self.driver, 5).until(
                                EC.presence_of_element_located(next_button_locator)
                            )
                            if next_button_present.get_attribute(
                                "disabled"
                            ) or "disabled" in next_button_present.get_attribute(
                                "class", ""
                            ):
                                print(
                                    "Next button is disabled. Reached end.",
                                    file=sys.stderr,
                                )
                                break
                        except TimeoutException:
                            print(
                                f"No 'next' button found on page {page + 1}. Assuming end.",
                                file=sys.stderr,
                            )
                            break

                        if not self.robust_click(next_button_locator, timeout=10):
                            print(
                                "Failed to click next button after retries. Assuming end.",
                                file=sys.stderr,
                            )
                            break

                        results_price_locator = (
                            By.CSS_SELECTOR,
                            ".PropertyPrice_price__VL65t",
                        )
                        WebDriverWait(self.driver, 15).until(
                            EC.presence_of_element_located(results_price_locator)
                        )
                        time.sleep(random.uniform(0.7, 1.5))

                        print(f"Processing page {page + 1}...", file=sys.stderr)
                        html = self.driver.page_source
                        self.parse(html)  # Prints results as they are found

                    except Exception as e:
                        # Store the error, log it, and break pagination
                        script_error = f"Error on page {page + 1}: {str(e)}"
                        print(
                            f"Error navigating to or parsing page {page + 1}: {e}",
                            file=sys.stderr,
                        )
                        traceback.print_exc(file=sys.stderr)
                        break
            else:
                script_error = "Failed during initial search setup."
                print(f"Script Error: {script_error}", file=sys.stderr)
                # Error already printed by search_by_postcode if it sent SSE error

        except WebDriverException as e_wd_main:
            # Catch fatal errors raised from parse/search
            script_error = f"Fatal WebDriver Error: {str(e_wd_main)}"
            print(
                f"Caught Fatal WebDriverException in run: {e_wd_main}", file=sys.stderr
            )
            # Error should have already been sent to SSE by the function that raised it
        except Exception as e_main:
            script_error = f"Unexpected runtime error: {str(e_main)}"
            print(
                f"Scraping run failed with unexpected error: {e_main}", file=sys.stderr
            )
            traceback.print_exc(file=sys.stderr)
            # Send this final error via SSE if not already sent
            print_sse_json({"error": script_error})

        finally:
            run_duration = time.time() - start_time
            print(f"Total run time: {run_duration:.2f} seconds", file=sys.stderr)
            self.close_driver()

            # --- Final SSE Message ---
            if script_error:
                # Error message should have been sent when the error occurred
                print(f"Scraping finished with error: {script_error}", file=sys.stderr)
                # Optionally send a final 'error-complete' status? For now, rely on the error message itself.
                # print_sse_json({"status": "error", "message": script_error}) # Example
            elif self.processed_properties_count == 0:
                # No errors, but also no properties found/processed
                print(
                    "Scraping finished. No properties found or processed.",
                    file=sys.stderr,
                )
                print_sse_json({"status": "no_results"})  # Send specific status
                print_sse_json({"status": "complete"})  # Also send complete signal
            else:
                # No errors and properties were processed
                print(
                    f"Scraping finished successfully. Processed {self.processed_properties_count} properties.",
                    file=sys.stderr,
                )
                print_sse_json({"status": "complete"})  # Send completion signal


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape Rightmove for a given postcode."
    )
    parser.add_argument("--postcode", required=True, help="UK postcode to search for.")
    args = parser.parse_args()

    scraper = RightmoveScraper(postcode=args.postcode)
    scraper.run()
