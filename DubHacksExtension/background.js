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

  // Generic fallback scraper
  function genericScraper() {
    const title = document.querySelector('h1')?.innerText || document.title;
    const images = new Set();
    document.querySelectorAll('img').forEach(img => {
      if (img.src && (img.naturalWidth > 399 || img.clientWidth > 399)) {
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
    const titleElement = document.querySelector(config.titleSelector);
    title = titleElement ? titleElement.innerText.trim() : document.title;
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
    const genericData = genericScraper();
    title = genericData.title;
    images = new Set(genericData.images);
  }

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

// 2. Listen for right-click menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "scrapeThisPage") {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scrapePageContent
      });
      const { url, title, images } = results[0].result;
      if (!title || !images || images.length === 0) {
        showNotification(tab.id, "Scraping failed: No title or images found.", "error");
        return;
      }
      const uniqueId = crypto.randomUUID();
      const dataToSave = { 
        [uniqueId]: { id: uniqueId, url: url, title: title, images: images } 
      };
      chrome.storage.local.set(dataToSave, () => {
        showNotification(tab.id, `Success! Saved ${images.length} images.`, "success");
        chrome.runtime.sendMessage({ action: "dataUpdated" });
      });
    } catch (e) {
      console.error("Error during injection or scraping:", e);
      showNotification(tab.id, `Error: ${e.message}`, "error");
    }
  }
});
        
// 3. --- NEW: Listen for the extension icon to be clicked ---
chrome.action.onClicked.addListener((tab) => {
  // Inject the content script that shows our UI
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
});
        
// 4. Listen for messages from the popup (delete item, update item, send to AWS)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "deleteItem") {
    chrome.storage.local.remove(message.key, () => {
      console.log(`Removed item: ${message.key}`);
    });
  } else if (message.action === "updateItem") {
    const { key, data } = message;
    chrome.storage.local.set({ [key]: data }, () => {
      console.log(`Updated item: ${key}`);
    });
  } else if (message.action === "sendToAws") {
    console.log("Sending data to AWS:", message.data);
    sendToAws(message.data);
    sendResponse({status: "sent"});
  }
  return true; 
});


/**
 * Placeholder function for sending data to your backend.
 */
async function sendToAws(data) {
  const AWS_ENDPOINT_URL = "https://your-api-gateway-id.execute-api.us-west-2.amazonaws.com/prod/save-item";
  console.log(`Simulating POST to ${AWS_ENDPOINT_URL}`);
  // try { ... (AWS fetch logic) ... }
}


// Utility function to show a notification on the page
function showNotification(tabId, message, type = "info") {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    function: (msg, msgType) => {
      let notification = document.getElementById('image-scraper-notification');
      if (notification) notification.remove(); // Remove old one if it exists
      
      notification = document.createElement('div');
      notification.id = 'image-scraper-notification';
      Object.assign(notification.style, {
        position: 'fixed', top: '20px', right: '20px', padding: '15px 20px',
        borderRadius: '8px', color: 'white', zIndex: '999999999', fontFamily: 'Arial, sans-serif',
        fontSize: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        transition: 'opacity 0.5s, top 0.5s', opacity: '0', top: '0px'
      });
      document.body.appendChild(notification);
      
      notification.textContent = msg;
      notification.style.backgroundColor = 
        msgType === 'success' ? '#28a745' :
        msgType === 'error' ? '#dc3545' : '#007bff';

      setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.top = '20px';
      }, 10);
      setTimeout(() => {
         notification.style.opacity = '0';
         notification.style.top = '0px';
         setTimeout(() => notification.remove(), 500);
      }, 3000);
    },
    args: [message, type]
  });
}