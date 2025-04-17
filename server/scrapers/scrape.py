# server/scrapers/scrape.py

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
    ElementClickInterceptedException,
    ElementNotInteractableException,
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
    # --- __init__ based on user's standalone but with SSE requirements ---
    def __init__(self, postcode="TS178BT"):
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
            # Attempt to install or use cached driver
            try:
                service = Service(ChromeDriverManager().install())
            except Exception as driver_manager_err:
                 print(f"Warning: ChromeDriverManager failed ({driver_manager_err}). Trying default service.", file=sys.stderr)
                 # Fallback to letting Selenium find the driver if install fails
                 service = Service()

            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.driver.set_page_load_timeout(45) # Slightly longer timeout
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
            sys.exit(1) # Exit on other setup errors


    # --- close_driver ---
    def close_driver(self):
        if hasattr(self, "driver") and self.driver:
            try:
                print("Closing WebDriver.", file=sys.stderr)
                handles = self.driver.window_handles
                for handle in handles[1:]:
                    try:
                        self.driver.switch_to.window(handle)
                        self.driver.close()
                    except (NoSuchWindowException, WebDriverException): pass
                if handles:
                    try: self.driver.switch_to.window(handles[0])
                    except (NoSuchWindowException, WebDriverException): pass
                self.driver.quit()
                self.driver = None # Ensure driver is marked as closed
            except WebDriverException as qe:
                if "invalid session id" in str(qe).lower() or "session deleted" in str(qe).lower():
                    print("Warning: WebDriver session already invalid/closed.", file=sys.stderr)
                else:
                    print(f"Warning: Error closing WebDriver: {str(qe)}", file=sys.stderr)
                self.driver = None
            except Exception as e:
                print(f"Warning: Unexpected error closing WebDriver: {str(e)}", file=sys.stderr)
                self.driver = None

    # --- robust_click ---
    def robust_click(self, element_locator, timeout=10):
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.element_to_be_clickable(element_locator)
            )
            try: # Try JS click first
                self.driver.execute_script("arguments[0].click();", element)
                return True
            except Exception: # Fallback to normal click
                element.click()
                return True
        except ElementClickInterceptedException:
            try: # If intercepted, scroll and try JS click again
                element = WebDriverWait(self.driver, timeout).until(EC.presence_of_element_located(element_locator))
                self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
                time.sleep(0.5)
                element_clickable = WebDriverWait(self.driver, 5).until(EC.element_to_be_clickable(element_locator))
                self.driver.execute_script("arguments[0].click();", element_clickable)
                return True
            except Exception as e:
                print(f"  Click failed after scroll for {element_locator}: {e}", file=sys.stderr)
                return False
        except TimeoutException:
            print(f"  Timeout waiting for {element_locator} to be clickable.", file=sys.stderr)
            return False
        except Exception as e:
            print(f"  Error clicking {element_locator}: {e}", file=sys.stderr)
            return False

    # --- search_by_postcode ---
    def search_by_postcode(self):
        print(f"Navigating to Rightmove and searching for: {self.search_postcode}", file=sys.stderr)
        try:
            self.driver.get("https://www.rightmove.co.uk/")
            search_box_locator = (By.CSS_SELECTOR, "input.dsrm_inputText.ta_userInput#ta_searchInput")
            try: WebDriverWait(self.driver, 15).until(EC.presence_of_element_located(search_box_locator))
            except TimeoutException: raise Exception("Homepage did not load (search box not found).")

            # Cookie Handling
            print("Checking for cookie banner...", file=sys.stderr)
            accept_locator_xpath = '//button[contains(text(), "Accept") or contains(text(), "ACCEPT ALL")]'
            try:
                accept_buttons = self.driver.find_elements(By.XPATH, accept_locator_xpath)
                if accept_buttons and accept_buttons[0].is_displayed() and accept_buttons[0].is_enabled():
                    print("Cookie banner found. Clicking...", file=sys.stderr)
                    if self.robust_click((By.XPATH, accept_locator_xpath), timeout=5):
                        print("Clicked cookie accept button.", file=sys.stderr)
                        time.sleep(random.uniform(0.2, 0.4))
                    else: print("Warning: Failed to click cookie button.", file=sys.stderr)
                else: print("Cookie banner not found or interactable.", file=sys.stderr)
            except Exception as cookie_e: print(f"Warning: Error during cookie check: {cookie_e}", file=sys.stderr)

            # Interact with search box
            search_box = WebDriverWait(self.driver, 10).until(EC.element_to_be_clickable(search_box_locator))
            search_box.clear()
            search_box.send_keys(self.search_postcode)
            print(f"Entered postcode: {self.search_postcode}", file=sys.stderr)

            # Autocomplete
            autocomplete_first_item_locator = (By.CSS_SELECTOR, "ul.ta_searchResults li.ta_searchResultRow")
            try:
                WebDriverWait(self.driver, 7).until(EC.visibility_of_element_located((By.CSS_SELECTOR, "ul.ta_searchResults")))
                if not self.robust_click(autocomplete_first_item_locator, timeout=7): raise Exception("Failed to click autocomplete.")
                print("Clicked autocomplete result.", file=sys.stderr)
            except TimeoutException: print("Warning: Autocomplete timed out. Proceeding...", file=sys.stderr)

            # Click "For sale"
            for_sale_locator = (By.CSS_SELECTOR, "button.dsrm_button[data-testid='forSaleCta']")
            if not self.robust_click(for_sale_locator, timeout=10): raise Exception("Failed to click 'For Sale'.")
            print("Clicked 'For Sale'.", file=sys.stderr)

            # Click "Search properties"
            search_button_locator = (By.CSS_SELECTOR, "button.dsrm_button#submit")
            if not self.robust_click(search_button_locator, timeout=10): raise Exception("Failed to click 'Search Properties'.")
            print("Clicked 'Search Properties'.", file=sys.stderr)

            # Wait for results page indicator
            results_price_locator = (By.CSS_SELECTOR, ".PropertyPrice_price__VL65t")
            WebDriverWait(self.driver, 15).until(EC.presence_of_element_located(results_price_locator))
            print("Successfully navigated to search results page.", file=sys.stderr)
            return True

        except Exception as e:
            error_msg = f"Error during search navigation: {type(e).__name__} - {e}"
            print(error_msg, file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            print_sse_json({"error": error_msg})
            return False


    # --- parse method ---
    def parse(self, html):
        print("Parsing HTML...", file=sys.stderr)
        soup = BeautifulSoup(html, "lxml")

        prices = soup.find_all("div", class_="PropertyPrice_price__VL65t")
        addresses = soup.find_all("address", class_="PropertyAddress_address__LYRPq")
        descriptions = soup.find_all("p", class_="PropertyCardSummary_summary__oIv57")
        bedrooms = soup.find_all("span", class_="PropertyInformation_bedroomsCount___2b5R")
        # Bathrooms are scraped from detail page now
        links = soup.select("a.propertyCard-link")

        # Determine num properties based on shortest required list (excluding bathrooms)
        num_properties = min(len(prices), len(addresses), len(descriptions), len(bedrooms), len(links))
        print(f"Found elements suggesting {num_properties} properties (based on price/address/desc/beds/links).", file=sys.stderr)

        page_processed_count = 0
        for i in range(num_properties):
            price_element = prices[i]
            address_element = addresses[i]
            description_element = descriptions[i]
            bedroom_element = bedrooms[i]
            link_element = links[i]

            property_data = {
                "id": f"rm_temp_{i}", "price": "N/A", "address": "N/A", "description": "N/A",
                "bedrooms": "N/A", "bathrooms": "N/A", "square_footage": "N/A", "property_type": "N/A",
                "latitude": "N/A", "longitude": "N/A", "detail_url": "N/A", "source": "Rightmove",
                "image_urls": [], # Initialize image URLs list
            }
            is_fatal_error = False
            detail_fetch_error = None

            try:
                # --- Extract basic info ---
                property_data["price"] = price_element.get_text(strip=True)
                property_data["address"] = address_element.get_text(strip=True)
                property_data["description"] = description_element.get_text(strip=True)
                bedroom_text = bedroom_element.get_text(strip=True)
                match_bed = re.search(r"\d+", bedroom_text)
                if match_bed: property_data["bedrooms"] = match_bed.group(0)

                # --- Link and ID ---
                href = link_element.get("href")
                if href and href.startswith("/properties/"):
                    property_data["detail_url"] = "https://www.rightmove.co.uk" + href
                    match_id = re.search(r"/properties/(\d+)", href)
                    if match_id: property_data["id"] = f"rm_{match_id.group(1)}"
                else:
                    print(f" Skipping detail fetch for card index {i}: Invalid link {href}", file=sys.stderr)
                    continue

                # --- Fetch details sequentially ---
                original_window = self.driver.current_window_handle
                new_window = None

                try:
                    if not property_data["detail_url"] or property_data["detail_url"] == "N/A":
                        raise ValueError("Detail URL is invalid or missing.")

                    self.driver.execute_script("window.open(arguments[0]);", property_data["detail_url"])
                    WebDriverWait(self.driver, 10).until(EC.number_of_windows_to_be(len(self.driver.window_handles)))
                    new_window_handle = [w for w in self.driver.window_handles if w != original_window]
                    if not new_window_handle: raise Exception("New window did not open.")
                    new_window = new_window_handle[0]
                    self.driver.switch_to.window(new_window)

                    # Wait for key element on detail page
                    detail_page_indicator = (By.CSS_SELECTOR, "div[data-testid='photo-collage'], dl[data-test='infoReel']")
                    WebDriverWait(self.driver, 15).until(EC.presence_of_element_located(detail_page_indicator))
                    time.sleep(random.uniform(0.5, 1.0)) # Pause for content loading

                    # --- Extract from Info Reel (Bathrooms, Property Type, Size) ---
                    try:
                        info_reel = self.driver.find_element(By.CSS_SELECTOR, "dl[data-test='infoReel']") # Use correct selector
                        items = info_reel.find_elements(By.XPATH, ".//div[contains(@class, '_3gIoc-NFXILAOZEaEjJi1n')]")
                        for item in items:
                            try:
                                label_element = item.find_element(By.TAG_NAME, "dt")
                                value_element = item.find_element(By.TAG_NAME, "dd")
                                label_text = label_element.text.strip().upper()
                                value_text = value_element.text.strip()

                                if "BATHROOMS" in label_text:
                                    match_bath = re.search(r"\d+", value_text)
                                    if match_bath: property_data["bathrooms"] = match_bath.group(0)
                                elif "PROPERTY TYPE" in label_text:
                                    property_data["property_type"] = value_text
                                elif "SIZE" in label_text and "ask agent" not in value_text.lower():
                                     sqft_text_detail = value_text.replace(",", "")
                                     match_sqft_detail = re.search(r"([\d.,]+)\s*sq\s*ft", sqft_text_detail, re.IGNORECASE)
                                     match_sqm_detail = re.search(r"([\d.,]+)\s*(?:m²|sqm|sq\.?m)", sqft_text_detail, re.IGNORECASE)
                                     if match_sqm_detail:
                                         try: sqm_val=float(match_sqm_detail.group(1)); sqft_val=round(sqm_val*10.764); property_data["square_footage"]=f"{sqft_val} sq ft"
                                         except ValueError: property_data["square_footage"] = value_text
                                     elif match_sqft_detail: property_data["square_footage"] = f"{match_sqft_detail.group(1)} sq ft"
                                     else: property_data["square_footage"] = value_text
                            except Exception as e_item: print(f"    Error processing info reel item: {e_item}", file=sys.stderr)
                    except NoSuchElementException: print(f"    Info reel not found for {property_data['id']}.", file=sys.stderr)
                    except Exception as e_info_reel: print(f"    Error extracting from info reel: {e_info_reel}", file=sys.stderr)

                     # --- SCRAPE IMAGE URLs ---
                    try:
                       photo_carousel_div = self.driver.find_element(By.CSS_SELECTOR, "div.yyidGoi1pN3HEaahsw3bi") # Main carousel div
                       image_elements = photo_carousel_div.find_elements(By.CSS_SELECTOR, "a img") # Find img tags within links
                       urls = []
                       for img_element in image_elements:
                           src = img_element.get_attribute('src')
                           if src and src.startswith('https://media.rightmove.co.uk'): urls.append(src)
                       property_data["image_urls"] = list(dict.fromkeys(urls)) # Remove duplicates
                       if not urls: print(f"    No image URLs found for {property_data['id']}.", file=sys.stderr)
                    except NoSuchElementException: print(f"    Photo carousel container not found for {property_data['id']}.", file=sys.stderr)
                    except Exception as e_img: print(f"    Error extracting image URLs: {e_img}", file=sys.stderr)


                    # --- Fallback SqFt Extraction ---
                    if property_data["square_footage"] == "N/A":
                        try: # Try old XPATH
                            sqft_el = self.driver.find_element(By.XPATH, "//p[contains(text(), 'sq ft')]")
                            sqft_txt = sqft_el.text.strip(); match_sqft = re.search(r"([\d,]+)\s*sq\s*ft", sqft_txt, re.I)
                            if match_sqft: property_data["square_footage"] = match_sqft.group(1).replace(",", "") + " sq ft"
                            else: property_data["square_footage"] = sqft_txt
                        except NoSuchElementException:
                            try: # Try SqM XPATH
                                sqm_el = self.driver.find_element(By.XPATH, "//p[contains(text(), 'm²')] | //p[contains(text(), 'sqm')] | //p[contains(text(), 'sq.m')]")
                                sqm_txt = sqm_el.text.strip(); match_sqm = re.search(r"([\d.,]+)\s*(?:m²|sqm|sq\.?m)", sqm_txt, re.I)
                                if match_sqm:
                                    try: sqm_v=float(match_sqm.group(1).replace(",","")); sqft_v=round(sqm_v*10.764); property_data["square_footage"]=f"{sqft_v} sq ft"
                                    except ValueError: property_data["square_footage"] = sqm_txt
                                else: property_data["square_footage"] = sqm_txt
                            except NoSuchElementException: print(f"    Fallback SqFt/SqM also not found for {property_data['id']}.", file=sys.stderr)
                        except Exception as e_sqft_fb: print(f"    Error during fallback sqft: {e_sqft_fb}", file=sys.stderr)

                    # --- Fallback Property Type Extraction ---
                    if property_data["property_type"] == "N/A":
                        try: # Try old CSS selector
                             prop_el = self.driver.find_element(By.CSS_SELECTOR, "p._1hV1kqpVceE9m-QrX_hWDN")
                             property_data["property_type"] = prop_el.text.strip()
                        except NoSuchElementException:
                            try: # Final fallback: search p tags
                                print(f"    Property type selector failed for {property_data['id']}, trying p-tag fallback...", file=sys.stderr)
                                all_p = self.driver.find_elements(By.TAG_NAME, "p")
                                known_types = [ "flat", "apartment", "house", "bungalow", "studio", "maisonette", "duplex", "terraced", "semi-detached", "detached", "end of terrace", "cottage", "townhouse", "mews", "mobile home", "park home", "land", "farmhouse", "barn conversion", "retirement property", "houseboat", "block of apartments", "penthouse", "link-detached", ]
                                found = False
                                for p in all_p:
                                    try: 
                                        txt = p.text.strip().lower();
                                        if 0 < len(txt) < 100:
                                            for kt in known_types:
                                                if re.search(r"\b" + re.escape(kt) + r"\b", txt): property_data["property_type"] = kt.capitalize(); found = True; break
                                    except Exception: continue
                                    if found: break
                                if not found: print(f"    Property type p-tag fallback failed for {property_data['id']}.", file=sys.stderr)
                            except Exception as e_prop_fb: print(f"    Error during p-tag fallback: {e_prop_fb}", file=sys.stderr)
                        except Exception as e_prop_css_fb: print(f"    Error during prop type CSS fallback: {e_prop_css_fb}", file=sys.stderr)

                    # --- Coordinate Extraction ---
                    try:
                        page_src = self.driver.page_source
                        match_coords = re.search(r'"latitude":([0-9.]+),"longitude":(-?[0-9.]+)', page_src)
                        if match_coords: property_data["latitude"]=match_coords.group(1); property_data["longitude"]=match_coords.group(2)
                        else: print(f"    Coordinates regex not found for {property_data['id']}.", file=sys.stderr)
                    except Exception as e_coords: print(f"    Error extracting coordinates: {e_coords}", file=sys.stderr)

                except (TimeoutException, NoSuchWindowException, WebDriverException, ValueError, Exception) as e_detail:
                    print(f"   Error during detail fetch for {property_data['id']}: {type(e_detail).__name__} - {e_detail}", file=sys.stderr)
                    detail_fetch_error = f"Fetch error: {type(e_detail).__name__}"
                    if isinstance(e_detail, WebDriverException) and ("invalid session id" in str(e_detail).lower() or "session deleted" in str(e_detail).lower() or "unable to connect" in str(e_detail).lower()):
                        print("!!! FATAL WebDriverException during detail fetch. Aborting.", file=sys.stderr); is_fatal_error = True; raise
                finally: # Careful window cleanup
                    try:
                        handles_before = self.driver.window_handles
                        if new_window and new_window in handles_before: self.driver.close()
                        handles_after = self.driver.window_handles
                        if original_window in handles_after: self.driver.switch_to.window(original_window)
                        elif handles_after: self.driver.switch_to.window(handles_after[0])
                    except (NoSuchWindowException, WebDriverException) as e_clean:
                        print(f"   Non-critical error during window cleanup for {property_data['id']}: {e_clean}", file=sys.stderr)
                        if "invalid session id" in str(e_clean).lower() or "session deleted" in str(e_clean).lower():
                            print("!!! FATAL WebDriverException during cleanup. Aborting.", file=sys.stderr); is_fatal_error = True

                # --- Print the processed property data to stdout via SSE ---
                if detail_fetch_error: property_data["fetch_error"] = detail_fetch_error
                print_sse_json(property_data)
                page_processed_count += 1
                self.processed_properties_count += 1

                if is_fatal_error: raise WebDriverException("Session lost during detail processing.")

            except WebDriverException as e_outer_wd:
                print(f"!! FATAL WebDriverException processing card index {i}: {e_outer_wd}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                print_sse_json({"error": f"Fatal WebDriverException: {e_outer_wd}"})
                raise
            except Exception as e_outer:
                print(f"!! Major error processing property card index {i}: {e_outer}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)

        print(f"Finished parsing page. Processed {page_processed_count}/{num_properties} properties found.", file=sys.stderr)


    # --- run method ---
    def run(self):
        print("Starting scraper run...", file=sys.stderr)
        script_error = None
        start_time = time.time()
        try:
            if self.search_by_postcode():
                # Process first page
                print("\nProcessing page 1...", file=sys.stderr)
                time.sleep(random.uniform(0.5, 1.0))
                html = self.driver.page_source
                self.parse(html)

                # Process additional pages (limit to 1 extra page)
                max_pages = 1
                for page in range(1, max_pages + 1):
                    print(f"\nChecking for page {page + 1}...", file=sys.stderr)
                    try:
                        next_button_locator = (By.CSS_SELECTOR, "button.pagination-button.pagination-direction.pagination-direction--next")
                        try: # Check if clickable and not disabled
                            next_button = WebDriverWait(self.driver, 7).until(EC.element_to_be_clickable(next_button_locator))
                            if next_button.get_attribute("disabled") or not next_button.is_enabled():
                                print("Next button disabled. Reached end.", file=sys.stderr); break
                        except TimeoutException:
                            print(f"No enabled 'next' button found on page {page}. Assuming end.", file=sys.stderr); break

                        if not self.robust_click(next_button_locator, timeout=10):
                            print("Failed to click next button. Assuming end.", file=sys.stderr); break

                        # Wait for page load indicator
                        results_price_locator = (By.CSS_SELECTOR, ".PropertyPrice_price__VL65t")
                        WebDriverWait(self.driver, 15).until(EC.presence_of_element_located(results_price_locator))
                        time.sleep(random.uniform(1.0, 2.0))

                        print(f"Processing page {page + 1}...", file=sys.stderr)
                        html = self.driver.page_source
                        self.parse(html)

                    except (WebDriverException) as e_wd_page:
                        script_error = f"Fatal WebDriver Error on page {page + 1}: {str(e_wd_page)}"
                        print(f"!! FATAL WebDriverException during pagination: {e_wd_page}", file=sys.stderr)
                        traceback.print_exc(file=sys.stderr); print_sse_json({"error": script_error}); raise
                    except Exception as e:
                        script_error = f"Error on page {page + 1}: {str(e)}"
                        print(f"Error navigating/parsing page {page + 1}: {e}", file=sys.stderr)
                        traceback.print_exc(file=sys.stderr); break # Stop pagination on errors
            else:
                script_error = "Failed during initial search setup."

        except (WebDriverException) as e_wd_main:
            script_error = f"Fatal WebDriver Error: {str(e_wd_main)}"
            print(f"Caught Fatal WebDriverException in run: {e_wd_main}", file=sys.stderr)
        except Exception as e_main:
            script_error = f"Unexpected runtime error: {str(e_main)}"
            print(f"Scraping run failed with unexpected error: {e_main}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr); print_sse_json({"error": script_error})

        finally:
            run_duration = time.time() - start_time
            print(f"Total run time: {run_duration:.2f} seconds", file=sys.stderr)
            self.close_driver() # Ensure driver closes

            # --- Final SSE Message ---
            if script_error and "Fatal" not in script_error: print(f"Scraping finished with error: {script_error}", file=sys.stderr)
            elif self.processed_properties_count == 0 and not script_error:
                print("Scraping finished. No properties found/processed.", file=sys.stderr); print_sse_json({"status": "no_results"}); print_sse_json({"status": "complete"})
            elif not script_error:
                print(f"Scraping finished successfully. Processed {self.processed_properties_count} properties.", file=sys.stderr); print_sse_json({"status": "complete"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape Rightmove for a given postcode.")
    parser.add_argument("--postcode", required=True, help="UK postcode to search for.")
    args = parser.parse_args()

    scraper = None # Initialize scraper to None
    try:
        scraper = RightmoveScraper(postcode=args.postcode)
        scraper.run()
    except Exception as main_err:
         print(f"Critical error during scraper initialization or run: {main_err}", file=sys.stderr)
         traceback.print_exc(file=sys.stderr)
         print_sse_json({"error": f"Scraper failed critically: {main_err}"})
         # Ensure driver is closed even if initialization failed partially
         if scraper and hasattr(scraper, 'driver') and scraper.driver:
             scraper.close_driver()
         sys.exit(1) # Exit with error code
    # No explicit sys.exit(0) needed here, script ends naturally on success