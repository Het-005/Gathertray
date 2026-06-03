let state = {
  restaurants: [],
  orders: [],
  restaurantDashboard: null,
  adminDashboard: null,
  applications: [],
  users: [],
  favorites: [],
  savedSearches: [],
  emailLog: [],
  sessions: [],
  backupSummary: null,
  savedBackups: [],
  securitySummary: null,
  securityEvents: [],
};

function readNotificationStorageKey(email) {
  return `gathertray_notifications_read_${(email || "").toLowerCase()}`;
}

function getSessionUser() {
  try {
    const session = JSON.parse(window.localStorage.getItem("gathertray_session") || "null");
    return session ? session.user : null;
  } catch (_error) {
    return null;
  }
}

function getSessionToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem("gathertray_session") || "null");
    return session ? session.token : null;
  } catch (_error) {
    return null;
  }
}

function setSessionUser(session) {
  window.localStorage.setItem("gathertray_session", JSON.stringify(session));
}

function clearSessionUser() {
  window.localStorage.removeItem("gathertray_session");
}

function getReadNotificationIds(email) {
  try {
    return JSON.parse(window.localStorage.getItem(readNotificationStorageKey(email)) || "[]");
  } catch (_error) {
    return [];
  }
}

function setReadNotificationIds(email, ids) {
  window.localStorage.setItem(readNotificationStorageKey(email), JSON.stringify(ids));
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function orderDetailHref(orderId) {
  return `./order-detail.html?id=${encodeURIComponent(orderId)}`;
}

function createOrderActionButtons(order) {
  return `
    <div class="row-actions">
      <a class="button button-subtle" href="${orderDetailHref(order.id)}">View</a>
      <button class="button button-subtle" type="button" data-order-status="${order.id}" data-next-status="Accepted">Accept</button>
      <button class="button button-subtle" type="button" data-order-status="${order.id}" data-next-status="In prep">Prep</button>
      <button class="button button-subtle" type="button" data-order-status="${order.id}" data-next-status="Completed">Complete</button>
    </div>
  `;
}

function createIssueCard(issue, options = {}) {
  const actions = options.showAdminActions
    ? `
      <div class="row-actions">
        <button class="button button-subtle" type="button" data-issue-status="${issue.id}" data-next-issue-status="In review">Review</button>
        <button class="button button-subtle" type="button" data-issue-status="${issue.id}" data-next-issue-status="Resolved">Resolve</button>
      </div>
    `
    : "";

  return `
    <article class="issue-card">
      <p class="mini-label">${issue.id || issue.order}</p>
      <h3>${issue.issue}</h3>
      <p>Order: ${issue.order || "Not linked"}<br>Owner: ${issue.owner || "Support"}<br>Status: ${issue.status || "Open"}</p>
      <span class="chip">${issue.priority || "Medium"} priority</span>
      ${actions}
    </article>
  `;
}

function createReviewCard(review) {
  return `
    <article class="issue-card">
      <p class="mini-label">${formatDateTime(review.createdAt)}</p>
      <h3>${review.rating} / 5</h3>
      <p>${review.comment || "No written comment."}</p>
      <span class="chip">${review.customerName || "Customer"}</span>
    </article>
  `;
}

function createNotificationCard(notification, options = {}) {
  const isRead = Boolean(options.isRead);
  const entityLabel = notification.entityId
    ? `<span class="chip">${notification.entityType || "activity"} · ${notification.entityId}</span>`
    : "";
  const actions = [];
  if (notification.entityType === "order" && notification.entityId) {
    actions.push(`<a class="button button-subtle" data-read-notification="${notification.id}" href="${orderDetailHref(notification.entityId)}">View order</a>`);
  }
  actions.push(`<button class="button button-subtle" type="button" data-toggle-notification-read="${notification.id}" data-notification-read="${isRead ? "true" : "false"}">${isRead ? "Mark unread" : "Mark read"}</button>`);
  const unreadChip = isRead ? "" : `<span class="chip">Unread</span>`;

  return `
    <article class="issue-card ${isRead ? "notification-card-read" : "notification-card-unread"}">
      <p class="mini-label">${formatDateTime(notification.createdAt)}</p>
      <h3>${notification.title}</h3>
      <p>${notification.body}</p>
      <div class="chip-row">
        ${unreadChip}
        ${entityLabel}
      </div>
      <div class="row-actions">
        ${actions.join("")}
      </div>
    </article>
  `;
}

function createSessionCard(session) {
  return `
    <article class="issue-card ${session.isCurrent ? "session-card-current" : ""}">
      <p class="mini-label">${session.isCurrent ? "Current session" : session.id}</p>
      <h3>${session.isCurrent ? "This browser" : "Active signed-in session"}</h3>
      <p>Started: ${formatDateTime(session.createdAt)}<br>Last active: ${formatDateTime(session.lastSeenAt)}</p>
      <div class="chip-row">
        ${session.isCurrent ? `<span class="chip">Current</span>` : `<span class="chip">Active</span>`}
      </div>
      <div class="row-actions">
        <button class="button button-subtle" type="button" data-revoke-session="${session.id}">${session.isCurrent ? "Sign out this browser" : "Revoke session"}</button>
      </div>
    </article>
  `;
}

function extractOrderIdFromNotification(notification) {
  if (notification?.entityType === "order" && notification?.entityId) {
    return notification.entityId;
  }
  if (notification?.orderId) {
    return notification.orderId;
  }
  const text = `${notification?.title || ""} ${notification?.body || ""}`;
  const match = text.match(/GT-\d+/);
  return match ? match[0] : "";
}

function notificationMatchesOrder(notification, orderId) {
  if (!orderId) return false;
  if (notification?.entityType === "order" && notification?.entityId === orderId) return true;
  if (notification?.orderId === orderId) return true;
  return extractOrderIdFromNotification(notification) === orderId;
}

function buildOrderTimelineEvents(order, issues, review, notifications) {
  if (!order) return [];

  const events = [
    {
      id: `${order.id}-created`,
      label: "Order created",
      title: `${order.customer || "Customer"} submitted the request`,
      detail: `${order.restaurantName} received a new catering request for ${order.eventDate || "the scheduled event date"}.`,
      at: order.createdAt || order.eventDate
    },
    {
      id: `${order.id}-status`,
      label: "Latest status",
      title: order.status,
      detail: `${order.restaurantName} is currently showing this order as ${order.status}.`,
      at: order.updatedAt || order.createdAt || order.eventDate
    },
    {
      id: `${order.id}-event`,
      label: "Event schedule",
      title: order.eventDate || "Date pending",
      detail: `${order.eventTime ? `Scheduled for ${order.eventTime}.` : "Event time still needs confirmation."}`,
      at: order.eventDate || order.createdAt
    }
  ];

  issues.forEach((issue) => {
    events.push({
      id: issue.id,
      label: "Support",
      title: `${issue.id} • ${issue.status}`,
      detail: `${issue.priority} priority • ${issue.issue}`,
      at: issue.updatedAt || issue.createdAt
    });
  });

  if (review) {
    events.push({
      id: review.id,
      label: "Review",
      title: `${review.rating} / 5 customer review`,
      detail: review.comment || "Review submitted without a written comment.",
      at: review.createdAt
    });
  }

  notifications
    .filter((item) => notificationMatchesOrder(item, order.id))
    .forEach((item) => {
      events.push({
        id: item.id,
        label: "Notification",
        title: item.title,
        detail: item.body,
        at: item.createdAt
      });
    });

  return events.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
}

function createTimelineCard(event) {
  return `
    <article class="issue-card timeline-card">
      <p class="mini-label">${event.label} · ${formatDateTime(event.at)}</p>
      <h3>${event.title}</h3>
      <p>${event.detail}</p>
    </article>
  `;
}

function createApplicationStatusCard(application) {
  const timeline = application.approvedAt || application.rejectedAt || application.changesRequestedAt || application.submittedAt;
  const statusText = application.status === "changes_requested"
    ? "Changes requested"
    : application.status.charAt(0).toUpperCase() + application.status.slice(1);

  return `
    <article class="issue-card">
      <p class="mini-label">${application.id}</p>
      <h3>${application.businessName}</h3>
      <p>Status: ${statusText}<br>Updated: ${formatDateTime(timeline)}</p>
      ${application.website ? `<p><strong>Website:</strong> <a href="${application.website}" target="_blank" rel="noreferrer">${application.website.replace(/^https?:\/\//, "")}</a></p>` : ""}
      ${application.importStatusNote ? `<p><strong>Import status:</strong> ${application.importStatusNote}</p>` : ""}
      ${application.importedPackageCount ? `<p><strong>Imported packages:</strong> ${application.importedPackageCount}</p>` : ""}
      ${application.reviewNote ? `<p><strong>Review note:</strong> ${application.reviewNote}</p>` : ""}
      ${application.rejectionReason ? `<p><strong>Rejection reason:</strong> ${application.rejectionReason}</p>` : ""}
      ${application.approvedRestaurantSlug ? `<p><strong>Approved listing:</strong> ${application.approvedRestaurantSlug}</p>` : ""}
      <span class="chip">${application.cuisine}</span>
    </article>
  `;
}

async function downloadWithSession(url, filename) {
  const token = getSessionToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

async function fetchJson(url, options) {
  const token = getSessionToken();
  const headers = new Headers(options?.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function getRestaurantBySlug(slug) {
  return state.restaurants.find((restaurant) => restaurant.slug === slug) || state.restaurants[0];
}

function isFavorite(slug) {
  return (state.favorites || []).some((restaurant) => restaurant.slug === slug);
}

function splitDateList(text) {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isRestaurantAvailableOnDate(restaurant, eventDate) {
  if (!eventDate) return true;
  return !(restaurant.blackoutDates || []).includes(eventDate);
}

function isRestaurantLive(restaurant) {
  return restaurant.listingStatus !== "paused";
}

function getLeadTimeHours(restaurant) {
  return Number(restaurant.leadTimeHours) || 24;
}

function isLeadTimeMet(restaurant, eventDate, eventTime) {
  if (!eventDate || !eventTime) return true;
  const eventAt = new Date(`${eventDate}T${eventTime}:00`);
  if (Number.isNaN(eventAt.getTime())) return true;
  return (eventAt.getTime() - Date.now()) >= (getLeadTimeHours(restaurant) * 60 * 60 * 1000);
}

function createSavedSearchCard(search, options = {}) {
  const description = [
    search.zip ? `ZIP ${search.zip}` : null,
    search.cuisine && search.cuisine !== "all" ? search.cuisine : null,
    search.guests ? `${search.guests} guests` : null,
    search.budgetAmount ? `${money(search.budgetAmount)} ${search.budgetMode === "total" ? "total" : "/ guest"}` : null
  ].filter(Boolean).join(" • ");

  return `
    <article class="issue-card">
      <p class="mini-label">${search.id}</p>
      <h3>${search.name}</h3>
      <p>${description || "General marketplace search"}<br>Delivery: ${search.deliveryMode || "any"}<br>Occasion: ${search.occasion || "any"}</p>
      <div class="row-actions">
        <button class="button button-subtle" type="button" data-apply-search="${search.id}">Apply</button>
        ${options.showDelete ? `<button class="button button-subtle" type="button" data-delete-search="${search.id}">Delete</button>` : ""}
      </div>
    </article>
  `;
}

function getServiceFee(subtotal) {
  if (subtotal < 250) return 9;
  if (subtotal < 600) return 12;
  if (subtotal < 1200) return 19;
  return 29;
}

function createRestaurantCard(restaurant) {
  return `
    <article class="restaurant-card">
      <div class="restaurant-card-header">
        <h3>${restaurant.name}</h3>
        <span class="chip">${restaurant.cuisine}</span>
      </div>
      <p>${restaurant.description}</p>
      <div class="restaurant-meta">
        <span class="chip">${restaurant.neighborhood}</span>
        <span class="chip">${money(restaurant.minimum)} minimum</span>
        <span class="chip">${restaurant.deliveryModes.join(", ")}</span>
      </div>
      <p>${restaurant.rating} stars from ${restaurant.reviews} reviews. ${restaurant.setup}. ${restaurant.leadTime} lead time.</p>
      <div class="card-actions">
        <a class="button button-primary" href="./restaurant.html?slug=${restaurant.slug}">View details</a>
        <a class="button button-subtle" href="./order.html?restaurant=${restaurant.slug}">Order</a>
        <button class="button button-secondary" type="button" data-toggle-favorite="${restaurant.slug}">${isFavorite(restaurant.slug) ? "Saved" : "Save"}</button>
      </div>
    </article>
  `;
}

function createMarketplaceResult(restaurant, context) {
  const guestCount = context.guestCount || 24;
  const estimatedFood = restaurant.perPerson * guestCount;
  const budgetText = context.budgetAmount
    ? context.budgetMode === "total"
      ? `${money(context.budgetAmount)} total budget`
      : `${money(context.budgetAmount)} / guest budget`
    : "No budget set";
  const budgetTarget = context.budgetAmount
    ? context.budgetMode === "total"
      ? context.budgetAmount
      : context.budgetAmount * guestCount
    : null;
  const budgetState = budgetTarget
    ? estimatedFood <= budgetTarget
      ? `Fits budget by ${money(budgetTarget - estimatedFood)}`
      : `Over budget by ${money(estimatedFood - budgetTarget)}`
    : `Estimated food total ${money(estimatedFood)}`;

  return `
    <article class="search-result-card">
      <div class="search-result-main">
        <div class="restaurant-card-header">
          <div>
            <h3>${restaurant.name}</h3>
            <p class="result-subtitle">${restaurant.cuisine} in ${restaurant.neighborhood}</p>
          </div>
          <div class="result-rating">
            <strong>${restaurant.rating}</strong>
            <span>${restaurant.reviews} reviews</span>
          </div>
      </div>
        <p>${restaurant.description}</p>
      <div class="restaurant-meta">
        <span class="chip">${money(restaurant.minimum)} minimum</span>
        <span class="chip">${restaurant.leadTime} lead time</span>
        <span class="chip">${restaurant.deliveryModes.join(", ")}</span>
        ${restaurant.listingStatus === "paused" ? `<span class="chip">Paused</span>` : ""}
      </div>
        <div class="result-highlights">
          <span>ZIPs: ${restaurant.zipCodes.slice(0, 3).join(", ")}</span>
          <span>Best for: ${restaurant.occasions.join(", ")}</span>
          <span>${budgetText}</span>
        </div>
      </div>
      <aside class="search-result-side">
        <div class="result-price">${money(estimatedFood)}<span> est. food</span></div>
        <p class="result-budget">${budgetState}</p>
        <div class="card-actions">
          <a class="button button-primary" href="./restaurant.html?slug=${restaurant.slug}">View menu</a>
          <a class="button button-subtle" href="./order.html?restaurant=${restaurant.slug}">Order</a>
          <button class="button button-secondary" type="button" data-toggle-favorite="${restaurant.slug}">${isFavorite(restaurant.slug) ? "Saved" : "Save"}</button>
        </div>
      </aside>
    </article>
  `;
}

async function handleFavoriteToggle(slug) {
  const sessionUser = getSessionUser();
  if (!sessionUser || sessionUser.role !== "customer") {
    window.alert("Sign in with a customer account to save restaurants.");
    return;
  }

  await fetchJson("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantSlug: slug }),
  });
  state.favorites = await fetchJson("/api/favorites");
  renderMarketplace();
  renderRestaurantDetail();
  renderAccountPage();
}

function applySavedSearch(search) {
  const zipFilter = document.querySelector("#zip-filter");
  const cuisineFilter = document.querySelector("#cuisine-filter");
  const guestFilter = document.querySelector("#guest-filter");
  const eventDateFilter = document.querySelector("#event-date-filter");
  const budgetModeFilter = document.querySelector("#budget-mode-filter");
  const budgetFilter = document.querySelector("#budget-filter");
  const deliveryModeFilter = document.querySelector("#delivery-mode-filter");
  const occasionFilter = document.querySelector("#occasion-filter");
  const minimumFilter = document.querySelector("#minimum-filter");
  const sortFilter = document.querySelector("#sort-filter");
  if (!zipFilter || !cuisineFilter || !guestFilter || !budgetModeFilter || !budgetFilter || !deliveryModeFilter || !occasionFilter || !minimumFilter || !sortFilter) return;

  zipFilter.value = search.zip || "";
  cuisineFilter.value = search.cuisine || "all";
  guestFilter.value = search.guests || "";
  budgetModeFilter.value = search.budgetMode || "per-person";
  budgetFilter.value = search.budgetAmount || "";
  deliveryModeFilter.value = search.deliveryMode || "all";
  occasionFilter.value = search.occasion || "all";
  minimumFilter.value = search.minimum || "1000";
  sortFilter.value = search.sort || "recommended";

  ["input", "change"].forEach((eventName) => {
    sortFilter.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

async function refreshSavedSearches() {
  const sessionUser = getSessionUser();
  if (!sessionUser || sessionUser.role !== "customer") {
    state.savedSearches = [];
    return;
  }
  state.savedSearches = await fetchJson("/api/saved-searches");
}

function bindSavedSearchButtons(scope = document) {
  scope.querySelectorAll("[data-apply-search]").forEach((button) => {
    button.onclick = () => {
      const search = state.savedSearches.find((item) => item.id === button.dataset.applySearch);
      if (search) applySavedSearch(search);
    };
  });

  scope.querySelectorAll("[data-delete-search]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/saved-searches/${button.dataset.deleteSearch}`, { method: "DELETE" });
        await refreshSavedSearches();
        renderMarketplace();
        renderAccountPage();
      } catch (_error) {
        button.disabled = false;
      }
    };
  });
}

