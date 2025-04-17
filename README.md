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


## Problem Statement



## Risks and Challenges (yuta editting)

Through interviews with several potential customers, concerns were raised regarding Data Security, Privacy, and Fraud Risk in relation to our business.
Our platform targets overseas real estate investors and handles both financial transactions and personal information.
There is a risk that malicious users could impersonate others, or that our platform could be exploited for money laundering or the movement of funds by criminal organizations.
Failure to address these risks could result in legal penalties, reputational damage, and even orders to cease business operations.

To mitigate these risks, we will implement a robust KYC process to verify the identities of our users and prevent unauthorized access and illicit activity.
By doing so, we aim to comply with GDPR and AML (Anti-Money Laundering) regulations, and build trust with our customers.
![Presentation2](https://github.com/user-attachments/assets/b0f45abd-f9b3-4e95-bb84-b1dca0f95efb)

Furthermore, using AI technology, we will continuously monitor transactions for unusual activity and report to authorities as necessary.
This will provide a safe and secure trading environment for users.
We will also properly collect, store, and protect customer personal data in full compliance with GDPR.

According to Chainalysis(https://www.chainalysis.com/blog/what-is-aml-and-kyc-for-crypto/#why-kyc), implementing KYC does not significantly reduce the number of users, demonstrating that illegal usage can be prevented without harming user acquisition, allowing businesses to expand globally.

Additionally, according to CipherTrace, Inc., exchanges operating in countries with weak AML regulations receive 36 times more illicit Bitcoin deposits and send 18 times more illicit funds compared to those in countries with strict regulations.( CipherTrace, CipherTrace, Inc., “Cryptocurrency Anti-Money Laundering Report - Q3 2018)
This indicates that adhering to AML and CFT (Counter Financing of Terrorism) regulations can greatly reduce criminal risks.
![Presentation1](https://github.com/user-attachments/assets/e23a4e9d-b0ef-4f50-ba99-cc0a45c44149)

Automating financial document processing enhances speed, reduces errors, improves security, and lowers costs.( https://www.proof.com/blog/the-value-of-financial-document-automation)


