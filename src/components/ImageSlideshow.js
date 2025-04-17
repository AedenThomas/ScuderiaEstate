import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import "./ImageSlideshow.css"; // We'll create this CSS file

const ImageSlideshow = ({ imageUrls, altText = "Property image" }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!imageUrls || imageUrls.length === 0) {
    // Display a placeholder if no images are available
    return (
      <div className="image-slideshow placeholder">
        <img
          src="https://placehold.co/600x400/e9e9e9/777777?text=No+Images"
          alt="Placeholder"
        />
      </div>
    );
  }

  const goToPrevious = () => {
    const isFirstSlide = currentIndex === 0;
    const newIndex = isFirstSlide ? imageUrls.length - 1 : currentIndex - 1;
    setCurrentIndex(newIndex);
  };

  const goToNext = () => {
    const isLastSlide = currentIndex === imageUrls.length - 1;
    const newIndex = isLastSlide ? 0 : currentIndex + 1;
    setCurrentIndex(newIndex);
  };

  const goToSlide = (slideIndex) => {
    setCurrentIndex(slideIndex);
  };

  return (
    <div className="image-slideshow">
      {imageUrls.length > 1 && (
        <button
          onClick={goToPrevious}
          className="slide-arrow prev-arrow"
          aria-label="Previous image"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      )}
      <div className="slide-image-container">
        {/* Preload next and previous images for smoother transitions */}
        {imageUrls.map((url, index) => (
          <link
            key={index}
            rel="preload"
            as="image"
            href={url}
            style={{ display: "none" }}
          />
        ))}
        <img
          src={imageUrls[currentIndex]}
          alt={`${altText} ${currentIndex + 1}`}
          className="slide-image"
          // Add error handling for broken image links
          onError={(e) => {
            e.target.onerror = null; // Prevent infinite loop
            e.target.src =
              "https://placehold.co/600x400/f8d7da/721c24?text=Image+Error"; // Show error placeholder
          }}
        />
      </div>
      {imageUrls.length > 1 && (
        <button
          onClick={goToNext}
          className="slide-arrow next-arrow"
          aria-label="Next image"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      )}
      {imageUrls.length > 1 && (
        <div className="slide-dots">
          {imageUrls.map((_, slideIndex) => (
            <button
              key={slideIndex}
              onClick={() => goToSlide(slideIndex)}
              className={`dot ${currentIndex === slideIndex ? "active" : ""}`}
              aria-label={`Go to image ${slideIndex + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageSlideshow;