function bindFavoriteButtons(scope = document) {
  scope.querySelectorAll("[data-toggle-favorite]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await handleFavoriteToggle(button.dataset.toggleFavorite);
      } catch (_error) {
        button.disabled = false;
      }
    };
  });
}

function renderMarketplace() {
  const grid = document.querySelector("#marketplace-grid");
  const cuisineFilter = document.querySelector("#cuisine-filter");
  const minimumFilter = document.querySelector("#minimum-filter");
  const zipFilter = document.querySelector("#zip-filter");
  const guestFilter = document.querySelector("#guest-filter");
  const eventDateFilter = document.querySelector("#event-date-filter");
  const budgetModeFilter = document.querySelector("#budget-mode-filter");
  const budgetFilter = document.querySelector("#budget-filter");
  const deliveryModeFilter = document.querySelector("#delivery-mode-filter");
  const occasionFilter = document.querySelector("#occasion-filter");
  const resultsCount = document.querySelector("#results-count");
  const sortFilter = document.querySelector("#sort-filter");
  const saveSearchButton = document.querySelector("#save-search-button");
  const savedSearchName = document.querySelector("#saved-search-name");
  const savedSearches = document.querySelector("#saved-searches");
  if (
    !grid || !cuisineFilter || !minimumFilter || !zipFilter || !guestFilter ||
    !budgetModeFilter || !budgetFilter || !deliveryModeFilter || !occasionFilter || !resultsCount || !sortFilter || !eventDateFilter
  ) return;

  const cuisines = [...new Set(state.restaurants.map((restaurant) => restaurant.cuisine))];
  const occasions = [...new Set(state.restaurants.flatMap((restaurant) => restaurant.occasions || []))];
  cuisineFilter.innerHTML =
    `<option value="all">All cuisines</option>` +
    cuisines.map((cuisine) => `<option value="${cuisine}">${cuisine}</option>`).join("");
  occasionFilter.innerHTML =
    `<option value="all">Any occasion</option>` +
    occasions.map((occasion) => `<option value="${occasion}">${occasion}</option>`).join("");

  function updateGrid() {
    const selectedCuisine = cuisineFilter.value;
    const maxMinimum = Number(minimumFilter.value);
    const zip = zipFilter.value.trim();
    const guestCount = Number(guestFilter.value) || 24;
    const eventDate = eventDateFilter.value;
    const budgetMode = budgetModeFilter.value;
    const budgetAmount = Number(budgetFilter.value) || 0;
    const deliveryMode = deliveryModeFilter.value;
    const occasion = occasionFilter.value;
    let filtered = state.restaurants.filter((restaurant) => {
      const cuisineMatch = selectedCuisine === "all" || restaurant.cuisine === selectedCuisine;
      const minimumMatch = restaurant.minimum <= maxMinimum;
      const zipMatch = !zip || (restaurant.zipCodes || []).includes(zip);
      const deliveryMatch = deliveryMode === "all" || (restaurant.deliveryModes || []).includes(deliveryMode);
      const occasionMatch = occasion === "all" || (restaurant.occasions || []).includes(occasion);
      const budgetTarget = budgetAmount
        ? budgetMode === "total"
          ? budgetAmount
          : budgetAmount * guestCount
        : null;
      const budgetMatch = !budgetTarget || (restaurant.perPerson * guestCount) <= budgetTarget * 1.15;
      const dateMatch = isRestaurantAvailableOnDate(restaurant, eventDate);
      return cuisineMatch && minimumMatch && zipMatch && deliveryMatch && occasionMatch && budgetMatch && dateMatch;
    });
    if (sortFilter.value === "rating") {
      filtered = filtered.sort((a, b) => b.rating - a.rating);
    } else if (sortFilter.value === "price-low") {
      filtered = filtered.sort((a, b) => (a.perPerson * guestCount) - (b.perPerson * guestCount));
    } else if (sortFilter.value === "minimum-low") {
      filtered = filtered.sort((a, b) => a.minimum - b.minimum);
    } else {
      filtered = filtered.sort((a, b) => (b.rating * 10 - b.perPerson) - (a.rating * 10 - a.perPerson));
    }
    resultsCount.textContent = `${filtered.length} restaurant${filtered.length === 1 ? "" : "s"} found`;
    grid.innerHTML = filtered.length
      ? filtered.map((restaurant) => createMarketplaceResult(restaurant, {
        guestCount,
        budgetMode,
        budgetAmount,
      })).join("")
      : `<article class="detail-card"><p class="mini-label">No matches</p><h3>No restaurants matched this search.</h3><p>Try widening the ZIP, increasing budget, or choosing fewer filters.</p></article>`;
  }

  [cuisineFilter, minimumFilter, zipFilter, guestFilter, eventDateFilter, budgetModeFilter, budgetFilter, deliveryModeFilter, occasionFilter, sortFilter]
    .forEach((element) => {
      element.addEventListener("input", updateGrid);
      element.addEventListener("change", updateGrid);
    });
  const favoriteHint = document.querySelector("#favorite-hint");
  if (favoriteHint) {
    favoriteHint.textContent = getSessionUser()?.role === "customer"
      ? `${state.favorites.length} saved`
      : "Sign in as customer to save";
  }
  if (savedSearches) {
    savedSearches.innerHTML = state.savedSearches.length
      ? state.savedSearches.map((search) => `<button class="chip chip-button" type="button" data-apply-search="${search.id}">${search.name}</button>`).join("")
      : "";
    bindSavedSearchButtons(savedSearches);
  }
  if (saveSearchButton && savedSearchName) {
    saveSearchButton.onclick = async () => {
      const sessionUser = getSessionUser();
      if (!sessionUser || sessionUser.role !== "customer") {
        window.alert("Sign in with a customer account to save searches.");
        return;
      }
      saveSearchButton.disabled = true;
      try {
        await fetchJson("/api/saved-searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: savedSearchName.value,
            zip: zipFilter.value,
            cuisine: cuisineFilter.value,
            guests: guestFilter.value,
            budgetMode: budgetModeFilter.value,
            budgetAmount: budgetFilter.value,
            deliveryMode: deliveryModeFilter.value,
            occasion: occasionFilter.value,
            minimum: minimumFilter.value,
            sort: sortFilter.value,
          }),
        });
        savedSearchName.value = "";
        await refreshSavedSearches();
        renderMarketplace();
        renderAccountPage();
      } finally {
        saveSearchButton.disabled = false;
      }
    };
  }
  updateGrid();
  bindFavoriteButtons(grid);
}

