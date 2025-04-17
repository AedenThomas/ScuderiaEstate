// src/services/crimeService.js
export async function fetchCrimeData(lat, lng, date = null) {
    if (!lat || !lng) return null;
  
    const baseUrl = "https://data.police.uk/api/crimes-street/all-crime";
    const url = new URL(baseUrl);
    url.searchParams.set("lat", lat);
    url.searchParams.set("lng", lng);
    if (date) url.searchParams.set("date", date); // Optional: format 'YYYY-MM'
  
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Police API error: ${res.status}`);
      const data = await res.json();
  
      // Summarize by category and outcome
      const summary = {
        byCategory: {},
        byOutcome: {},
        total: data.length,
      };
  
      data.forEach((crime) => {
        const cat = crime.category || "unknown";
        summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;
  
        const outcome = crime.outcome_status?.category || "No outcome recorded";
        summary.byOutcome[outcome] = (summary.byOutcome[outcome] || 0) + 1;
      });
  
      return summary;
    } catch (error) {
      console.error("Error fetching crime data:", error.message);
      return null;
    }
  }
  