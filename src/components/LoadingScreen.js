// src/components/LoadingScreen.js
import React, { useEffect } from "react";
import "./LoadingScreen.css"; // We will update this file

const LoadingScreen = ({
  isVisible,
  message = "Loading...", // Simpler default message
  logoSrc, // Prop for the logo path
}) => {
  // Optional: Prevent body scroll when loading screen is visible
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
      {/* Overlay and blur */}
      <div className="loading-content-centered">
        {" "}
        {/* Centering container */}
        {/* Logo */}
        {logoSrc && (
          <img src={logoSrc} alt="Loading Logo" className="loading-logo" />
        )}
        {/* Simple Spinner */}
        <div className="loading-spinner"></div>
        {/* Loading Text */}
        <div className="loading-text">
          <h2>{message}</h2>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