function renderRestaurantDetail() {
  const name = document.querySelector("#restaurant-name");
  if (!name) return;

  const params = new URLSearchParams(window.location.search);
  const restaurant = getRestaurantBySlug(params.get("slug"));

  name.textContent = restaurant.name;
  document.title = `${restaurant.name} | GatherTray`;
  document.querySelector("#restaurant-description").textContent = restaurant.description;
  document.querySelector("#restaurant-cuisine").textContent = restaurant.cuisine;
  document.querySelector("#restaurant-neighborhood").textContent = restaurant.neighborhood;
  document.querySelector("#restaurant-delivery").textContent = money(restaurant.deliveryFee);
  document.querySelector("#restaurant-minimum").textContent = money(restaurant.minimum);
  document.querySelector("#restaurant-lead-time").textContent = restaurant.leadTime;
  document.querySelector("#restaurant-setup").textContent = restaurant.setup;
  document.querySelector("#restaurant-website").innerHTML = restaurant.website
    ? `<a href="${restaurant.website}" target="_blank" rel="noreferrer">${restaurant.website.replace(/^https?:\/\//, "")}</a>`
    : "Not provided";
  document.querySelector("#restaurant-blackout-dates").textContent = (restaurant.blackoutDates || []).length ? restaurant.blackoutDates.join(", ") : "None listed";
  document.querySelector("#restaurant-listing-status").textContent = restaurant.listingStatus === "paused"
    ? `Paused${restaurant.pauseReason ? `: ${restaurant.pauseReason}` : ""}`
    : "Active";
  document.querySelector("#restaurant-rating").textContent = `${restaurant.rating} / 5`;
  document.querySelector("#restaurant-reviews").textContent = `${restaurant.reviews}`;
  document.querySelector("#restaurant-radius").textContent = restaurant.deliveryRadius;
  document.querySelector("#restaurant-order-link").href = `./order.html?restaurant=${restaurant.slug}`;
  document.querySelector("#restaurant-tags").innerHTML = restaurant.tags.map((tag) => `<span class="chip">${tag}</span>`).join("");
  const favoriteButton = document.querySelector("#restaurant-favorite-button");
  const favoriteStatus = document.querySelector("#restaurant-favorite-status");
  if (favoriteButton && favoriteStatus) {
    favoriteButton.textContent = isFavorite(restaurant.slug) ? "Saved to favorites" : "Save restaurant";
    favoriteStatus.textContent = isFavorite(restaurant.slug) ? "This restaurant is in your shortlist." : "";
    favoriteButton.onclick = async () => {
      favoriteButton.disabled = true;
      try {
        await handleFavoriteToggle(restaurant.slug);
      } finally {
        favoriteButton.disabled = false;
      }
    };
  }
  const importNote = document.querySelector("#restaurant-import-note");
  if (importNote) {
    importNote.textContent = restaurant.menuImportedAt
      ? `Imported from ${restaurant.menuImportSource || "restaurant website"} on ${formatDateTime(restaurant.menuImportedAt)}. Restaurants can still edit pricing after import.`
      : "Menu package details are curated for GatherTray ordering.";
  }
  document.querySelector("#restaurant-packages").innerHTML = restaurant.packages.map((pkg) => `
    <article class="package-card">
      <p class="mini-label">${restaurant.name}</p>
      <strong>${pkg.name}</strong>
      <p>Designed for ${pkg.serves} guests.</p>
      ${restaurant.menuImportedAt ? `<div class="chip-row"><span class="chip">Website import</span></div>` : ""}
      <h3>Budget matched in quote</h3>
    </article>
  `).join("");
  const recentReviews = document.querySelector("#restaurant-recent-reviews");
  if (recentReviews) {
    recentReviews.innerHTML = (restaurant.recentReviews || []).length
      ? restaurant.recentReviews.map((review) => createReviewCard(review)).join("")
      : `<article class="issue-card"><p class="mini-label">Reviews</p><h3>No recent reviews yet</h3><p>Customer reviews from completed orders will appear here.</p></article>`;
  }
}

function renderOrderBuilder() {
  const form = document.querySelector("#order-form");
  if (!form) return;

  const restaurantSelect = document.querySelector("#restaurant-select");
  const guestCount = document.querySelector("#guest-count");
  const pricePerPerson = document.querySelector("#price-per-person");
  const budgetMode = document.querySelector("#budget-mode");
  const budgetAmount = document.querySelector("#budget-amount");
  const deliveryType = document.querySelector("#delivery-type");
  const eventDate = document.querySelector("#event-date");
  const eventTime = document.querySelector("#event-time");
  const eventType = document.querySelector("#event-type");
  const customerName = document.querySelector("#customer-name");
  const customerEmail = document.querySelector("#customer-email");
  const dietaryNotes = document.querySelector("#dietary-notes");
  const summaryButton = document.querySelector("#summary-button");
  const summaryPanel = document.querySelector("#summary-panel");
  const summaryOutput = document.querySelector("#summary-output");
  const availabilityNotice = document.querySelector("#budget-summary");

  restaurantSelect.innerHTML = state.restaurants
    .map((restaurant) => `<option value="${restaurant.slug}">${restaurant.name}</option>`)
    .join("");

  const params = new URLSearchParams(window.location.search);
  const requestedRestaurant = params.get("restaurant");
  const reorderId = params.get("reorder");
  const sessionUser = getSessionUser();
  if (requestedRestaurant && state.restaurants.some((restaurant) => restaurant.slug === requestedRestaurant)) {
    restaurantSelect.value = requestedRestaurant;
  }
  if (sessionUser && sessionUser.role === "customer") {
    customerName.value = sessionUser.name || "";
    customerEmail.value = sessionUser.email || "";
  }

  if (reorderId && state.orders?.length) {
    const priorOrder = state.orders.find((order) => order.id === reorderId);
    if (priorOrder) {
      restaurantSelect.value = priorOrder.restaurantSlug;
      guestCount.value = priorOrder.guests;
      pricePerPerson.value = Number(priorOrder.perPerson).toFixed(2);
      budgetMode.value = priorOrder.budgetMode || "per-person";
      budgetAmount.value = priorOrder.budgetAmount || "";
      deliveryType.value = priorOrder.deliveryType || "delivery";
      eventDate.value = priorOrder.eventDate || "";
      eventTime.value = priorOrder.eventTime || "12:00";
      eventType.value = priorOrder.eventType || "Office lunch";
      customerName.value = priorOrder.customer || customerName.value;
      customerEmail.value = priorOrder.customerEmail || customerEmail.value;
      dietaryNotes.value = priorOrder.dietaryNotes || "";
    }
  }

  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7);
  eventDate.value = defaultDate.toISOString().slice(0, 10);
  eventTime.value = "12:00";

  function syncPriceFromRestaurant() {
    const restaurant = getRestaurantBySlug(restaurantSelect.value);
    pricePerPerson.value = restaurant.perPerson.toFixed(2);
  }

  function calculate() {
    const restaurant = getRestaurantBySlug(restaurantSelect.value);
    const guests = Math.max(Number(guestCount.value) || 0, 0);
    const budgetValue = Math.max(Number(budgetAmount.value) || 0, 0);
    const suggestedPerPerson = budgetMode.value === "total"
      ? (guests ? budgetValue / guests : restaurant.perPerson)
      : budgetValue;
    const perPerson = Math.max(suggestedPerPerson || restaurant.perPerson || 0, 0);
    pricePerPerson.value = perPerson.toFixed(2);
    const subtotal = guests * perPerson;
    const deliveryFee = deliveryType.value === "delivery" ? restaurant.deliveryFee : 0;
    const serviceFee = getServiceFee(subtotal);
    const processingFee = subtotal * 0.029 + 0.3;
    const customerTotal = subtotal + deliveryFee + serviceFee + processingFee;
    const commissionAmount = subtotal * restaurant.commission;
    const payout = subtotal - commissionAmount;
    const budgetTarget = budgetMode.value === "total" ? budgetValue : budgetValue * guests;
    const budgetDifference = customerTotal - budgetTarget;
    const isAvailable = isRestaurantAvailableOnDate(restaurant, eventDate.value);
    const isLive = isRestaurantLive(restaurant);
    const leadTimeMet = isLeadTimeMet(restaurant, eventDate.value, eventTime.value);

    document.querySelector("#budget-output").textContent =
      budgetMode.value === "total"
        ? `${money(budgetValue)} total`
        : `${money(budgetValue)} / guest`;
    document.querySelector("#suggested-food-output").textContent = guests
      ? `${money(perPerson)} target x ${guests} guests`
      : money(subtotal);
    document.querySelector("#subtotal-output").textContent = money(subtotal);
    document.querySelector("#delivery-output").textContent = money(deliveryFee);
    document.querySelector("#service-output").textContent = money(serviceFee);
    document.querySelector("#processing-output").textContent = money(processingFee);
    document.querySelector("#customer-total-output").textContent = money(customerTotal);
    document.querySelector("#payout-output").textContent = money(payout);
    document.querySelector("#payout-summary").textContent =
      `${Math.round(restaurant.commission * 100)}% commission on food sales. ${money(restaurant.minimum)} order minimum.`;
    document.querySelector("#budget-summary").textContent =
      !isLive
        ? `${restaurant.name} is currently paused and not accepting new orders.${restaurant.pauseReason ? ` ${restaurant.pauseReason}` : ""}`
        : !isAvailable
        ? `${restaurant.name} is marked unavailable on ${eventDate.value}. Choose another date or restaurant.`
        : !leadTimeMet
        ? `${restaurant.name} requires at least ${getLeadTimeHours(restaurant)} hours notice for this event time.`
        : budgetDifference <= 0
        ? `This quote is ${money(Math.abs(budgetDifference))} under the customer budget target.`
        : `This quote is ${money(budgetDifference)} over the customer budget target.`;

    return {
      restaurant,
      guests,
      perPerson,
      budgetMode: budgetMode.value,
      budgetAmount: budgetValue,
      budgetTarget,
      subtotal,
      deliveryFee,
      serviceFee,
      processingFee,
      customerTotal,
      payout,
      isAvailable,
      isLive,
      leadTimeMet,
    };
  }

  restaurantSelect.addEventListener("change", () => {
    syncPriceFromRestaurant();
    calculate();
  });
  form.addEventListener("input", calculate);
  form.addEventListener("change", calculate);

  summaryButton.addEventListener("click", async () => {
    const quote = calculate();
    summaryButton.disabled = true;
    summaryButton.textContent = "Saving request...";

    try {
      if (!quote.isAvailable) {
        throw new Error(`${quote.restaurant.name} is unavailable on ${eventDate.value}`);
      }
      if (!quote.isLive) {
        throw new Error(`${quote.restaurant.name} is currently paused`);
      }
      if (!quote.leadTimeMet) {
        throw new Error(`${quote.restaurant.name} requires at least ${getLeadTimeHours(quote.restaurant)} hours notice`);
      }
      const savedOrder = await fetchJson("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantSlug: quote.restaurant.slug,
          customer: customerName.value,
          customerEmail: customerEmail.value,
          eventDate: eventDate.value,
          eventTime: eventTime.value,
          eventType: eventType.value,
          guests: quote.guests,
          perPerson: quote.perPerson,
          budgetMode: quote.budgetMode,
          budgetAmount: quote.budgetAmount,
          budgetTarget: quote.budgetTarget,
          deliveryType: deliveryType.value,
          dietaryNotes: dietaryNotes.value,
        }),
      });

      summaryOutput.textContent = `Saved order: ${savedOrder.id}
Customer: ${savedOrder.customer}
Restaurant: ${savedOrder.restaurantName}
Event date: ${savedOrder.eventDate}
Event time: ${savedOrder.eventTime || "12:00"}
Event type: ${savedOrder.eventType}
Guest count: ${savedOrder.guests}
Budget target: ${savedOrder.budgetMode === "total" ? `${money(savedOrder.budgetAmount)} total` : `${money(savedOrder.budgetAmount)} / guest`}
Suggested food spend: ${money(savedOrder.subtotal)}
Food subtotal: ${money(savedOrder.subtotal)}
Delivery fee: ${money(savedOrder.deliveryFee)}
Customer total: ${money(savedOrder.customerTotal)}
Restaurant payout: ${money(savedOrder.restaurantPayout)}
Dietary notes: ${savedOrder.dietaryNotes || "None added"}
Status: ${savedOrder.status}

This order is now persisted in the local GatherTray backend and will appear in the dashboard views.`;
      summaryPanel.hidden = false;
    } catch (error) {
      summaryOutput.textContent = `Could not save order: ${error.message}`;
      summaryPanel.hidden = false;
    } finally {
      summaryButton.disabled = false;
      summaryButton.textContent = "Generate request summary";
    }
  });

  syncPriceFromRestaurant();
  calculate();
}

