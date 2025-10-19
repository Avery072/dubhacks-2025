/**
 * This is the central configuration for the scraper.
 * To add support for a new website:
 * 1. Add a new key with the website's hostname (e.g., "www.macys.com").
 * 2. Add a `titleSelector` which is a CSS selector for the product's name.
 * 3. Add an `imageSelector` which is a CSS selector for the product images.
 * 4. Add an `imageUrlAttribute` which is the HTML attribute that holds the image URL (usually 'src').
 */
const siteConfigs = {
    "www.abercrombie.com": {
      titleSelector: 'h1.pdp-product-title-v2__product-name',
      imageSelector: 'div.product-page-gallery-mfe button.product-image img',
      imageUrlAttribute: 'src',
      cleanUrl: (url) => url.split('?')[0] + '?policy=product-large'
    },
    "www.uniqlo.com": {
      titleSelector: 'h1[data-testid="productName"]',
      imageSelector: 'div.media-gallery--grid img.image__img',
      imageUrlAttribute: 'src',
      cleanUrl: (url) => url.split('?')[0] + '?width=1000'
    },
    "www.zara.com": {
      titleSelector: 'h1.product-detail-info__header-name', 
      imageSelector: 'ul.product-detail-view__extra-images img.media-image__image', 
      imageUrlAttribute: 'src', 
      cleanUrl: (url) => url.replace(/w=\d+/, 'w=1900') 
    },
    "www.macys.com": {
      titleSelector: '.product-name',
      imageSelector: '.main-image-container img',
      imageUrlAttribute: 'src'
    }
  // Add more sites here...
};

/**
 * A generic fallback scraper for sites not in the config.
 */
function genericScraper() {
  const title = document.querySelector('h1')?.innerText || document.title;
  const images = new Set();
  
  // Try to find large images on the page
  document.querySelectorAll('img').forEach(img => {
    if (img.src && img.naturalWidth > 400 && img.naturalHeight > 400) {
      images.add(img.src);
    }
  });

  return { title, images: Array.from(images) };
}

/**
 * Main function that runs when the script is injected.
 */
(function() {
  const hostname = window.location.hostname;
  const config = siteConfigs[hostname];

  let title = '';
  let images = [];

  if (config) {
    // --- Site-specific scraping ---
    const titleElement = document.querySelector(config.titleSelector);
    title = titleElement ? titleElement.innerText : document.title;

    const imageElements = document.querySelectorAll(config.imageSelector);
    const imageUrls = new Set();

    imageElements.forEach(img => {
      let url = img.getAttribute(config.imageUrlAttribute);
      if (url) {
        // If a custom URL cleaning function exists, use it
        if (config.cleanUrl) {
          url = config.cleanUrl(url);
        }
        imageUrls.add(url);
      }
    });
    images = Array.from(imageUrls);

  } else {
    // --- Generic fallback scraping ---
    const genericData = genericScraper();
    title = genericData.title;
    images = genericData.images;
  }

  // Send the data back to the background script
  if (images.length > 0) {
    chrome.runtime.sendMessage({
      action: "saveScrapedData",
      data: {
        url: window.location.href,
        title: title,
        images: images
      }
    });
  } else {
    chrome.runtime.sendMessage({
      action: "scrapingError",
      error: "Could not find any images using the defined selectors."
    });
  }
})();