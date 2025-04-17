# Real Estate Intelligence Platform

A modern real estate intelligence platform that provides interactive heat map visualization and detailed property listings for the London market.

## Features

- **Interactive Heat Map**: Visualize property price hotspots and market activity levels across London
- **Property Listings**: Detailed property cards with comprehensive information
- **AI-Powered Insights**: Estimated property values, ROI calculations, and risk assessments
- **Modern UI**: Clean, responsive interface with intuitive navigation

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository

```
git clone https://github.com/AedenThomas/ScuderiaEstate
cd ScuderiaEstate
```

2. Install dependencies

```
npm install
```

3. Start the development server

<!-- from root dir do npm start and from server dir do node server.js (also before that to cd into server dir) -->

```
npm start
```

In a new terminal, navigate to the server directory and start the server

```
cd server
node server.js
```

4. Open your browser and navigate to `http://localhost:3000`

## Project Structure

- `src/components/` - React components
  - `HeatmapLayer.js` - Heat map visualization component
  - `PropertyCard.js` - Property listing card component
- `src/assets/` - Static assets like images and icons
- `src/App.js` - Main application component
- `src/App.css` - Application styles

## Technologies Used

- React.js
- Leaflet (for maps)
- Leaflet.heat (for heat map visualization)
- Font Awesome (for icons)

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Data provided by [placeholder for data source]
- Icons from Font Awesome
- Map tiles from OpenStreetMap