function renderRestaurantDashboard() {
  const metrics = document.querySelector("#restaurant-metrics");
  const orders = document.querySelector("#restaurant-orders");
  const setupStatus = document.querySelector("#restaurant-setup-status");
  if (!metrics || !orders) return;

  const sessionUser = getSessionUser();
  if (!sessionUser || sessionUser.role !== "restaurant" || !sessionUser.restaurantSlug) {
    metrics.innerHTML = "";
    if (setupStatus) setupStatus.innerHTML = "";
    orders.innerHTML = `<article class="detail-card"><p>Restaurant access required. Sign in with a restaurant account to view your scoped dashboard.</p></article>`;
    return;
  }
  const restaurant = getRestaurantBySlug(sessionUser.restaurantSlug);
  const dashboard = sessionUser && sessionUser.restaurantSlug
    ? {
        metrics: {
          monthlyRevenue: state.orders
            .filter((order) => order.restaurantSlug === sessionUser.restaurantSlug)
            .reduce((sum, order) => sum + Number(order.subtotal || 0), 0),
          payoutPending: state.orders
            .filter((order) => order.restaurantSlug === sessionUser.restaurantSlug && order.status !== "Completed")
            .reduce((sum, order) => sum + Number(order.restaurantPayout || 0), 0),
          reorderRate: "37%",
          menuViews: 912,
        },
        incomingOrders: state.orders.filter((order) => order.restaurantSlug === sessionUser.restaurantSlug),
      }
    : state.restaurantDashboard;
  if (!dashboard) return;

  const metricValues = dashboard.metrics;
  metrics.innerHTML = `
    <article class="metric-card"><span>Monthly revenue</span><strong>${money(metricValues.monthlyRevenue)}</strong></article>
    <article class="metric-card"><span>Payout pending</span><strong>${money(metricValues.payoutPending)}</strong></article>
    <article class="metric-card"><span>Reorder rate</span><strong>${metricValues.reorderRate}</strong></article>
    <article class="metric-card"><span>Menu views</span><strong>${metricValues.menuViews}</strong></article>
  `;

  if (setupStatus && restaurant) {
    const setupCards = [
      `
        <article class="issue-card">
          <p class="mini-label">Website connection</p>
          <h3>${restaurant.website ? "Connected" : "Missing website"}</h3>
          <p>${restaurant.website
            ? `Source: <a href="${restaurant.website}" target="_blank" rel="noreferrer">${restaurant.website.replace(/^https?:\/\//, "")}</a>`
            : "Add your restaurant website in the portal so GatherTray can import draft menu pricing."}</p>
          <div class="row-actions">
            <a class="button button-subtle" href="./restaurant-portal.html">Open portal</a>
          </div>
        </article>
      `,
      `
        <article class="issue-card">
          <p class="mini-label">Menu import</p>
          <h3>${restaurant.menuImportCount ? `${restaurant.menuImportCount} items imported` : "Manual menu setup"}</h3>
          <p>${restaurant.menuImportNote || "No website import has been run yet. You can still manage packages manually."}</p>
          ${restaurant.menuImportedAt ? `<span class="chip">Updated ${formatDateTime(restaurant.menuImportedAt)}</span>` : ""}
        </article>
      `,
      `
        <article class="issue-card">
          <p class="mini-label">Next step</p>
          <h3>${restaurant.menuImportCount ? "Review imported pricing" : "Connect website and import"}</h3>
          <p>${restaurant.menuImportCount
            ? "Double-check package names, prices, and serving ranges in the restaurant portal before accepting live demand."
            : "Use the restaurant portal to connect your website or enter packages manually so your marketplace menu is ready."}</p>
          <div class="row-actions">
            <a class="button button-subtle" href="./restaurant-portal.html">Manage listing</a>
            <a class="button button-subtle" href="./restaurant.html?slug=${restaurant.slug}">View public profile</a>
          </div>
        </article>
      `
    ];
    setupStatus.innerHTML = setupCards.join("");
  }

  orders.innerHTML = dashboard.incomingOrders.length
    ? dashboard.incomingOrders.map((order) => `
    <article class="table-row table-row-orders">
      <div><span>Order</span><strong><a href="${orderDetailHref(order.id)}">${order.id}</a></strong></div>
      <div><span>Customer</span><strong>${order.customer}</strong></div>
      <div><span>Guests</span><strong>${order.guests}</strong></div>
      <div><span>Total</span><strong>${money(order.customerTotal || order.total)}</strong></div>
      <div><span>Status</span><strong>${order.status}<br>${order.time || order.timeLabel || order.eventDate}</strong></div>
      ${createOrderActionButtons(order)}
    </article>
  `).join("")
    : `<article class="detail-card"><p>No orders for this restaurant yet.</p></article>`;

  document.querySelectorAll("[data-order-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/orders/${button.dataset.orderStatus}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: button.dataset.nextStatus }),
        });
        await init();
      } catch (_error) {
        button.disabled = false;
      }
    });
  });
}

function renderAdminDashboard() {
  const metrics = document.querySelector("#admin-metrics");
  const issues = document.querySelector("#admin-issues");
  const applications = document.querySelector("#admin-applications");
  const approvedApplications = document.querySelector("#admin-approved-applications");
  const users = document.querySelector("#admin-users");
  const restaurants = document.querySelector("#admin-restaurants");
  const adminOrders = document.querySelector("#admin-orders");
  const emailLog = document.querySelector("#admin-email-log");
  const securitySummary = document.querySelector("#admin-security-summary");
  const securityEvents = document.querySelector("#admin-security-events");
  const backupSummary = document.querySelector("#admin-backup-summary");
  const savedBackups = document.querySelector("#admin-saved-backups");
  const createBackupButton = document.querySelector("#create-backup");
  const backupButton = document.querySelector("#export-backup");
  const backupStatus = document.querySelector("#backup-status");
  const auditLog = document.querySelector("#admin-audit-log");
  const exportButton = document.querySelector("#export-orders");
  const exportStatus = document.querySelector("#export-status");
  const sessionUser = getSessionUser();
  if (!metrics || !issues || !applications || !approvedApplications || !users || !adminOrders || !restaurants || !emailLog || !securitySummary || !securityEvents || !backupSummary || !savedBackups || !auditLog) return;
  if (!sessionUser || sessionUser.role !== "admin" || !state.adminDashboard) {
    applications.innerHTML = `<article class="issue-card"><p class="mini-label">Admin access required</p><h3>Sign in as an admin</h3><p>Use the account page to unlock approvals, user management, and order controls.</p></article>`;
    approvedApplications.innerHTML = "";
    users.innerHTML = "";
    restaurants.innerHTML = "";
    adminOrders.innerHTML = "";
    emailLog.innerHTML = "";
    securitySummary.innerHTML = "";
    securityEvents.innerHTML = "";
    backupSummary.innerHTML = "";
    savedBackups.innerHTML = "";
    auditLog.innerHTML = "";
    issues.innerHTML = "";
    metrics.innerHTML = "";
    if (exportButton) exportButton.disabled = true;
    if (exportStatus) exportStatus.textContent = "";
    if (createBackupButton) createBackupButton.disabled = true;
    if (backupButton) backupButton.disabled = true;
    if (backupStatus) backupStatus.textContent = "";
    return;
  }

  if (exportButton) {
    exportButton.disabled = false;
    exportButton.onclick = async () => {
      exportButton.disabled = true;
      if (exportStatus) exportStatus.textContent = "Preparing export...";
      try {
        await downloadWithSession("/api/export/orders.csv", "gathertray-orders.csv");
        if (exportStatus) exportStatus.textContent = "Downloaded latest order export.";
      } catch (error) {
        if (exportStatus) exportStatus.textContent = error.message;
      } finally {
        exportButton.disabled = false;
      }
    };
  }

  if (createBackupButton) {
    createBackupButton.disabled = false;
    createBackupButton.onclick = async () => {
      createBackupButton.disabled = true;
      if (backupStatus) backupStatus.textContent = "Creating server backup...";
      try {
        const result = await fetchJson("/api/backups", { method: "POST" });
        if (backupStatus) backupStatus.textContent = `Created ${result.backup.filename}.`;
        await init();
      } catch (error) {
        if (backupStatus) backupStatus.textContent = error.message;
      } finally {
        createBackupButton.disabled = false;
      }
    };
  }

  if (backupButton) {
    backupButton.disabled = false;
    backupButton.onclick = async () => {
      backupButton.disabled = true;
      if (backupStatus) backupStatus.textContent = "Preparing backup snapshot...";
      try {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        await downloadWithSession("/api/export/backup.json", `gathertray-backup-${timestamp}.json`);
        if (backupStatus) backupStatus.textContent = "Downloaded sanitized marketplace backup.";
      } catch (error) {
        if (backupStatus) backupStatus.textContent = error.message;
      } finally {
        backupButton.disabled = false;
      }
    };
  }

  const metricValues = state.adminDashboard.metrics;
  metrics.innerHTML = `
    <article class="metric-card"><span>Gross marketplace volume</span><strong>${money(metricValues.gmv)}</strong></article>
    <article class="metric-card"><span>Active restaurants</span><strong>${metricValues.activeRestaurants}</strong></article>
    <article class="metric-card"><span>Paused restaurants</span><strong>${metricValues.pausedRestaurants || 0}</strong></article>
    <article class="metric-card"><span>Open issues</span><strong>${metricValues.openIssues}</strong></article>
    <article class="metric-card"><span>Repeat buyers</span><strong>${metricValues.repeatBuyers}</strong></article>
  `;

  issues.innerHTML = state.adminDashboard.issues.map((issue) => createIssueCard(issue, { showAdminActions: true })).join("");

  const pendingApplications = (state.adminDashboard.applications || []).filter((application) => application.status !== "approved");
  const approvedPartners = (state.adminDashboard.applications || [])
    .filter((application) => application.status === "approved")
    .sort((a, b) => new Date(b.approvedAt || 0).getTime() - new Date(a.approvedAt || 0).getTime())
    .slice(0, 6);
      applications.innerHTML = pendingApplications.length
    ? pendingApplications.map((application) => `
      <article class="issue-card">
        <p class="mini-label">${application.id}</p>
        <h3>${application.businessName}</h3>
        <p>${application.cuisine} in ${application.city}. ${application.packages.length} menu package(s). ${application.documents.length} uploaded document(s). Status: ${application.status}.</p>
        ${application.website ? `<p><strong>Website:</strong> <a href="${application.website}" target="_blank" rel="noreferrer">${application.website.replace(/^https?:\/\//, "")}</a></p>` : ""}
        ${application.website ? `<p><strong>Approval behavior:</strong> GatherTray will try to import draft menu pricing from this website during approval.</p>` : ""}
        ${application.reviewNote ? `<p><strong>Review note:</strong> ${application.reviewNote}</p>` : ""}
        <div class="application-docs">
          ${application.documents.map((doc) => `<span class="chip">${doc.label}: ${doc.name}</span>`).join("")}
        </div>
        ${application.website ? `<div class="detail-card import-preview-card" id="application-preview-${application.id}"><p>Preview the draft menu import before approval.</p></div>` : ""}
        <div class="card-actions">
          <button class="button button-primary" data-approve-application="${application.id}" type="button">${application.website ? "Approve + import" : "Approve restaurant"}</button>
          ${application.website ? `<button class="button button-subtle" data-preview-application-import="${application.id}" data-preview-website="${application.website}" type="button">Preview import</button>` : ""}
          <button class="button button-subtle" data-request-changes="${application.id}" type="button">Request changes</button>
          <button class="button button-subtle" data-reject-application="${application.id}" type="button">Reject</button>
        </div>
      </article>
    `).join("")
    : `<article class="issue-card"><p class="mini-label">Approval queue</p><h3>No pending applications</h3><p>New restaurant submissions will appear here for review and approval.</p></article>`;

  approvedApplications.innerHTML = approvedPartners.length
    ? approvedPartners.map((application) => `
      <article class="issue-card">
        <p class="mini-label">${application.id}</p>
        <h3>${application.businessName}</h3>
        <p>Approved ${formatDateTime(application.approvedAt)}.${application.approvedRestaurantSlug ? ` Listing: ${application.approvedRestaurantSlug}.` : ""}</p>
        ${application.website ? `<p><strong>Website:</strong> <a href="${application.website}" target="_blank" rel="noreferrer">${application.website.replace(/^https?:\/\//, "")}</a></p>` : ""}
        ${application.importStatusNote ? `<p><strong>Import status:</strong> ${application.importStatusNote}</p>` : ""}
        ${application.importedPackageCount ? `<p><strong>Imported packages:</strong> ${application.importedPackageCount}</p>` : `<p><strong>Imported packages:</strong> 0</p>`}
        <div class="row-actions">
          ${application.approvedRestaurantSlug ? `<a class="button button-subtle" href="./restaurant.html?slug=${application.approvedRestaurantSlug}">View listing</a>` : ""}
        </div>
      </article>
    `).join("")
    : `<article class="issue-card"><p class="mini-label">Approved partners</p><h3>No approved restaurants yet</h3><p>Recently approved restaurants will appear here with website import outcomes.</p></article>`;

  document.querySelectorAll("[data-approve-application]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Approving...";
      try {
        const result = await fetchJson(`/api/restaurant-applications/${button.dataset.approveApplication}/approve`, {
          method: "POST",
        });
        if (result.importMessage) {
          button.textContent = "Approved with import";
        }
        await init();
      } catch (error) {
        button.disabled = false;
        button.textContent = `Approve failed`;
      }
    });
  });

  document.querySelectorAll("[data-preview-application-import]").forEach((button) => {
    button.addEventListener("click", async () => {
      const previewCard = document.querySelector(`#application-preview-${button.dataset.previewApplicationImport}`);
      if (!previewCard) return;
      button.disabled = true;
      button.textContent = "Previewing...";
      previewCard.innerHTML = "<p>Fetching draft menu import preview...</p>";
      try {
        const result = await fetchJson("/api/menu-import/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ website: button.dataset.previewWebsite }),
        });
        const previewRows = (result.packages || []).slice(0, 6).map((pkg) => `
          <article class="table-row table-row-orders import-preview-row">
            <div><span>Package</span><strong>${pkg.name}</strong></div>
            <div><span>Price</span><strong>${money(pkg.price)}</strong></div>
            <div><span>Serves</span><strong>${pkg.serves || "Not detected"}</strong></div>
          </article>
        `).join("");
        previewCard.innerHTML = `
          <p class="mini-label">Draft website import</p>
          <h3>${result.packages.length} package${result.packages.length === 1 ? "" : "s"} detected</h3>
          <p>${result.message}</p>
          <div class="table-like">${previewRows}</div>
        `;
      } catch (error) {
        previewCard.innerHTML = `<p>${error.message}</p>`;
      } finally {
        button.disabled = false;
        button.textContent = "Preview import";
      }
    });
  });

  document.querySelectorAll("[data-reject-application]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/restaurant-applications/${button.dataset.rejectApplication}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Not a fit for current launch market" }),
        });
        await init();
      } catch (_error) {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-request-changes]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/restaurant-applications/${button.dataset.requestChanges}/request-changes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "Please upload full compliance documents and clarify menu package serving ranges." }),
        });
        await init();
      } catch (_error) {
        button.disabled = false;
      }
    });
  });

  users.innerHTML = (state.users || []).map((user) => `
    <article class="table-row">
      <div><span>Name</span><strong>${user.name}</strong></div>
      <div><span>Email</span><strong>${user.email}</strong></div>
      <div><span>Role</span><strong>${user.role}</strong></div>
      <div><span>Linked restaurant</span><strong>${user.restaurantSlug || "None"}</strong></div>
      <div><span>User ID</span><strong>${user.id}</strong></div>
    </article>
  `).join("");

  restaurants.innerHTML = (state.restaurants || []).map((restaurant) => `
    <article class="table-row table-row-orders">
      <div><span>Name</span><strong>${restaurant.name}</strong></div>
      <div><span>Cuisine</span><strong>${restaurant.cuisine}</strong></div>
      <div><span>Status</span><strong>${restaurant.listingStatus || "active"}</strong></div>
      <div><span>Website</span><strong>${restaurant.website ? `<a href="${restaurant.website}" target="_blank" rel="noreferrer">Open site</a>` : "None"}</strong></div>
      <div><span>Menu import</span><strong>${restaurant.menuImportCount ? `${restaurant.menuImportCount} items` : "Manual"}</strong></div>
      <div><span>Pause reason</span><strong>${restaurant.pauseReason || "None"}</strong></div>
      <div><span>Blackout dates</span><strong>${(restaurant.blackoutDates || []).length}</strong></div>
      <div class="row-actions">
        <a class="button button-subtle" href="./restaurant.html?slug=${restaurant.slug}">View</a>
        ${restaurant.website ? `<button class="button button-subtle" type="button" data-admin-reimport-restaurant="${restaurant.slug}" data-admin-reimport-website="${restaurant.website}">Re-import menu</button>` : ""}
        ${restaurant.listingStatus === "paused"
          ? `<button class="button button-subtle" type="button" data-restaurant-status="${restaurant.slug}" data-next-restaurant-status="active" data-pause-reason="">Reactivate</button>`
          : `<button class="button button-subtle" type="button" data-restaurant-status="${restaurant.slug}" data-next-restaurant-status="paused" data-pause-reason="Paused by admin ops">Pause</button>`}
      </div>
      <div class="admin-inline-status"><span>Import note</span><strong id="admin-import-note-${restaurant.slug}">${restaurant.menuImportNote || "No import note yet."}</strong></div>
    </article>
  `).join("");

  adminOrders.innerHTML = (state.orders || []).map((order) => `
    <article class="table-row table-row-orders">
      <div><span>Order</span><strong><a href="${orderDetailHref(order.id)}">${order.id}</a></strong></div>
      <div><span>Restaurant</span><strong>${order.restaurantName}</strong></div>
      <div><span>Customer</span><strong>${order.customer}</strong></div>
      <div><span>Total</span><strong>${money(order.customerTotal)}</strong></div>
      <div><span>Status</span><strong>${order.status}</strong></div>
      ${createOrderActionButtons(order)}
    </article>
  `).join("");

  adminOrders.querySelectorAll("[data-order-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/orders/${button.dataset.orderStatus}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: button.dataset.nextStatus }),
        });
        await init();
      } catch (_error) {
        button.disabled = false;
      }
    });
  });

  emailLog.innerHTML = (state.emailLog || []).length
    ? state.emailLog.slice(0, 12).map((email) => `
      <article class="table-row table-row-orders">
        <div><span>Email</span><strong>${email.id}</strong></div>
        <div><span>To</span><strong>${email.to}</strong></div>
        <div><span>Subject</span><strong>${email.subject}</strong></div>
        <div><span>Status</span><strong>${email.status}</strong></div>
        <div><span>Created</span><strong>${formatDateTime(email.createdAt)}</strong></div>
        <div class="row-actions"><span class="chip">Queued</span></div>
      </article>
    `).join("")
    : `<article class="detail-card"><p>No queued emails yet.</p></article>`;

  const securityMeta = state.securitySummary || {};
  securitySummary.innerHTML = `
    <article class="metric-card"><span>Successful sign-ins (${securityMeta.windowHours || 24}h)</span><strong>${securityMeta.successfulLogins || 0}</strong></article>
    <article class="metric-card"><span>Failed sign-ins (${securityMeta.windowHours || 24}h)</span><strong>${securityMeta.failedLogins || 0}</strong></article>
    <article class="metric-card"><span>Rate limits triggered</span><strong>${securityMeta.rateLimited || 0}</strong></article>
    <article class="metric-card"><span>Password changes</span><strong>${securityMeta.passwordChanges || 0}</strong></article>
    <article class="metric-card"><span>Latest auth event</span><strong>${securityMeta.latestEventAt ? formatDateTime(securityMeta.latestEventAt) : "None"}</strong></article>
  `;

  securityEvents.innerHTML = (state.securityEvents || []).length
    ? state.securityEvents.map((entry) => `
      <article class="table-row table-row-orders">
        <div><span>Action</span><strong>${entry.action}</strong></div>
        <div><span>Actor</span><strong>${entry.actorEmail || "Unknown"}<br>${entry.actorRole || "guest"}</strong></div>
        <div><span>Target</span><strong>${entry.targetType || "account"} ${entry.targetId || ""}</strong></div>
        <div><span>When</span><strong>${formatDateTime(entry.createdAt)}</strong></div>
        <div><span>Detail</span><strong>${entry.detail || "No detail"}</strong></div>
        <div class="row-actions"><span class="chip">Security</span></div>
      </article>
    `).join("")
    : `<article class="detail-card"><p>No recent auth security events yet.</p></article>`;

  const backupMeta = state.backupSummary || {};
  const counts = backupMeta.counts || {};
  backupSummary.innerHTML = `
    <article class="issue-card">
      <p class="mini-label">Snapshot timing</p>
      <h3>${backupMeta.generatedAt ? "Backup export ready" : "No backup summary yet"}</h3>
      <p>Generated: ${formatDateTime(backupMeta.generatedAt)}<br>Latest activity: ${formatDateTime(backupMeta.latestActivityAt)}</p>
    </article>
    <article class="issue-card">
      <p class="mini-label">Included data</p>
      <h3>${counts.orders || 0} orders · ${counts.restaurants || 0} restaurants</h3>
      <p>${counts.applications || 0} applications, ${counts.users || 0} users, ${counts.notifications || 0} notifications, and ${counts.auditLogs || 0} audit events are included.</p>
    </article>
    <article class="issue-card">
      <p class="mini-label">Safety</p>
      <h3>Sanitized for ops handoff</h3>
      <p>The backup omits live session tokens and password hashes so it is safer to hand to developers or archive outside the running app.</p>
    </article>
  `;

  savedBackups.innerHTML = (state.savedBackups || []).length
    ? state.savedBackups.map((backup) => `
      <article class="table-row table-row-orders">
        <div><span>File</span><strong>${backup.filename}</strong></div>
        <div><span>Created</span><strong>${formatDateTime(backup.generatedAt)}</strong></div>
        <div><span>Latest activity</span><strong>${formatDateTime(backup.latestActivityAt)}</strong></div>
        <div><span>Size</span><strong>${(Number(backup.sizeBytes || 0) / 1024).toFixed(1)} KB</strong></div>
        <div><span>Counts</span><strong>${backup.counts?.orders || 0} orders · ${backup.counts?.restaurants || 0} restaurants</strong></div>
        <div class="row-actions">
          <button class="button button-subtle" type="button" data-download-saved-backup="${backup.filename}">Download</button>
        </div>
      </article>
    `).join("")
    : `<article class="detail-card"><p>No saved server backups yet. Create one to keep a timestamped marketplace snapshot on disk.</p></article>`;

  auditLog.innerHTML = (state.auditLogs || []).length
    ? state.auditLogs.map((entry) => `
      <article class="table-row table-row-orders">
        <div><span>Action</span><strong>${entry.action}</strong></div>
        <div><span>Actor</span><strong>${entry.actorEmail || "System"}<br>${entry.actorRole || "system"}</strong></div>
        <div><span>Target</span><strong>${entry.targetType} ${entry.targetId}</strong></div>
        <div><span>When</span><strong>${formatDateTime(entry.createdAt)}</strong></div>
        <div><span>Detail</span><strong>${entry.detail || "No detail"}</strong></div>
        <div class="row-actions"><span class="chip">Logged</span></div>
      </article>
    `).join("")
    : `<article class="detail-card"><p>No audit events recorded yet.</p></article>`;

  savedBackups.querySelectorAll("[data-download-saved-backup]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (backupStatus) backupStatus.textContent = `Downloading ${button.dataset.downloadSavedBackup}...`;
      try {
        await downloadWithSession(`/api/backups/${encodeURIComponent(button.dataset.downloadSavedBackup)}`, button.dataset.downloadSavedBackup);
        if (backupStatus) backupStatus.textContent = `Downloaded ${button.dataset.downloadSavedBackup}.`;
        await init();
      } catch (error) {
        if (backupStatus) backupStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });

  restaurants.querySelectorAll("[data-restaurant-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/restaurants/${button.dataset.restaurantStatus}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listingStatus: button.dataset.nextRestaurantStatus,
            pauseReason: button.dataset.pauseReason,
          }),
        });
        await init();
      } catch (_error) {
        button.disabled = false;
      }
    });
  });

  restaurants.querySelectorAll("[data-admin-reimport-restaurant]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slug = button.dataset.adminReimportRestaurant;
      const note = document.querySelector(`#admin-import-note-${slug}`);
      button.disabled = true;
      button.textContent = "Re-importing...";
      if (note) note.textContent = "Refreshing website menu import...";
      try {
        const result = await fetchJson(`/api/restaurants/${slug}/import-menu`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ website: button.dataset.adminReimportWebsite }),
        });
        if (note) note.textContent = result.message;
        await init();
      } catch (error) {
        if (note) note.textContent = error.message;
      } finally {
        button.disabled = false;
        button.textContent = "Re-import menu";
      }
    });
  });

  issues.querySelectorAll("[data-issue-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetchJson(`/api/issues/${button.dataset.issueStatus}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: button.dataset.nextIssueStatus }),
        });
        await init();
      } catch (_error) {
        button.disabled = false;
      }
    });
  });
}

