(function() {
  const POPUP_ID = 'image-scraper-popup';
  const STYLES_ID = 'image-scraper-styles';
  const FONT_ID = 'image-scraper-font';

  // --- Check if the popup already exists ---
  const existingPopup = document.getElementById(POPUP_ID);
  if (existingPopup) {
    existingPopup.remove();
    document.getElementById(STYLES_ID)?.remove();
    document.getElementById(FONT_ID)?.remove();
    return;
  }

  // --- 1. Inject the Google Fonts ---
  if (!document.getElementById(FONT_ID)) {
    const fontLink = document.createElement('link');
    fontLink.id = FONT_ID;
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;700&display=swap';
    document.head.appendChild(fontLink);
  }

  // --- 2. Create the CSS Styles ---
  const popupCSS = `
    /* --- Main Popup Container --- */
    #${POPUP_ID} {
      /* Color Palette */
      --blue-dark: #384959; --blue-medium: #6A89A7; --blue-bright: #88BDF2;
      --blue-light: #BDDDFC; --blue-bg: #F7FBFF; --yellow-dark: #f5a201;
      --yellow-light: #ffba42; --color-bg-primary: var(--blue-bg);
      --color-text-primary: var(--blue-dark); --color-text-secondary: var(--blue-medium);
      --color-bg-card: #ffffff; --color-border: var(--blue-light);
      --color-shadow: rgba(56, 73, 89, 0.08); --color-link: var(--blue-medium);
      --color-link-hover: var(--blue-bright); --color-btn-bg: #ffffff;
      --color-btn-bg-hover: var(--blue-bg); --color-btn-border: var(--blue-light);
      --color-btn-text: var(--blue-dark); --color-danger: var(--yellow-dark);
      --color-danger-hover-text: #ffffff; --color-primary: var(--blue-bright);
      --color-success: var(--yellow-light);

      /* Positioning and Style */
      position: fixed; top: 20px; right: 20px; z-index: 99999999;
      width: 400px; background-color: var(--color-bg-primary);
      color: var(--color-text-primary); border-radius: 8px;
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2); overflow: hidden;
      font-family: 'Inter', 'Roboto', Arial, sans-serif;
    }

    #${POPUP_ID} .popup-content-wrapper { padding: 10px; }

    #${POPUP_ID} h1 {
      font-family: "Instrument Serif", serif; font-weight: 400; font-style: italic;
      font-size: 22px; color: var(--color-text-primary); margin: 0; padding: 10px;
      text-align: center;
    }

    #scraper-popup-close-btn {
      position: absolute; top: 8px; left: 10px; width: 26px; height: 26px;
      line-height: 24px; text-align: center; font-size: 20px; font-weight: bold;
      border-radius: 50%; border: none; background: var(--color-btn-bg);
      color: var(--color-text-secondary); cursor: pointer; transition: background-color 0.2s, color 0.2s;
    }
    #scraper-popup-close-btn:hover { background: var(--color-btn-bg-hover); color: var(--color-danger); }

    #${POPUP_ID} #saved-items-container {
      max-height: 400px;
      overflow-y: auto;
      padding: 0 10px;
      /* FIX 2: Add slight right padding for scrollbar */
      padding-right: 12px;
    }
    #${POPUP_ID} .item-card {
      background: var(--color-bg-card); border: 1px solid var(--color-border);
      border-radius: 8px; margin-bottom: 10px; padding: 12px; position: relative;
      box-shadow: 0 3px 6px var(--color-shadow); transition: box-shadow 0.2s;
    }
    #${POPUP_ID} .item-card:hover { box-shadow: 0 4px 8px var(--color-shadow); }

    #${POPUP_ID} .item-card h2 {
      font-family: Arial, sans-serif;
      font-weight: bold;
      font-style: normal;
      font-size: 13px; margin: 0 0 10px 0; color: var(--color-link);
      padding-right: 65px;
    }

    #${POPUP_ID} .item-card h2 a { color: inherit; text-decoration: none; transition: color 0.2s; }
    #${POPUP_ID} .item-card h2 a:hover { text-decoration: underline; color: var(--color-link-hover); }

    #${POPUP_ID} .image-list {
      display: flex; flex-wrap: wrap;
      /* FIX 1: Reduce gap to 3px */
      gap: 3px;
    }

    #${POPUP_ID} .image-container { position: relative; cursor: pointer; border-radius: 6px; overflow: hidden; }
    #${POPUP_ID} .image-list img {
      width: 60px; height: 60px; object-fit: cover; border: 1px solid var(--color-border);
      border-radius: 6px; transition: filter 0.2s ease;
    }
    #${POPUP_ID} .img-delete-btn {
      position: absolute; top: 0; right: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.5); color: white; border: none; font-size: 24px;
      font-weight: bold; cursor: pointer; display: flex; align-items: center;
      justify-content: center; opacity: 0; transition: opacity 0.2s ease;
    }
    #${POPUP_ID} .image-container:hover img { filter: blur(2px) brightness(0.8); }
    #${POPUP_ID} .image-container:hover .img-delete-btn { opacity: 1; }
    #${POPUP_ID} .no-items { font-size: 12px; color: var(--color-text-secondary); text-align: center; margin: 10px; padding: 10px; }
    #${POPUP_ID} #clear-button {
      cursor: pointer; color: var(--color-danger); display: block; width: fit-content;
      margin: 10px auto; padding: 5px 10px; border: 1px solid var(--color-danger);
      border-radius: 6px; transition: background-color 0.2s, color 0.2s; font-weight: bold;
    }
    #${POPUP_ID} #clear-button:hover { background: var(--color-danger); color: var(--color-danger-hover-text); }
    #${POPUP_ID} .card-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 5px; }
    #${POPUP_ID} .action-btn {
      background: var(--color-btn-bg); border: 1px solid var(--color-btn-border);
      border-radius: 50%; width: 26px; height: 26px; line-height: 26px; text-align: center;
      font-size: 16px; font-weight: bold; cursor: pointer; color: var(--color-btn-text);
      display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;
    }
    #${POPUP_ID} .delete-btn { color: var(--color-danger); }
    #${POPUP_ID} .send-btn { color: var(--color-primary); }
    #${POPUP_ID} .action-btn:hover { background: var(--color-btn-bg-hover); }
    #${POPUP_ID} .action-btn:disabled { color: var(--color-success); cursor: default; }
    #${POPUP_ID} .action-btn svg { width: 14px; height: 14px; }
  `;

  // --- 3. Create the HTML ---
  const popupHTML = `
    <div class="popup-content-wrapper">
      <button id="scraper-popup-close-btn" title="Close">&times;</button>
      <h1>Your Wardrobe</h1>
      <div id="saved-items-container">
        <div class="no-items">Loading...</div>
      </div>
      <button id="clear-button" style="display:none;">Clear All Saved Items</button>
    </div>
  `;

  // --- 4. Inject CSS into <head> ---
  const styleSheet = document.createElement('style');
  styleSheet.id = STYLES_ID;
  styleSheet.textContent = popupCSS;
  document.head.appendChild(styleSheet);

  // --- 5. Inject HTML into <body> ---
  const popupContainer = document.createElement('div');
  popupContainer.id = POPUP_ID;
  popupContainer.innerHTML = popupHTML;
  document.body.appendChild(popupContainer);

  // --- 6. Add all JavaScript logic (This section is unchanged) ---
  const container = popupContainer.querySelector('#saved-items-container');
  const clearButton = popupContainer.querySelector('#clear-button');
  const closeButton = popupContainer.querySelector('#scraper-popup-close-btn');
  let allItems = {};

  function closePopup() {
    popupContainer.remove();
    styleSheet.remove();
    document.getElementById(FONT_ID)?.remove();
    document.removeEventListener('click', handleClickOutside, true);
  }

  function handleClickOutside(event) {
    if (popupContainer.contains(event.target)) { return; }
    closePopup();
  }

  closeButton.addEventListener('click', closePopup);
  document.addEventListener('click', handleClickOutside, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "dataUpdated") { loadItems(); }
  });

  function loadItems() {
    chrome.storage.local.get(null, (items) => {
      allItems = items;
      const allKeys = Object.keys(items);

      if (allKeys.length === 0) {
        container.innerHTML = '<div class="no-items">No saved items yet. Right-click a product page to scrape its images.</div>';
        clearButton.style.display = 'none';
      } else {
        container.innerHTML = '';
        clearButton.style.display = 'block';
        allKeys.forEach(key => {
          const item = items[key];
          if (!item || !item.id) return;
          const card = document.createElement('div');
          card.className = 'item-card';
          card.setAttribute('data-key', key);
          const imageHTML = item.images.map(imgUrl => `
            <div class="image-container">
              <img src="${imgUrl}" alt="Product Image">
              <button class="img-delete-btn" data-key="${key}" data-img-url="${imgUrl}">&times;</button>
            </div>`).join('');

          card.innerHTML = `
            <div class="card-actions">
              <button class="action-btn send-btn" title="Send to Cloud" data-key="${key}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path><polyline points="16 16 12 12 8 16"></polyline></svg>
              </button>
              <button class="action-btn delete-btn" title="Delete" data-key="${key}">&times;</button>
            </div>
            <h2><a href="${item.url}" target="_blank">${item.title}</a></h2>
            <div class="image-list">${imageHTML}</div>
          `;
          container.appendChild(card);
        });
      }
    });
  }

  popupContainer.addEventListener('click', (event) => {
    const target = event.target;

    if (target.closest('.delete-btn')) {
      deleteItemCard(target.closest('.delete-btn').dataset.key);
    } else if (target.closest('.send-btn')) {
      sendItemToCloud(target.closest('.send-btn').dataset.key, target.closest('.send-btn'));
    } else if (target.classList.contains('img-delete-btn')) {
      deleteSingleImage(target.dataset.key, target.dataset.imgUrl, target.parentElement);
    } else if (target.id === 'clear-button') {
      chrome.storage.local.clear(() => { loadItems(); });
    }
  });

  function deleteSingleImage(key, imgUrl, imageContainerElement) {
    const item = allItems[key];
    if (!item) return;
    item.images = item.images.filter(url => url !== imgUrl);
    if (item.images.length === 0) {
      deleteItemCard(key);
    } else {
      allItems[key] = item;
      chrome.runtime.sendMessage({ action: "updateItem", key: key, data: item });
      imageContainerElement.remove();
    }
  }

  function deleteItemCard(key) {
    chrome.runtime.sendMessage({ action: "deleteItem", key: key });
    const card = popupContainer.querySelector(`.item-card[data-key="${key}"]`);
    if (card) card.remove();
    delete allItems[key];
    if (Object.keys(allItems).length === 0) { loadItems(); }
  }

  function sendItemToCloud(key, buttonElement) {
    const itemData = allItems[key];
    if (itemData) {
      buttonElement.innerHTML = '✓';
      buttonElement.disabled = true;
      chrome.runtime.sendMessage({ action: "sendToAws", data: itemData },
        (response) => {
          if (response?.status === 'sent') console.log('AWS send acknowledged');
        }
      );
    }
  }

  // --- 7. Initial Load ---
  loadItems();

})();