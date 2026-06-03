const DEFAULT_BASE_URL = "http://127.0.0.1:4567";

let authToken = null;

export function getBaseUrl() {
  return DEFAULT_BASE_URL;
}

export function setAuthToken(token) {
  authToken = token;
}

export function clearAuthToken() {
  authToken = null;
}

export async function apiRequest(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(payload.error || payload || `Request failed: ${response.status}`);
  }

  return payload;
}

export function login(email, password) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function bootstrap() {
  return apiRequest("/api/bootstrap");
}

export function getAccountOrders(email) {
  return apiRequest(`/api/account/orders?email=${encodeURIComponent(email)}`);
}

export function getNotifications() {
  return apiRequest("/api/account/notifications");
}

export function getAccount() {
  return apiRequest("/api/account");
}

export function updateAccountProfile(payload) {
  return apiRequest("/api/account", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function updateAccountPassword(payload) {
  return apiRequest("/api/account/password", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getFavorites() {
  return apiRequest("/api/favorites");
}

export function getSavedSearches() {
  return apiRequest("/api/saved-searches");
}

export function createSavedSearch(payload) {
  return apiRequest("/api/saved-searches", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteSavedSearch(searchId) {
  return apiRequest(`/api/saved-searches/${encodeURIComponent(searchId)}`, {
    method: "DELETE"
  });
}

export function toggleFavorite(restaurantSlug) {
  return apiRequest("/api/favorites", {
    method: "POST",
    body: JSON.stringify({ restaurantSlug })
  });
}

export function createOrder(payload) {
  return apiRequest("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateOrderStatus(orderId, status) {
  return apiRequest(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "PUT",
    body: JSON.stringify({ status })
  });
}

export function getIssues() {
  return apiRequest("/api/issues");
}

export function createIssue(payload) {
  return apiRequest("/api/issues", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getReviews(restaurantSlug) {
  return apiRequest(`/api/reviews?restaurantSlug=${encodeURIComponent(restaurantSlug)}`);
}

export function createReview(payload) {
  return apiRequest("/api/reviews", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