function parsePackages(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, price, serves] = line.split("|").map((part) => (part || "").trim());
      return {
        name,
        price: Number(price || 0),
        serves,
      };
    })
    .filter((pkg) => pkg.name);
}

function splitList(text) {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function packagesToText(packages) {
  return (packages || []).map((pkg) => `${pkg.name} | ${pkg.price} | ${pkg.serves}`).join("\n");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function collectDocuments(definitions) {
  const documents = [];
  for (const definition of definitions) {
    const file = definition.input.files[0];
    if (!file) continue;
    const content = await readFileAsDataUrl(file);
    documents.push({
      label: definition.label,
      name: file.name,
      type: file.type,
      size: file.size,
      content,
    });
  }
  return documents;
}

function renderRestaurantSignup() {
  const form = document.querySelector("#restaurant-signup-form");
  if (!form) return;

  const submitButton = document.querySelector("#restaurant-signup-submit");
  const resultPanel = document.querySelector("#restaurant-signup-result");
  const resultOutput = document.querySelector("#restaurant-signup-output");
  const statusForm = document.querySelector("#restaurant-status-form");
  const statusCard = document.querySelector("#restaurant-status-card");
  const statusResults = document.querySelector("#restaurant-status-results");
  const signupImportButton = document.querySelector("#signup-import-menu");
  const signupImportStatus = document.querySelector("#signup-import-status");

  if (signupImportButton && signupImportStatus && !signupImportButton.dataset.bound) {
    signupImportButton.dataset.bound = "true";
    signupImportButton.addEventListener("click", async () => {
      signupImportButton.disabled = true;
      signupImportButton.textContent = "Importing...";
      try {
        const result = await fetchJson("/api/menu-import/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            website: document.querySelector("#restaurant-website").value,
          }),
        });
        document.querySelector("#restaurant-website").value = result.website || "";
        document.querySelector("#package-lines").value = packagesToText(result.packages || []);
        signupImportStatus.innerHTML = `<p><strong>Import complete.</strong><br>${result.message}</p>`;
      } catch (error) {
        signupImportStatus.innerHTML = `<p>${error.message}</p>`;
      } finally {
        signupImportButton.disabled = false;
        signupImportButton.textContent = "Import draft menu from website";
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    try {
      const documents = await collectDocuments([
        { label: "Menu upload", input: document.querySelector("#menu-file") },
        { label: "W-9", input: document.querySelector("#w9-file") },
        { label: "Insurance / COI", input: document.querySelector("#coi-file") },
        { label: "Health permit", input: document.querySelector("#permit-file") },
      ]);

      const payload = {
        businessName: document.querySelector("#business-name").value,
        ownerName: document.querySelector("#owner-name").value,
        email: document.querySelector("#owner-email").value,
        phone: document.querySelector("#owner-phone").value,
        website: document.querySelector("#restaurant-website").value,
        cuisine: document.querySelector("#cuisine").value,
        city: document.querySelector("#city").value,
        deliveryRadius: document.querySelector("#delivery-radius").value,
        minimumOrder: document.querySelector("#minimum-order").value,
        description: document.querySelector("#restaurant-description-input").value,
        packages: parsePackages(document.querySelector("#package-lines").value),
        documents,
      };

      const application = await fetchJson("/api/restaurant-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      resultOutput.textContent = `Application saved: ${application.id}
Business: ${application.businessName}
Cuisine: ${application.cuisine}
City: ${application.city}
Website: ${application.website || "Not provided"}
Packages submitted: ${application.packages.length}
Documents uploaded: ${application.documents.length}
Status: ${application.status}

This restaurant is now in the admin approval queue.`;
      resultPanel.hidden = false;
      form.reset();
    } catch (error) {
      resultOutput.textContent = `Could not submit application: ${error.message}`;
      resultPanel.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit for approval";
    }
  });

  if (statusForm && statusCard && statusResults) {
    statusForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = document.querySelector("#restaurant-status-submit");
      submit.disabled = true;
      submit.textContent = "Checking...";
      try {
        const email = document.querySelector("#restaurant-status-email").value;
        const applications = await fetchJson(`/api/restaurant-applications/status?email=${encodeURIComponent(email)}`);
        statusCard.innerHTML = `<p>Found ${applications.length} application${applications.length === 1 ? "" : "s"} for ${email}.</p>`;
        statusResults.innerHTML = applications.length
          ? applications.map((application) => createApplicationStatusCard(application)).join("")
          : `<article class="issue-card"><p class="mini-label">No application</p><h3>No application found</h3><p>We couldn’t find a restaurant application for that email address yet.</p></article>`;
      } catch (error) {
        statusCard.innerHTML = `<p>${error.message}</p>`;
        statusResults.innerHTML = "";
      } finally {
        submit.disabled = false;
        submit.textContent = "Check application status";
      }
    });
  }
}

function renderAccountPage() {
  const form = document.querySelector("#login-form");
  if (!form) return;

  const title = document.querySelector("#account-role-title");
  const card = document.querySelector("#account-session-card");
  const sessionSummary = document.querySelector("#account-session-summary");
  const sessionList = document.querySelector("#account-session-list");
  const revokeOthersButton = document.querySelector("#revoke-other-sessions");
  const logoutButton = document.querySelector("#logout-button");
  const profileBlock = document.querySelector("#profile-block");
  const profileForm = document.querySelector("#profile-form");
  const profileName = document.querySelector("#profile-name");
  const profileCard = document.querySelector("#profile-result-card");
  const passwordBlock = document.querySelector("#password-block");
  const passwordForm = document.querySelector("#password-form");
  const passwordCard = document.querySelector("#password-result-card");
  const historyBlock = document.querySelector("#customer-history-block");
  const favoritesBlock = document.querySelector("#favorites-block");
  const favoriteRestaurants = document.querySelector("#favorite-restaurants");
  const savedSearchesBlock = document.querySelector("#saved-searches-block");
  const savedSearchesList = document.querySelector("#saved-searches-list");
  const restaurantAccountBlock = document.querySelector("#restaurant-account-block");
  const restaurantAccountStatus = document.querySelector("#restaurant-account-status");
  const ordersContainer = document.querySelector("#customer-orders");
  const notificationsBlock = document.querySelector("#notifications-block");
  const notificationsContainer = document.querySelector("#account-notifications");
  const notificationSummary = document.querySelector("#notification-summary");
  const markAllReadButton = document.querySelector("#mark-all-notifications-read");
  const signupForm = document.querySelector("#signup-form");
  const signupCard = document.querySelector("#signup-result-card");
  const supportBlock = document.querySelector("#support-block");
  const supportForm = document.querySelector("#support-form");
  const supportOrder = document.querySelector("#support-order");
  const supportIssues = document.querySelector("#support-issues");
  const supportResult = document.querySelector("#support-result-card");

  async function refresh() {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      title.textContent = "Not signed in";
      card.innerHTML = "<p>Sign in to unlock customer, restaurant, or admin tools.</p>";
      if (sessionSummary) sessionSummary.textContent = "Sign in to review and manage active sessions.";
      if (sessionList) sessionList.innerHTML = "";
      if (revokeOthersButton) revokeOthersButton.hidden = true;
      if (profileBlock) profileBlock.hidden = true;
      if (passwordBlock) passwordBlock.hidden = true;
      historyBlock.hidden = true;
      if (favoritesBlock) favoritesBlock.hidden = true;
      if (savedSearchesBlock) savedSearchesBlock.hidden = true;
      if (restaurantAccountBlock) restaurantAccountBlock.hidden = true;
      notificationsBlock.hidden = true;
      if (supportBlock) supportBlock.hidden = true;
      return;
    }

    title.textContent = `${sessionUser.role} account`;
    const links = [];
    if (sessionUser.role === "customer") links.push(`<a class="button button-primary" href="./order.html">Start an order</a>`);
    if (sessionUser.role === "restaurant") links.push(`<a class="button button-primary" href="./restaurant-portal.html">Open restaurant portal</a>`);
    if (sessionUser.role === "admin") links.push(`<a class="button button-primary" href="./admin-dashboard.html">Open admin dashboard</a>`);
    card.innerHTML = `<p><strong>${sessionUser.name}</strong><br>${sessionUser.email}<br>Role: ${sessionUser.role}</p><div class="card-actions">${links.join("")}</div>`;
    const sessionPayload = await fetchJson("/api/account/sessions");
    state.sessions = sessionPayload.sessions || [];
    const otherSessionsCount = state.sessions.filter((item) => !item.isCurrent).length;
    if (sessionSummary) {
      sessionSummary.textContent = otherSessionsCount
        ? `${state.sessions.length} active sessions. ${otherSessionsCount} can be revoked from here.`
        : "Only this browser is signed in right now.";
    }
    if (sessionList) {
      sessionList.innerHTML = state.sessions.length
        ? state.sessions.map((session) => createSessionCard(session)).join("")
        : `<article class="issue-card"><p>No active sessions found.</p></article>`;
    }
    if (revokeOthersButton) {
      revokeOthersButton.hidden = otherSessionsCount === 0;
    }
    if (profileBlock) profileBlock.hidden = false;
    if (passwordBlock) passwordBlock.hidden = false;
    if (profileName) profileName.value = sessionUser.name || "";
    if (profileCard) {
      profileCard.innerHTML = `<p>Signed in as <strong>${sessionUser.name}</strong>.<br>${sessionUser.email}<br>Role: ${sessionUser.role}</p>`;
    }

    if (sessionUser.role === "customer") {
      const orders = await fetchJson(`/api/account/orders?email=${encodeURIComponent(sessionUser.email)}`);
      state.favorites = await fetchJson("/api/favorites");
      state.savedSearches = await fetchJson("/api/saved-searches");
      historyBlock.hidden = false;
      if (favoritesBlock && favoriteRestaurants) {
        favoritesBlock.hidden = false;
        favoriteRestaurants.innerHTML = state.favorites.length
          ? state.favorites.map((restaurant) => createRestaurantCard(restaurant)).join("")
          : `<article class="detail-card"><p>No favorite restaurants yet. Save restaurants from the marketplace to build a shortlist.</p></article>`;
        bindFavoriteButtons(favoriteRestaurants);
      }
      if (savedSearchesBlock && savedSearchesList) {
        savedSearchesBlock.hidden = false;
        savedSearchesList.innerHTML = state.savedSearches.length
          ? state.savedSearches.map((search) => createSavedSearchCard(search, { showDelete: true })).join("")
          : `<article class="issue-card"><p class="mini-label">Saved searches</p><h3>No saved searches yet</h3><p>Save a search from the marketplace to quickly get back to your best-fit restaurants.</p></article>`;
        bindSavedSearchButtons(savedSearchesList);
      }
      ordersContainer.innerHTML = orders.length
        ? orders.map((order) => `
            <article class="table-row table-row-orders">
              <div><span>Order</span><strong><a href="${orderDetailHref(order.id)}">${order.id}</a></strong></div>
              <div><span>Restaurant</span><strong>${order.restaurantName}</strong></div>
              <div><span>Event date</span><strong>${order.eventDate}</strong></div>
              <div><span>Total</span><strong>${money(order.customerTotal)}</strong></div>
              <div><span>Status</span><strong>${order.status}</strong></div>
              <div class="row-actions">
                <a class="button button-subtle" href="${orderDetailHref(order.id)}">View</a>
                <a class="button button-subtle" href="./order.html?restaurant=${order.restaurantSlug}&reorder=${order.id}">Reorder</a>
              </div>
            </article>
          `).join("")
        : `<article class="detail-card"><p>No customer order history yet.</p></article>`;

      if (supportBlock && supportForm && supportOrder && supportIssues && supportResult) {
        supportBlock.hidden = false;
        supportOrder.innerHTML = orders.length
          ? orders.map((order) => `<option value="${order.id}">${order.id} · ${order.restaurantName} · ${order.eventDate}</option>`).join("")
          : `<option value="">No orders available</option>`;
        const issues = await fetchJson("/api/issues");
        supportIssues.innerHTML = issues.length
          ? issues.map((issue) => createIssueCard(issue)).join("")
          : `<article class="issue-card"><p class="mini-label">Support</p><h3>No tickets yet</h3><p>Your open support tickets will appear here.</p></article>`;
      }
      if (restaurantAccountBlock) restaurantAccountBlock.hidden = true;
    } else if (sessionUser.role === "restaurant") {
      historyBlock.hidden = true;
      if (favoritesBlock) favoritesBlock.hidden = true;
      if (savedSearchesBlock) savedSearchesBlock.hidden = true;
      if (supportBlock) supportBlock.hidden = true;
      const restaurant = getRestaurantBySlug(sessionUser.restaurantSlug);
      if (restaurantAccountBlock && restaurantAccountStatus && restaurant) {
        restaurantAccountBlock.hidden = false;
        restaurantAccountStatus.innerHTML = `
          <article class="issue-card">
            <p class="mini-label">Website connection</p>
            <h3>${restaurant.website ? "Connected" : "Missing website"}</h3>
            <p>${restaurant.website
              ? `Source: <a href="${restaurant.website}" target="_blank" rel="noreferrer">${restaurant.website.replace(/^https?:\/\//, "")}</a>`
              : "Add a restaurant website so GatherTray can import draft menu pricing and keep your menu in sync."}</p>
            <div class="row-actions">
              <a class="button button-subtle" href="./restaurant-portal.html">Open portal</a>
            </div>
          </article>
          <article class="issue-card">
            <p class="mini-label">Menu import</p>
            <h3>${restaurant.menuImportCount ? `${restaurant.menuImportCount} items imported` : "Manual menu setup"}</h3>
            <p>${restaurant.menuImportNote || "No website import has been run yet. You can still manage packages manually in the portal."}</p>
            ${restaurant.menuImportedAt ? `<span class="chip">Updated ${formatDateTime(restaurant.menuImportedAt)}</span>` : ""}
          </article>
          <article class="issue-card">
            <p class="mini-label">Listing health</p>
            <h3>${restaurant.listingStatus === "paused" ? "Paused" : "Active"}</h3>
            <p>${restaurant.listingStatus === "paused"
              ? (restaurant.pauseReason || "This listing is currently paused.")
              : `Live in the marketplace with ${(restaurant.blackoutDates || []).length} blackout date${(restaurant.blackoutDates || []).length === 1 ? "" : "s"} configured.`}</p>
            <div class="row-actions">
              <a class="button button-subtle" href="./restaurant.html?slug=${restaurant.slug}">View public profile</a>
              <a class="button button-subtle" href="./restaurant-dashboard.html">Open dashboard</a>
            </div>
          </article>
        `;
      }
    } else {
      historyBlock.hidden = true;
      if (favoritesBlock) favoritesBlock.hidden = true;
      if (savedSearchesBlock) savedSearchesBlock.hidden = true;
      if (restaurantAccountBlock) restaurantAccountBlock.hidden = true;
      if (supportBlock) supportBlock.hidden = true;
    }

    const notifications = await fetchJson("/api/account/notifications");
    const readNotificationIds = getReadNotificationIds(sessionUser.email);
    const unreadCount = notifications.filter((item) => !readNotificationIds.includes(item.id)).length;
    notificationsBlock.hidden = false;
    if (notificationSummary) {
      notificationSummary.textContent = unreadCount
        ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"} across orders, support, and approvals.`
        : "Everything is read. New order, support, and approval updates will appear here.";
    }
    if (markAllReadButton) {
      markAllReadButton.hidden = notifications.length === 0 || unreadCount === 0;
    }
    notificationsContainer.innerHTML = notifications.length
      ? notifications.map((item) => createNotificationCard(item, { isRead: readNotificationIds.includes(item.id) })).join("")
      : `<article class="issue-card"><p class="mini-label">Notifications</p><h3>No notifications yet</h3><p>Order and approval activity will appear here.</p></article>`;
  }

  if (notificationsContainer) {
    notificationsContainer.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-toggle-notification-read]");
      if (!toggle) return;
      const sessionUser = getSessionUser();
      if (!sessionUser) return;
      const notificationId = toggle.dataset.toggleNotificationRead;
      const isRead = toggle.dataset.notificationRead === "true";
      const current = getReadNotificationIds(sessionUser.email);
      const next = isRead
        ? current.filter((id) => id !== notificationId)
        : [...new Set([...current, notificationId])];
      setReadNotificationIds(sessionUser.email, next);
      await refresh();
    });

    notificationsContainer.addEventListener("click", (event) => {
      const link = event.target.closest("[data-read-notification]");
      if (!link) return;
      const sessionUser = getSessionUser();
      if (!sessionUser) return;
      const notificationId = link.dataset.readNotification;
      const current = getReadNotificationIds(sessionUser.email);
      if (!current.includes(notificationId)) {
        setReadNotificationIds(sessionUser.email, [...current, notificationId]);
      }
    });
  }

  if (markAllReadButton) {
    markAllReadButton.addEventListener("click", async () => {
      const sessionUser = getSessionUser();
      if (!sessionUser) return;
      const notifications = await fetchJson("/api/account/notifications");
      setReadNotificationIds(sessionUser.email, notifications.map((item) => item.id));
      await refresh();
    });
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = document.querySelector("#login-submit");
    submit.disabled = true;
    submit.textContent = "Signing in...";
    try {
      const user = await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.querySelector("#login-email").value,
          password: document.querySelector("#login-password").value,
        }),
      });
      setSessionUser(user);
      form.reset();
      await refresh();
    } catch (error) {
      card.innerHTML = `<p>${error.message}</p>`;
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  };

  logoutButton.onclick = async () => {
    try {
      await fetchJson("/api/auth/logout", { method: "POST" });
    } catch (_error) {
    }
    clearSessionUser();
    await refresh();
  };

  if (card) {
    card.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-revoke-session]");
      if (!button) return;
      const sessionUser = getSessionUser();
      if (!sessionUser) return;
      button.disabled = true;
      try {
        await fetchJson(`/api/account/sessions/${encodeURIComponent(button.dataset.revokeSession)}/revoke`, {
          method: "POST",
        });
        const currentSession = state.sessions.find((item) => item.id === button.dataset.revokeSession && item.isCurrent);
        if (currentSession) {
          clearSessionUser();
          await refresh();
          return;
        }
        await refresh();
      } catch (error) {
        card.insertAdjacentHTML("beforeend", `<p>${error.message}</p>`);
      } finally {
        button.disabled = false;
      }
    });
  }

  if (revokeOthersButton) {
    revokeOthersButton.addEventListener("click", async () => {
      revokeOthersButton.disabled = true;
      revokeOthersButton.textContent = "Revoking...";
      try {
        await fetchJson("/api/account/sessions/revoke-others", { method: "POST" });
        await refresh();
      } catch (error) {
        if (sessionSummary) sessionSummary.textContent = error.message;
      } finally {
        revokeOthersButton.disabled = false;
        revokeOthersButton.textContent = "Sign out other sessions";
      }
    });
  }

  if (signupForm && signupCard) {
    signupForm.onsubmit = async (event) => {
      event.preventDefault();
      const submit = document.querySelector("#signup-submit");
      submit.disabled = true;
      submit.textContent = "Creating...";
      try {
      const user = await fetchJson("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: document.querySelector("#signup-name").value,
            email: document.querySelector("#signup-email").value,
            password: document.querySelector("#signup-password").value,
            role: document.querySelector("#signup-role").value,
          }),
        });
        signupCard.innerHTML = `<p>Created ${user.role} account for <strong>${user.name}</strong>.<br>${user.email}</p>`;
        signupForm.reset();
        if (getSessionUser()?.role === "admin") {
          state.users = await fetchJson("/api/users");
        }
      } catch (error) {
        signupCard.innerHTML = `<p>${error.message}</p>`;
      } finally {
        submit.disabled = false;
        submit.textContent = "Create account";
      }
    };
  }

  if (supportForm && supportResult) {
    supportForm.onsubmit = async (event) => {
      event.preventDefault();
      const submit = document.querySelector("#support-submit");
      submit.disabled = true;
      submit.textContent = "Opening...";
      try {
        const issue = await fetchJson("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order: supportOrder.value,
            priority: document.querySelector("#support-priority").value,
            issue: document.querySelector("#support-issue").value,
          }),
        });
        supportResult.innerHTML = `<p>Opened support ticket <strong>${issue.id}</strong> for order ${issue.order}. Status: ${issue.status}.</p>`;
        supportForm.reset();
        await refresh();
      } catch (error) {
        supportResult.innerHTML = `<p>${error.message}</p>`;
      } finally {
        submit.disabled = false;
        submit.textContent = "Open support ticket";
      }
    };
  }

  if (profileForm && profileCard && profileName) {
    profileForm.onsubmit = async (event) => {
      event.preventDefault();
      const submit = document.querySelector("#profile-submit");
      submit.disabled = true;
      submit.textContent = "Saving...";
      try {
        const user = await fetchJson("/api/account", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileName.value,
          }),
        });
        const session = JSON.parse(window.localStorage.getItem("gathertray_session") || "null");
        if (session) {
          session.user = user;
          setSessionUser(session);
        }
        profileCard.innerHTML = `<p>Saved profile for <strong>${user.name}</strong>.<br>${user.email}</p>`;
        await refresh();
      } catch (error) {
        profileCard.innerHTML = `<p>${error.message}</p>`;
      } finally {
        submit.disabled = false;
        submit.textContent = "Save profile";
      }
    };
  }

  if (passwordForm && passwordCard) {
    passwordForm.onsubmit = async (event) => {
      event.preventDefault();
      const submit = document.querySelector("#password-submit");
      const currentPassword = document.querySelector("#current-password");
      const newPassword = document.querySelector("#new-password");
      const confirmPassword = document.querySelector("#confirm-password");
      if (newPassword.value !== confirmPassword.value) {
        passwordCard.innerHTML = "<p>New password and confirmation must match.</p>";
        return;
      }

      submit.disabled = true;
      submit.textContent = "Updating...";
      try {
        const result = await fetchJson("/api/account/password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: currentPassword.value,
            newPassword: newPassword.value,
          }),
        });
        const session = JSON.parse(window.localStorage.getItem("gathertray_session") || "null");
        if (session) {
          session.user = result.user;
          setSessionUser(session);
        }
        passwordCard.innerHTML = "<p>Password updated successfully.</p>";
        passwordForm.reset();
        await refresh();
      } catch (error) {
        passwordCard.innerHTML = `<p>${error.message}</p>`;
      } finally {
        submit.disabled = false;
        submit.textContent = "Update password";
      }
    };
  }

  refresh();
}

