// --- This is the function that will be injected into the page ---
// It must be self-contained (all its logic is inside it)
function scrapePageContent() {
  
  // Configuration object for different websites
  const siteConfigs = {
    "www.abercrombie.com": {
      titleSelector: 'h1.pdp-product-title-v2__product-name',
      imageSelector: 'div.product-page-gallery-mfe button.product-image img',
      imageUrlAttribute: 'src',
      cleanUrl: (url) => url.split('?')[0] + '?policy=product-large'
    },
    "www.macys.com": {
      titleSelector: '.product-name', // Example, needs to be verified
      imageSelector: '.main-image-container img', // Example, needs to be verified
      imageUrlAttribute: 'src'
    }
    // Add more sites here...
  };

  // Generic fallback scraper for sites not in the config
  function genericScraper() {
    const title = document.querySelector('h1')?.innerText || document.title;
    const images = new Set();
    document.querySelectorAll('img').forEach(img => {
      if (img.src && img.naturalWidth > 400 && img.naturalHeight > 400) {
        images.add(img.src);
      }
    });
    return { title, images: Array.from(images) };
  }

  // --- Main Scraper Logic ---
  const hostname = window.location.hostname;
  const config = siteConfigs[hostname];
  let title = '';
  let images = new Set();

  if (config) {
    // --- Site-specific scraping ---
    const titleElement = document.querySelector(config.titleSelector);
    title = titleElement ? titleElement.innerText : document.title;

    const imageElements = document.querySelectorAll(config.imageSelector);
    imageElements.forEach(img => {
      let url = img.getAttribute(config.imageUrlAttribute);
      if (url) {
        if (config.cleanUrl) {
          url = config.cleanUrl(url);
        }
        images.add(url);
      }
    });

  } else {
    // --- Generic fallback scraping ---
    const genericData = genericScraper();
    title = genericData.title;
    images = new Set(genericData.images); // Use Set to ensure no duplicates
  }

  // Return the final data
  return {
    url: window.location.href,
    title: title,
    images: Array.from(images)
  };
}


// ===================================================================
// BACKGROUND SCRIPT EVENT LISTENERS
// ===================================================================

// 1. Create the right-click menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "scrapeThisPage",
    title: "Scrape Product Images",
    contexts: ["page"] 
  });
});

// 2. Listen for menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "scrapeThisPage") {
    try {
      // --- THIS IS THE KEY CHANGE ---
      // Inject the function, not a file. This runs every time.
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scrapePageContent // Inject the function defined above
      });

      // 3. Get the data returned from the injected function
      const { url, title, images } = results[0].result;

      if (!title || !images || images.length === 0) {
        showNotification(tab.id, "Scraping failed: No title or images found.", "error");
        return;
      }
      
      // 4. Save the data
      const uniqueId = crypto.randomUUID();
      const dataToSave = { 
        [uniqueId]: { 
          id: uniqueId, // Store the ID for easy access
          url: url, 
          title: title, 
          images: images 
        } 
      };
      
      chrome.storage.local.set(dataToSave, () => {
        showNotification(tab.id, `Success! Saved ${images.length} images.`, "success");
        // Tell the popup to refresh
        chrome.runtime.sendMessage({ action: "dataUpdated" });
      });

    } catch (e) {
      console.error("Error during injection or scraping:", e);
      showNotification(tab.id, `Error: ${e.message}`, "error");
    }
  }
});
        
// 3. Listen for messages from the popup (delete, send to AWS)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "deleteItem") {
    chrome.storage.local.remove(message.key, () => {
      console.log(`Removed item: ${message.key}`);
    });
  
  } else if (message.action === "sendToAws") {
    console.log("Sending data to AWS:", message.data);
    sendToAws(message.data);
    sendResponse({status: "sent"}); // Let the popup know
  }
  
  return true; // Keep message channel open for async
});


/**
 * Placeholder function for sending data to your backend.
 */
async function sendToAws(data) {
  const AWS_ENDPOINT_URL = "https://your-api-gateway-id.execute-api.us-west-2.amazonaws.com/prod/save-item";
  console.log(`Simulating POST to ${AWS_ENDPOINT_URL}`);
  
  // try {
  //   const response = await fetch(AWS_ENDPOINT_URL, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(data)
  //   });
  //   if (!response.ok) throw new Error(`AWS API Error: ${response.statusText}`);
  //   const result = await response.json();
  //   console.log("Success (AWS):", result);
  // } catch (error) {
  //   console.error("Failed to send to AWS:", error);
  // }
}


// Utility function to show a notification on the page
function showNotification(tabId, message, type = "info") {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    function: (msg, msgType) => {
      let notification = document.getElementById('image-scraper-notification');
      if (!notification) {
        notification = document.createElement('div');
        notification.id = 'image-scraper-notification';
        Object.assign(notification.style, {
          position: 'fixed', top: '20px', right: '20px', padding: '15px 20px',
          borderRadius: '8px', color: 'white', zIndex: '999999', fontFamily: 'Arial, sans-serif',
          fontSize: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          transition: 'opacity 0.5s, top 0.5s', opacity: '0', top: '0px'
        });
        document.body.appendChild(notification);
      }
      
      notification.textContent = msg;
      notification.style.backgroundColor = 
        msgType === 'success' ? '#28a745' :
        msgType === 'error' ? '#dc3545' : '#007bff';

      // Fade in
      setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.top = '20px';
      }, 10);
      // Fade out
      setTimeout(() => {
         notification.style.opacity = '0';
         notification.style.top = '0px';
      }, 3000);
    },
    args: [message, type]
  });
}