// src/components/LoadingScreen.js
import React, { useEffect } from "react"; // Removed useState as dots aren't needed for this version
import "./LoadingScreen.css"; // We will update this file

// Added logoSrc prop, removed progress and itemsFound as they are not used
// for the main initial loading screen anymore.
const LoadingScreen = ({
  isVisible,
  message = "Loading...", // Simpler default message
  logoSrc, // New prop for the logo path
}) => {
  // Optional: Add effect to prevent body scroll when loading screen is visible
  useEffect(() => {
    if (isVisible) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    // Cleanup function
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="loading-screen">
      {" "}
      {/* Keeps the overlay and blur */}
      <div className="loading-content-centered">
        {" "}
        {/* New container for centering */}
        {/* Logo */}
        {logoSrc && (
          <img src={logoSrc} alt="Loading Logo" className="loading-logo" />
        )}
        {/* Simple Spinner */}
        <div className="loading-spinner"></div>
        {/* Loading Text */}
        <div className="loading-text">
          {/* Removed dots from message for cleaner look */}
          <h2>{message}</h2>
        </div>
        {/* Removed progress bar and items found counter */}
      </div>
    </div>
  );
};

export default LoadingScreen;