async function renderOrderDetail() {
  const grid = document.querySelector("#order-detail-grid");
  const notes = document.querySelector("#order-detail-notes");
  const title = document.querySelector("#order-detail-title");
  const subtitle = document.querySelector("#order-detail-subtitle");
  const issueForm = document.querySelector("#order-issue-form");
  const issueList = document.querySelector("#order-issues-list");
  const reviewForm = document.querySelector("#order-review-form");
  const reviewStatus = document.querySelector("#order-review-status");
  const timelineList = document.querySelector("#order-timeline-list");
  if (!grid || !notes || !title || !subtitle) return;

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("id");
  if (!orderId) {
    title.textContent = "Order not found";
    subtitle.textContent = "No order ID was provided in the page URL.";
    grid.innerHTML = `<article class="detail-card full-width"><p>Open this page from an order link in your account or dashboard.</p></article>`;
    notes.innerHTML = `<p>No notes available.</p>`;
    return;
  }

  try {
    const order = await fetchJson(`/api/orders/${encodeURIComponent(orderId)}`);
    const sessionUser = getSessionUser();
    title.textContent = order.id;
    subtitle.textContent = `${order.restaurantName} for ${order.customer}. ${order.status} as of ${formatDateTime(order.updatedAt || order.createdAt)}.`;

    const quickLinks = [];
    if (sessionUser?.role === "customer") quickLinks.push(`<a class="button button-subtle" href="./order.html?restaurant=${order.restaurantSlug}&reorder=${order.id}">Reorder</a>`);
    if (sessionUser?.role === "restaurant") quickLinks.push(`<a class="button button-subtle" href="./restaurant-dashboard.html">Back to dashboard</a>`);
    if (sessionUser?.role === "admin") quickLinks.push(`<a class="button button-subtle" href="./admin-dashboard.html">Back to ops</a>`);

    grid.innerHTML = `
      <div><span>Restaurant</span><strong>${order.restaurantName}</strong></div>
      <div><span>Customer</span><strong>${order.customer || "Not provided"}</strong></div>
      <div><span>Customer email</span><strong>${order.customerEmail || "Not provided"}</strong></div>
      <div><span>Event date</span><strong>${order.eventDate || "Not set"}</strong></div>
      <div><span>Event type</span><strong>${order.eventType || "Not set"}</strong></div>
      <div><span>Guest count</span><strong>${order.guests || 0}</strong></div>
      <div><span>Delivery type</span><strong>${order.deliveryType || "delivery"}</strong></div>
      <div><span>Budget</span><strong>${order.budgetMode === "total" ? `${money(order.budgetAmount)} total` : `${money(order.budgetAmount)} / guest`}</strong></div>
      <div><span>Food subtotal</span><strong>${money(order.subtotal)}</strong></div>
      <div><span>Customer total</span><strong>${money(order.customerTotal)}</strong></div>
      <div><span>Restaurant payout</span><strong>${money(order.restaurantPayout)}</strong></div>
      <div><span>Status</span><strong>${order.status}</strong></div>
      <div><span>Created</span><strong>${formatDateTime(order.createdAt)}</strong></div>
      <div><span>Updated</span><strong>${formatDateTime(order.updatedAt)}</strong></div>
      <div><span>Quick actions</span><strong class="detail-actions">${quickLinks.join("") || "No quick actions available"}</strong></div>
    `;

    notes.innerHTML = `
      <p><strong>Dietary notes</strong></p>
      <p>${order.dietaryNotes || "No dietary notes were added to this order."}</p>
      <p><strong>Budget target</strong></p>
      <p>${money(order.budgetTarget || 0)}</p>
      <p><strong>Internal timing label</strong></p>
      <p>${order.timeLabel || order.time || order.eventDate || "No timing label yet."}</p>
    `;

    const issues = (await fetchJson("/api/issues")).filter((issue) => issue.order === order.id);
    if (issueList) {
      issueList.innerHTML = issues.length
        ? issues.map((issue) => createIssueCard(issue, { showAdminActions: getSessionUser()?.role === "admin" })).join("")
        : `<p>No support tickets have been opened for this order yet.</p>`;

      issueList.querySelectorAll("[data-issue-status]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await fetchJson(`/api/issues/${button.dataset.issueStatus}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: button.dataset.nextIssueStatus }),
            });
            await renderOrderDetail();
          } catch (_error) {
            button.disabled = false;
          }
        });
      });
    }

    const notifications = await fetchJson("/api/account/notifications");
    const reviews = await fetchJson(`/api/reviews?restaurantSlug=${encodeURIComponent(order.restaurantSlug)}`);
    const existingReview = reviews.find((review) => review.orderId === order.id);
    if (timelineList) {
      const timeline = buildOrderTimelineEvents(order, issues, existingReview, notifications);
      timelineList.innerHTML = timeline.length
        ? timeline.map((item) => createTimelineCard(item)).join("")
        : `<article class="issue-card"><p class="mini-label">Activity</p><h3>No timeline events yet</h3><p>Order activity will appear here as the request progresses.</p></article>`;
    }

    if (issueForm) {
      const submit = document.querySelector("#order-issue-submit");
      issueForm.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = "Opening...";
        try {
          await fetchJson("/api/issues", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order: order.id,
              priority: document.querySelector("#order-issue-priority").value,
              issue: document.querySelector("#order-issue-text").value,
            }),
          });
          document.querySelector("#order-issue-text").value = "";
          await renderOrderDetail();
        } catch (error) {
          notes.innerHTML += `<p><strong>Support error</strong><br>${error.message}</p>`;
        } finally {
          submit.disabled = false;
          submit.textContent = "Open support ticket for this order";
        }
      };
    }

    if (reviewForm && reviewStatus) {
      const sessionUser = getSessionUser();
      const canReview = sessionUser?.role === "customer" && order.status === "Completed" && sessionUser.email === order.customerEmail;

      if (existingReview) {
        reviewStatus.innerHTML = `<p><strong>Review submitted</strong><br>${existingReview.rating} / 5<br>${existingReview.comment || "No written comment."}</p>`;
        reviewForm.hidden = true;
      } else if (!canReview) {
        reviewStatus.innerHTML = `<p>Only the customer on a completed order can leave a review.</p>`;
        reviewForm.hidden = true;
      } else {
        reviewStatus.innerHTML = `<p>This completed order is ready for customer feedback.</p>`;
        reviewForm.hidden = false;
        const submit = document.querySelector("#order-review-submit");
        reviewForm.onsubmit = async (event) => {
          event.preventDefault();
          submit.disabled = true;
          submit.textContent = "Submitting...";
          try {
            const review = await fetchJson("/api/reviews", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: order.id,
                rating: document.querySelector("#order-review-rating").value,
                comment: document.querySelector("#order-review-comment").value,
              }),
            });
            reviewStatus.innerHTML = `<p><strong>Review submitted</strong><br>${review.rating} / 5<br>${review.comment || "No written comment."}</p>`;
            reviewForm.hidden = true;
          } catch (error) {
            reviewStatus.innerHTML = `<p>${error.message}</p>`;
          } finally {
            submit.disabled = false;
            submit.textContent = "Submit review";
          }
        };
      }
    }
  } catch (error) {
    title.textContent = "Protected order";
    subtitle.textContent = "This order is only visible to the right customer, restaurant, or admin account.";
    grid.innerHTML = `<article class="detail-card full-width"><p>${error.message}</p></article>`;
    notes.innerHTML = `<p>Sign in on the account page with the correct role and try again.</p>`;
    if (issueList) issueList.innerHTML = `<p>Support queue unavailable.</p>`;
    if (reviewStatus) reviewStatus.innerHTML = `<p>Review status unavailable.</p>`;
    if (timelineList) timelineList.innerHTML = `<article class="issue-card"><p class="mini-label">Timeline unavailable</p><h3>Order activity could not be loaded</h3><p>Sign in with the correct account and try again.</p></article>`;
  }
}

