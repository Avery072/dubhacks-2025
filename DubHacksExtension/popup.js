const container = document.getElementById('saved-items-container');
const clearButton = document.getElementById('clear-button');
let allItems = {}; // Cache for holding item data

// --- NEW: Listen for updates from the background script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "dataUpdated") {
    loadItems(); // Reload all items
  }
});

// --- NEW: Main logic is now in a reusable function ---
function loadItems() {
  chrome.storage.local.get(null, (items) => {
    allItems = items; // Update the cache
    const allKeys = Object.keys(items);
    
    if (allKeys.length === 0) {
      container.innerHTML = '<div class="no-items">No saved items yet. Right-click a product page to scrape its images.</div>';
      clearButton.style.display = 'none';
    } else {
      container.innerHTML = '';
      clearButton.style.display = 'block';

      allKeys.forEach(key => {
        const item = items[key];
        if (!item || !item.id) return; // Skip if data is malformed
        
        const card = document.createElement('div');
        card.className = 'item-card';
        card.setAttribute('data-key', key); // Set key on card for easy removal
        
        card.innerHTML = `
          <div class="card-actions">
            <button class="action-btn send-btn" title="Send to Cloud" data-key="${key}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path><polyline points="16 16 12 12 8 16"></polyline></svg>
            </button>
            <button class="action-btn delete-btn" title="Delete" data-key="${key}">&times;</button>
          </div>
          <h2><a href="${item.url}" target="_blank">${item.title}</a></h2>
          <div class="image-list">
            ${item.images.map(imgUrl => `<a href="${imgUrl}" target="_blank"><img src="${imgUrl}" alt="Product Image"></a>`).join('')}
          </div>
        `;
        container.appendChild(card);
      });
    }
  });
}

// --- NEW: Event handler for all buttons ---
container.addEventListener('click', (event) => {
  const target = event.target.closest('.action-btn'); // Find the button
  if (!target) return; // Click was not on a button

  const key = target.dataset.key;
  if (!key) return;

  if (target.classList.contains('delete-btn')) {
    // --- Handle Delete ---
    chrome.runtime.sendMessage({ action: "deleteItem", key: key });
    
    // Remove from UI immediately
    const card = document.querySelector(`.item-card[data-key="${key}"]`);
    if (card) {
      card.remove();
    }
    
    if (container.children.length === 0) {
      loadItems(); // Show the "no items" message
    }

  } else if (target.classList.contains('send-btn')) {
    // --- Handle Send to AWS ---
    const itemData = allItems[key];
    if (itemData) {
      target.innerHTML = '✓'; // Mark as "sent"
      target.disabled = true;
      
      chrome.runtime.sendMessage(
        { action: "sendToAws", data: itemData }, 
        (response) => {
          if (response?.status === 'sent') {
            console.log('AWS send acknowledged');
          }
        }
      );
    }
  }
});

// Handle the "Clear All" button
clearButton.addEventListener('click', () => {
  chrome.storage.local.clear(() => {
    loadItems(); // Just re-run the load function
  });
});

// Initial load
document.addEventListener('DOMContentLoaded', loadItems);