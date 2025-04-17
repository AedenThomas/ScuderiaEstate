# /server/scrapers/scrape.py
# REVERTED to user's core logic, adapted for SSE

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
    NoSuchWindowException,
    ElementClickInterceptedException,  # Keep relevant exceptions
    ElementNotInteractableException,
)
from bs4 import BeautifulSoup
import json
import time
import random
import re
import argparse  # Use argparse for command line input
import sys
import traceback  # Keep for detailed error logging

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
    # --- __init__ based on user's standalone but with SSE requirements ---
    def __init__(self, postcode="TS178BT"):
        # No self.results needed for SSE
        self.postcode = postcode
        self.search_postcode = postcode[:3]  # Use first 3 characters of postcode
        self.processed_properties_count = 0  # Track count for final SSE message

        print(
            f"Initializing scraper for postcode: {postcode}, using search term: {self.search_postcode}",
            file=sys.stderr,
        )

        chrome_options = Options()
        chrome_options.add_argument("--headless=new")  # Use new headless
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
            self.driver.set_page_load_timeout(45)  # Slightly longer timeout
            print("WebDriver initialized successfully.", file=sys.stderr)
        except WebDriverException as e:
            print_sse_json({"error": f"Failed to initialize WebDriver: {str(e)}"})
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)  # Exit if driver fails
        except Exception as e:
            print_sse_json(
                {"error": f"An unexpected error occurred during driver setup: {str(e)}"}
            )
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)  # Exit on other setup errors

    # --- close_driver (Keep robust version for cleanup) ---
    def close_driver(self):
        if hasattr(self, "driver") and self.driver:
            try:
                print("Closing WebDriver.", file=sys.stderr)
                # Close extra tabs first
                handles = self.driver.window_handles
                for handle in handles[1:]:
                    try:
                        self.driver.switch_to.window(handle)
                        self.driver.close()
                    except (NoSuchWindowException, WebDriverException):
                        pass  # Ignore errors if tab already closed
                # Switch back to main and quit
                if handles:
                    try:
                        self.driver.switch_to.window(handles[0])
                    except (NoSuchWindowException, WebDriverException):
                        pass  # Ignore if main window also gone
                self.driver.quit()
            except WebDriverException as qe:
                if (
                    "invalid session id" in str(qe).lower()
                    or "session deleted" in str(qe).lower()
                ):
                    print(
                        "Warning: WebDriver session already invalid or closed during quit.",
                        file=sys.stderr,
                    )
                else:
                    print(
                        f"Warning: Error closing WebDriver: {str(qe)}", file=sys.stderr
                    )
            except Exception as e:
                print(
                    f"Warning: Unexpected error closing WebDriver: {str(e)}",
                    file=sys.stderr,
                )

    # --- robust_click (Keep for reliable clicks) ---
    def robust_click(self, element_locator, timeout=10):
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.element_to_be_clickable(element_locator)
            )
            # Try JS click first as it's often more reliable with overlays
            try:
                self.driver.execute_script("arguments[0].click();", element)
                return True
            except Exception:  # Fallback to normal click
                element.click()
                return True
        except ElementClickInterceptedException:
            # If intercepted, try scrolling and JS click again
            try:
                element = WebDriverWait(self.driver, timeout).until(
                    EC.presence_of_element_located(
                        element_locator
                    )  # Find it even if not clickable yet
                )
                self.driver.execute_script(
                    "arguments[0].scrollIntoView({block: 'center'});", element
                )
                time.sleep(0.5)  # Brief pause after scroll
                element_clickable = WebDriverWait(
                    self.driver, 5
                ).until(  # Wait again for clickability
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

    # --- search_by_postcode (Using user's core logic with robust click/SSE error) ---
    def search_by_postcode(self):
        print(
            f"Navigating to Rightmove homepage and searching for postcode: {self.search_postcode}",
            file=sys.stderr,
        )
        try:
            self.driver.get("https://www.rightmove.co.uk/")

            # Wait for search box
            search_box_locator = (
                By.CSS_SELECTOR,
                "input.dsrm_inputText.ta_userInput#ta_searchInput",
            )
            try:
                WebDriverWait(self.driver, 15).until(
                    EC.presence_of_element_located(search_box_locator)
                )
            except TimeoutException:
                raise Exception(
                    "Homepage did not load correctly (search box not found)."
                )

            # Cookie Handling (Optimized check, robust click)
            print("Checking for cookie banner...", file=sys.stderr)
            accept_locator_xpath = (
                '//button[contains(text(), "Accept") or contains(text(), "ACCEPT ALL")]'
            )
            try:
                accept_buttons = self.driver.find_elements(
                    By.XPATH, accept_locator_xpath
                )
                if (
                    accept_buttons
                    and accept_buttons[0].is_displayed()
                    and accept_buttons[0].is_enabled()
                ):
                    print(
                        "Cookie banner found. Attempting to click...", file=sys.stderr
                    )
                    # Use robust_click for the cookie button
                    if self.robust_click((By.XPATH, accept_locator_xpath), timeout=5):
                        print("Clicked cookie accept button.", file=sys.stderr)
                        time.sleep(random.uniform(0.2, 0.4))
                    else:
                        print(
                            "Warning: Failed to click cookie button.", file=sys.stderr
                        )
                else:
                    print(
                        "Cookie banner button not found or not interactable.",
                        file=sys.stderr,
                    )
            except Exception as cookie_e:
                print(
                    f"Warning: Error during cookie banner check: {cookie_e}",
                    file=sys.stderr,
                )

            # Find and interact with search box
            search_box = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable(search_box_locator)
            )
            search_box.clear()
            search_box.send_keys(self.search_postcode)
            print(f"Entered postcode: {self.search_postcode}", file=sys.stderr)

            # Autocomplete (Use robust click)
            autocomplete_first_item_locator = (
                By.CSS_SELECTOR,
                "ul.ta_searchResults li.ta_searchResultRow",
            )
            try:
                WebDriverWait(self.driver, 7).until(
                    EC.visibility_of_element_located(
                        (By.CSS_SELECTOR, "ul.ta_searchResults")
                    )
                )
                if not self.robust_click(autocomplete_first_item_locator, timeout=7):
                    raise Exception("Failed to click autocomplete result.")
                print("Clicked autocomplete result.", file=sys.stderr)
            except TimeoutException:
                print(
                    "Warning: Autocomplete suggestions did not appear or timed out. Proceeding...",
                    file=sys.stderr,
                )
                # Don't raise exception, try clicking search directly later

            # Click "For sale" button (Use robust click)
            for_sale_locator = (
                By.CSS_SELECTOR,
                "button.dsrm_button[data-testid='forSaleCta']",
            )
            if not self.robust_click(for_sale_locator, timeout=10):
                raise Exception("Failed to click 'For Sale' button.")
            print("Clicked 'For Sale' button.", file=sys.stderr)

            # Click "Search properties" button (Use robust click)
            search_button_locator = (By.CSS_SELECTOR, "button.dsrm_button#submit")
            if not self.robust_click(search_button_locator, timeout=10):
                raise Exception("Failed to click 'Search Properties' button.")
            print("Clicked 'Search Properties' button.", file=sys.stderr)

            # Wait for search results page load indicator (User's selector)
            results_price_locator = (
                By.CSS_SELECTOR,
                ".PropertyPrice_price__VL65t",
            )  # USER'S SELECTOR
            WebDriverWait(self.driver, 15).until(
                EC.presence_of_element_located(results_price_locator)
            )

            print("Successfully navigated to search results page", file=sys.stderr)
            return True

        except Exception as e:
            error_msg = f"Error during search navigation: {type(e).__name__} - {e}"
            print(error_msg, file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            print_sse_json({"error": error_msg})  # Send error via SSE
            return False

    # --- fetch method removed (not needed for SSE approach) ---

    def parse(self, html):
        print("Parsing HTML...", file=sys.stderr)
        soup = BeautifulSoup(html, "lxml")

        # --- Use user's find_all logic ---
        prices = soup.find_all("div", class_="PropertyPrice_price__VL65t")
        addresses = soup.find_all("address", class_="PropertyAddress_address__LYRPq")
        descriptions = soup.find_all("p", class_="PropertyCardSummary_summary__oIv57")
        bedrooms = soup.find_all(
            "span", class_="PropertyInformation_bedroomsCount___2b5R"
        )
        # *** Use user's potentially fragile way of finding bathrooms ***
        # REMOVE the old bathrooms_elements finding based on aria-label
        # bathroom_element = bathrooms_elements[i] # REMOVE THIS LINE
        links = soup.select("a.propertyCard-link")
        # --- End user's find_all logic ---

        # Determine the number of properties based on the shortest list (as zip would do)
        num_properties = min(
            len(prices),
            len(addresses),
            len(descriptions),
            len(bedrooms),
            len(links),
        )
        print(
            f"Found elements suggesting {num_properties} properties (based on shortest list).",
            file=sys.stderr,
        )

        page_processed_count = 0
        # Iterate up to the number determined above
        for i in range(num_properties):
            # --- Extract basic info (keep existing) ---
            # Get elements for this iteration using index
            price_element = prices[i]
            address_element = addresses[i]
            description_element = descriptions[i]
            bedroom_element = bedrooms[i]
            link_element = links[i]

            # Prepare data dictionary for SSE output
            property_data = {
                "id": f"rm_temp_{i}",
                "price": "N/A",
                "address": "N/A",
                "description": "N/A",
                "bedrooms": "N/A",
                "bathrooms": "N/A",  # Default
                "square_footage": "N/A",
                "property_type": "N/A",
                "latitude": "N/A",
                "longitude": "N/A",
                "detail_url": "N/A",
                "source": "Rightmove",
                                "image_urls": [], # Initialize image URLs list
            }
            is_fatal_error = False
            detail_fetch_error = None

            try:
                # --- Extract basic info (keep existing) ---
                property_data["price"] = price_element.get_text(strip=True)
                property_data["address"] = address_element.get_text(strip=True)
                property_data["description"] = description_element.get_text(strip=True)

                # Extract bedrooms (keep existing)
                bedroom_text = bedroom_element.get_text(strip=True)
                match_bed = re.search(r"\d+", bedroom_text)
                if match_bed:
                    property_data["bedrooms"] = match_bed.group(0)

                # --- REMOVE OLD Bathroom extraction ---
                # aria_label = bathroom_element.get("aria-label", "")
                # ... (remove the if/else block related to aria_label) ...

                # --- Link and ID (Keep existing) ---
                href = link_element.get("href")
                if href and href.startswith("/properties/"):
                    property_data["detail_url"] = "https://www.rightmove.co.uk" + href
                    match_id = re.search(r"/properties/(\d+)", href)
                    if match_id:
                        property_data["id"] = f"rm_{match_id.group(1)}"
                else:
                    print(
                        f" Skipping detail fetch for card index {i}: Invalid link {href}",
                        file=sys.stderr,
                    )
                    continue  # Skip this property if link is bad

                # --- Fetch details sequentially ---
                original_window = self.driver.current_window_handle
                new_window = None

                try:
                    if (
                        not property_data["detail_url"]
                        or property_data["detail_url"] == "N/A"
                    ):
                        raise ValueError("Detail URL is invalid or missing.")

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

                    # Wait for info reel section (more specific than body)
                    info_reel_locator = (By.ID, "info-reel")
                    WebDriverWait(self.driver, 15).until(
                        EC.presence_of_element_located(info_reel_locator)
                    )
                    time.sleep(random.uniform(0.5, 1.0))

                    detail_page_indicator = (By.CSS_SELECTOR, "div[data-testid='photo-collage'], dl[data-test='infoReel']")
                    WebDriverWait(self.driver, 15).until(
                        EC.presence_of_element_located(detail_page_indicator)
                    )
                    time.sleep(random.uniform(0.5, 1.0))

                    # --- SCRAPE IMAGE URLs ---
                    try:
                       # Target the main photo carousel container
                       photo_carousel_div = self.driver.find_element(By.CSS_SELECTOR, "div.yyidGoi1pN3HEaahsw3bi")
                       # Find image elements within the carousel links
                       image_elements = photo_carousel_div.find_elements(By.CSS_SELECTOR, "a._2zqynvtIxFMCq18pu-g8d_ img")
                       # OR find meta tags if img tags are unreliable
                       # meta_elements = photo_carousel_div.find_elements(By.CSS_SELECTOR, "a._2zqynvtIxFMCq18pu-g8d_ meta[itemprop='contentUrl']")

                       urls = []
                       for img_element in image_elements:
                           src = img_element.get_attribute('src')
                           if src and src.startswith('https://media.rightmove.co.uk'):
                               urls.append(src)
                       # Alternative using meta tags:
                       # for meta_element in meta_elements:
                       #     content_url = meta_element.get_attribute('content')
                       #     if content_url:
                       #         urls.append(content_url)

                       property_data["image_urls"] = list(dict.fromkeys(urls)) # Remove duplicates if any
                       if not urls:
                           print(f"    No image URLs found using selector for {property_data['id']}.", file=sys.stderr)

                    except NoSuchElementException:
                        print(f"    Photo carousel container not found for {property_data['id']}.", file=sys.stderr)
                    except Exception as e_img:
                        print(f"    Error extracting image URLs: {e_img}", file=sys.stderr)



                    # --- NEW: Extract Bathrooms & Property Type from Info Reel ---
                    try:
                        info_reel = self.driver.find_element(*info_reel_locator)
                        # Find all dt/dd pairs within the info reel dl
                        items = info_reel.find_elements(
                            By.XPATH,
                            ".//div[contains(@class, '_3gIoc-NFXILAOZEaEjJi1n')]",
                        )
                        for item in items:
                            try:
                                label_element = item.find_element(By.TAG_NAME, "dt")
                                value_element = item.find_element(By.TAG_NAME, "dd")
                                label_text = label_element.text.strip().upper()
                                value_text = value_element.text.strip()

                                

                                if "BATHROOMS" in label_text:
                                    match_bath = re.search(r"\d+", value_text)
                                    if match_bath:
                                        property_data["bathrooms"] = match_bath.group(0)
                                elif "PROPERTY TYPE" in label_text:
                                    property_data["property_type"] = value_text
                                elif (
                                    "SIZE" in label_text
                                    and "ask agent" not in value_text.lower()
                                ):
                                    # Attempt to extract size if not 'Ask agent'
                                    sqft_text_detail = value_text.replace(",", "")
                                    match_sqft_detail = re.search(
                                        r"([\d.,]+)\s*sq\s*ft",
                                        sqft_text_detail,
                                        re.IGNORECASE,
                                    )
                                    match_sqm_detail = re.search(
                                        r"([\d.,]+)\s*(?:m²|sqm|sq\.?m)",
                                        sqft_text_detail,
                                        re.IGNORECASE,
                                    )

                                    if match_sqm_detail:
                                        try:
                                            sqm_val = float(match_sqm_detail.group(1))
                                            sqft_val = round(sqm_val * 10.764)
                                            property_data["square_footage"] = (
                                                f"{sqft_val} sq ft"
                                            )
                                        except ValueError:
                                            property_data["square_footage"] = (
                                                value_text  # Fallback
                                            )
                                    elif match_sqft_detail:
                                        property_data["square_footage"] = (
                                            f"{match_sqft_detail.group(1)} sq ft"
                                        )
                                    else:
                                        property_data["square_footage"] = (
                                            value_text  # Fallback if pattern fails
                                        )

                            except NoSuchElementException:
                                # print(f"    Could not find label/value pair in an info reel item.", file=sys.stderr) # Less verbose
                                continue
                            except Exception as e_item:
                                print(
                                    f"    Error processing info reel item: {e_item}",
                                    file=sys.stderr,
                                )

                    except NoSuchElementException:
                        print(
                            f"    Info reel (id='info-reel') not found for {property_data['id']}.",
                            file=sys.stderr,
                        )
                    except Exception as e_info_reel:
                        print(
                            f"    Error extracting from info reel: {e_info_reel}",
                            file=sys.stderr,
                        )

                    # --- SqFt Extraction (Fallback if not found in info reel) ---
                    if property_data["square_footage"] == "N/A":
                        try:
                            # Try the old XPATH as a fallback
                            sqft_element = self.driver.find_element(
                                By.XPATH, "//p[contains(text(), 'sq ft')]"
                            )
                            sqft_text = sqft_element.text.strip()
                            match_sqft = re.search(
                                r"([\d,]+)\s*sq\s*ft", sqft_text, re.IGNORECASE
                            )
                            if match_sqft:
                                property_data["square_footage"] = (
                                    match_sqft.group(1).replace(",", "") + " sq ft"
                                )
                            else:
                                property_data["square_footage"] = sqft_text
                        except NoSuchElementException:
                            try:
                                sqm_element = self.driver.find_element(
                                    By.XPATH,
                                    "//p[contains(text(), 'm²')] | //p[contains(text(), 'sqm')] | //p[contains(text(), 'sq.m')]",
                                )
                                sqm_text = sqm_element.text.strip()
                                match_sqm = re.search(
                                    r"([\d.,]+)\s*(?:m²|sqm|sq\.?m)",
                                    sqm_text,
                                    re.IGNORECASE,
                                )
                                if match_sqm:
                                    try:
                                        sqm_val = float(
                                            match_sqm.group(1).replace(",", "")
                                        )
                                        sqft_val = round(sqm_val * 10.764)
                                        property_data["square_footage"] = (
                                            f"{sqft_val} sq ft"
                                        )
                                    except ValueError:
                                        property_data["square_footage"] = sqm_text
                                else:
                                    property_data["square_footage"] = sqm_text
                            except NoSuchElementException:
                                print(
                                    f"    Fallback SqFt/SqM element also not found for {property_data['id']}.",
                                    file=sys.stderr,
                                )
                        except Exception as e_sqft_fallback:
                            print(
                                f"    Error during fallback sqft extraction: {e_sqft_fallback}",
                                file=sys.stderr,
                            )

                    # --- Property Type Extraction (Fallback if not found in info reel) ---
                    if property_data["property_type"] == "N/A":
                        try:
                            # Try old CSS selector as fallback
                            prop_elem = self.driver.find_element(
                                By.CSS_SELECTOR, "p._1hV1kqpVceE9m-QrX_hWDN"
                            )
                            property_data["property_type"] = prop_elem.text.strip()
                        except NoSuchElementException:
                            # Try the p-tag search as final fallback (keep existing logic)
                            try:
                                print(
                                    f"    Property type selector failed for {property_data['id']}, trying p-tag fallback...",
                                    file=sys.stderr,
                                )
                                all_p_elements = self.driver.find_elements(
                                    By.TAG_NAME, "p"
                                )
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
                                found_type = False
                                for p_elem in all_p_elements:
                                    try:
                                        text = p_elem.text.strip().lower()
                                        if 0 < len(text) < 100:
                                            for ktype in known_types:
                                                if re.search(
                                                    r"\b" + re.escape(ktype) + r"\b", text
                                                ):
                                                    property_data["property_type"] = (
                                                        ktype.capitalize()
                                                    )
                                                    found_type = True
                                                    break
                                    except Exception:
                                        continue
                                    if found_type:
                                        break
                                if not found_type:
                                    print(
                                        f"    Property type p-tag fallback failed for {property_data['id']}.",
                                        file=sys.stderr,
                                    )
                            except Exception as e_prop_fallback:
                                print(
                                    f"    Error during property type p-tag fallback: {e_prop_fallback}",
                                    file=sys.stderr,
                                )
                        except Exception as e_prop_fallback:
                            print(
                                f"    Error during property type CSS fallback: {e_prop_fallback}",
                                file=sys.stderr,
                            )

                    # --- Coordinate Extraction (Keep existing) ---
                    try:
                        page_source = self.driver.page_source
                        match = re.search(
                            r'"latitude":([0-9.]+),"longitude":(-?[0-9.]+)', page_source
                        )
                        if match:
                            property_data["latitude"] = match.group(1)
                            property_data["longitude"] = match.group(2)
                        else:
                            print(
                                f"    Coordinates regex pattern not found for {property_data['id']}.",
                                file=sys.stderr,
                            )
                    except Exception as e_coords:
                        print(
                            f"    Error extracting coordinates: {e_coords}",
                            file=sys.stderr,
                        )

                # ... (keep existing finally block for window handling) ...
                finally:
                    try:
                        current_handles_before_close = self.driver.window_handles
                        if new_window and new_window in current_handles_before_close:
                            self.driver.close()
                        current_handles_after_close = self.driver.window_handles
                        if original_window in current_handles_after_close:
                            self.driver.switch_to.window(original_window)
                        elif current_handles_after_close:
                            self.driver.switch_to.window(current_handles_after_close[0])
                    except (NoSuchWindowException, WebDriverException) as e_cleanup:
                        print(
                            f"   Non-critical error during window cleanup for {property_data['id']}: {e_cleanup}",
                            file=sys.stderr,
                        )
                        if (
                            "invalid session id" in str(e_cleanup).lower()
                            or "session deleted" in str(e_cleanup).lower()
                        ):
                            print(
                                "!!! FATAL WebDriverException during cleanup. Aborting script.",
                                file=sys.stderr,
                            )
                            is_fatal_error = True

                # --- Print the processed property data to stdout via SSE ---
                if detail_fetch_error: property_data["fetch_error"] = detail_fetch_error
                print_sse_json(property_data)
                page_processed_count += 1
                self.processed_properties_count += 1

                if is_fatal_error: raise WebDriverException("Session lost")


            except WebDriverException as e_outer_wd:
                print(
                    f"!! FATAL WebDriverException processing card index {i}: {e_outer_wd}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
                print_sse_json({"error": f"Fatal WebDriverException: {e_outer_wd}"})
                raise
            except Exception as e_outer:
                print(
                    f"!! Major error processing property card index {i}: {e_outer}",
                    file=sys.stderr,
                )
                traceback.print_exc(file=sys.stderr)
                # print_sse_json({"error": f"Failed processing card {i}: {e_outer}", "card_index": i}) # Optional SSE error per card

        print(
            f"Finished parsing page. Processed {page_processed_count}/{num_properties} properties found.",
            file=sys.stderr,
        )

    # --- run method using user's logic + SSE ---
    def run(self):
        print("Starting scraper run...", file=sys.stderr)
        script_error = None
        start_time = time.time()
        try:
            # Navigate to Rightmove and search (will send SSE error if it fails)
            if self.search_by_postcode():
                # Process the first page
                print("\nProcessing page 1...", file=sys.stderr)
                time.sleep(
                    random.uniform(0.5, 1.0)
                )  # Small pause after search results load
                html = self.driver.page_source
                self.parse(html)  # This now prints results via SSE

                # Process additional pages (user's logic: max 1 extra page)
                max_pages = (
                    1  # Limit to 1 extra page as per standalone logic (range(1, 2))
                )
                for page in range(1, max_pages + 1):  # Correct range to check page 2
                    print(f"\nChecking for page {page + 1}...", file=sys.stderr)
                    try:
                        # Try to find and click the next page button (user's selector)
                        next_button_locator = (
                            By.CSS_SELECTOR,
                            "button.pagination-button.pagination-direction.pagination-direction--next",
                        )
                        try:
                            # Check if clickable and not disabled
                            next_button = WebDriverWait(self.driver, 7).until(
                                EC.element_to_be_clickable(next_button_locator)
                            )
                            if (
                                next_button.get_attribute("disabled")
                                or not next_button.is_enabled()
                            ):
                                print(
                                    "Next button is disabled. Reached end.",
                                    file=sys.stderr,
                                )
                                break
                        except TimeoutException:
                            print(
                                f"No enabled 'next' button found on page {page}. Assuming end.",
                                file=sys.stderr,
                            )
                            break  # Exit loop if no next button

                        # Use robust click for pagination
                        if not self.robust_click(next_button_locator, timeout=10):
                            print(
                                "Failed to click next button. Assuming end.",
                                file=sys.stderr,
                            )
                            break

                        # Wait for the page to load (using user's price selector as indicator)
                        results_price_locator = (
                            By.CSS_SELECTOR,
                            ".PropertyPrice_price__VL65t",
                        )
                        WebDriverWait(self.driver, 15).until(
                            EC.presence_of_element_located(results_price_locator)
                        )
                        time.sleep(random.uniform(1.0, 2.0))  # Wait after click

                        print(f"Processing page {page + 1}...", file=sys.stderr)
                        html = self.driver.page_source
                        self.parse(html)  # Parse and print results for the new page

                    except (
                        WebDriverException
                    ) as e_wd_page:  # Catch fatal errors during pagination
                        script_error = f"Fatal WebDriver Error on page {page + 1}: {str(e_wd_page)}"
                        print(
                            f"!! FATAL WebDriverException during pagination: {e_wd_page}",
                            file=sys.stderr,
                        )
                        traceback.print_exc(file=sys.stderr)
                        print_sse_json({"error": script_error})
                        raise  # Stop the run
                    except Exception as e:
                        script_error = f"Error on page {page + 1}: {str(e)}"
                        print(
                            f"Error navigating to or parsing page {page + 1}: {e}",
                            file=sys.stderr,
                        )
                        traceback.print_exc(file=sys.stderr)
                        # Send non-fatal pagination error? Optional.
                        # print_sse_json({"error": script_error})
                        break  # Stop pagination on non-fatal errors too

            else:
                # search_by_postcode already printed error and sent SSE message
                script_error = "Failed during initial search setup."

        except (
            WebDriverException
        ) as e_wd_main:  # Catch fatal errors raised from parse/search
            script_error = f"Fatal WebDriver Error: {str(e_wd_main)}"
            print(
                f"Caught Fatal WebDriverException in run: {e_wd_main}", file=sys.stderr
            )
            # Error should have already been sent to SSE
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
            if script_error and "Fatal" not in script_error:
                # If a non-fatal script error stopped pagination etc., ensure an error was sent
                # It might have been sent already, but send again if unsure.
                # print_sse_json({"error": script_error}) # Uncomment if needed
                print(f"Scraping finished with error: {script_error}", file=sys.stderr)
            elif self.processed_properties_count == 0 and not script_error:
                # No errors, but also no properties found/processed
                print(
                    "Scraping finished. No properties found or processed.",
                    file=sys.stderr,
                )
                print_sse_json({"status": "no_results"})
                print_sse_json({"status": "complete"})  # Also send complete signal
            elif not script_error:
                # No errors and properties were processed
                print(
                    f"Scraping finished successfully. Processed {self.processed_properties_count} properties.",
                    file=sys.stderr,
                )
                print_sse_json({"status": "complete"})  # Send completion signal
            # If script_error contained "Fatal", the error was already sent by the raising function.
            elif not script_error:
                # No errors and properties were processed
                print(
                    f"Scraping finished successfully. Processed {self.processed_properties_count} properties.",
                    file=sys.stderr,
                )
                print_sse_json({"status": "complete"})  # Send completion signal
            # If script_error contained "Fatal", the error was already sent by the raising function.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape Rightmove for a given postcode."
    )
    parser.add_argument("--postcode", required=True, help="UK postcode to search for.")
    args = parser.parse_args()

    scraper = RightmoveScraper(postcode=args.postcode)
    scraper.run()