function renderRestaurantPortal() {
  const form = document.querySelector("#restaurant-portal-form");
  if (!form) return;

  const sessionUser = getSessionUser();
  const title = document.querySelector("#portal-title");
  const statusCard = document.querySelector("#portal-status-card");

  if (!sessionUser || sessionUser.role !== "restaurant" || !sessionUser.restaurantSlug) {
    statusCard.innerHTML = `<p>Restaurant access required. Sign in with a restaurant account on the Account page to manage a live listing.</p>`;
    form.querySelectorAll("input, textarea, button").forEach((element) => {
      element.disabled = true;
    });
    return;
  }

  const restaurant = getRestaurantBySlug(sessionUser.restaurantSlug);
  title.textContent = restaurant.name;
  statusCard.innerHTML = `<p>Signed in as ${sessionUser.name}. Update your marketplace profile and menu details below.</p>`;

  document.querySelector("#portal-website").value = restaurant.website || "";
  document.querySelector("#portal-description").value = restaurant.description || "";
  document.querySelector("#portal-neighborhood").value = restaurant.neighborhood || "";
  document.querySelector("#portal-lead-time").value = restaurant.leadTime || "";
  document.querySelector("#portal-lead-time-hours").value = restaurant.leadTimeHours || getLeadTimeHours(restaurant);
  document.querySelector("#portal-setup").value = restaurant.setup || "";
  document.querySelector("#portal-delivery-radius").value = restaurant.deliveryRadius || "";
  document.querySelector("#portal-minimum").value = restaurant.minimum || "";
  document.querySelector("#portal-delivery-fee").value = restaurant.deliveryFee || "";
  document.querySelector("#portal-per-person").value = restaurant.perPerson || "";
  document.querySelector("#portal-zips").value = (restaurant.zipCodes || []).join(", ");
  document.querySelector("#portal-delivery-modes").value = (restaurant.deliveryModes || []).join(", ");
  document.querySelector("#portal-occasions").value = (restaurant.occasions || []).join(", ");
  document.querySelector("#portal-blackout-dates").value = (restaurant.blackoutDates || []).join(", ");
  document.querySelector("#portal-listing-status").value = restaurant.listingStatus || "active";
  document.querySelector("#portal-pause-reason").value = restaurant.pauseReason || "";
  document.querySelector("#portal-packages").value = packagesToText(restaurant.packages);
  const importStatus = document.querySelector("#portal-import-status");
  if (importStatus) {
    importStatus.innerHTML = restaurant.menuImportedAt
      ? `<p><strong>Last import:</strong> ${formatDateTime(restaurant.menuImportedAt)}<br><strong>Source:</strong> ${restaurant.menuImportSource || "Restaurant website"}<br>${restaurant.menuImportNote || "Imported menu data is ready to review and edit."}</p>`
      : `<p>Add your website and import menu items with pricing. You can edit the imported pricing before saving.</p>`;
  }

  const importButton = document.querySelector("#portal-import-menu");
  if (importButton && !importButton.dataset.bound) {
    importButton.dataset.bound = "true";
    importButton.addEventListener("click", async () => {
      importButton.disabled = true;
      importButton.textContent = "Importing...";
      try {
        const result = await fetchJson(`/api/restaurants/${restaurant.slug}/import-menu`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            website: document.querySelector("#portal-website").value,
          }),
        });
        document.querySelector("#portal-website").value = result.website || "";
        document.querySelector("#portal-packages").value = packagesToText(result.packages || []);
        if (result.restaurant) {
          document.querySelector("#portal-per-person").value = result.restaurant.perPerson || "";
        }
        if (importStatus) {
          importStatus.innerHTML = `<p><strong>Import complete.</strong><br>${result.message}</p>`;
        }
      } catch (error) {
        if (importStatus) {
          importStatus.innerHTML = `<p>${error.message}</p>`;
        }
      } finally {
        importButton.disabled = false;
        importButton.textContent = "Import menu from website";
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = document.querySelector("#portal-save");
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      const updated = await fetchJson(`/api/restaurants/${restaurant.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: document.querySelector("#portal-website").value,
          description: document.querySelector("#portal-description").value,
          neighborhood: document.querySelector("#portal-neighborhood").value,
          leadTime: document.querySelector("#portal-lead-time").value,
          leadTimeHours: document.querySelector("#portal-lead-time-hours").value,
          setup: document.querySelector("#portal-setup").value,
          deliveryRadius: document.querySelector("#portal-delivery-radius").value,
          minimum: document.querySelector("#portal-minimum").value,
          deliveryFee: document.querySelector("#portal-delivery-fee").value,
          perPerson: document.querySelector("#portal-per-person").value,
          zipCodes: splitList(document.querySelector("#portal-zips").value),
          deliveryModes: splitList(document.querySelector("#portal-delivery-modes").value),
          occasions: splitList(document.querySelector("#portal-occasions").value),
          blackoutDates: splitDateList(document.querySelector("#portal-blackout-dates").value),
          listingStatus: document.querySelector("#portal-listing-status").value,
          pauseReason: document.querySelector("#portal-pause-reason").value,
          packages: parsePackages(document.querySelector("#portal-packages").value),
        }),
      });
      statusCard.innerHTML = `<p>Saved updates for ${updated.name}. The marketplace listing is refreshed locally.</p>`;
      await init();
    } catch (error) {
      statusCard.innerHTML = `<p>${error.message}</p>`;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save restaurant updates";
    }
  });
}

async function init() {
  try {
    const bootstrap = await fetchJson("/api/bootstrap");
    state = bootstrap;
    renderMarketplace();
    renderRestaurantDetail();
    renderOrderBuilder();
    renderRestaurantSignup();
    renderRestaurantDashboard();
    renderAdminDashboard();
    renderAccountPage();
    renderRestaurantPortal();
    await renderOrderDetail();
  } catch (error) {
    const main = document.querySelector("main");
    if (main) {
      const errorBanner = document.createElement("section");
      errorBanner.className = "section-block";
      errorBanner.innerHTML = `<article class="detail-card"><p class="mini-label">Backend required</p><h3>GatherTray could not connect to the local API.</h3><p>${error.message}. Start the app with <code>ruby server.rb</code> and then open <code>http://127.0.0.1:4567</code>.</p></article>`;
      main.prepend(errorBanner);
    }
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

init();
