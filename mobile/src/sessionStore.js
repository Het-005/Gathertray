import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "gathertray_mobile_session";
const FILTERS_KEY = "gathertray_mobile_filters";
const ORDER_DRAFT_KEY = "gathertray_mobile_order_draft";
const READ_NOTIFICATIONS_KEY = "gathertray_mobile_read_notifications";

export async function saveSession(session) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function saveFilters(filters) {
  await SecureStore.setItemAsync(FILTERS_KEY, JSON.stringify(filters));
}

export async function loadFilters() {
  const raw = await SecureStore.getItemAsync(FILTERS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveOrderDraft(orderDraft) {
  await SecureStore.setItemAsync(ORDER_DRAFT_KEY, JSON.stringify(orderDraft));
}

export async function loadOrderDraft() {
  const raw = await SecureStore.getItemAsync(ORDER_DRAFT_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveReadNotifications(notificationIds) {
  await SecureStore.setItemAsync(READ_NOTIFICATIONS_KEY, JSON.stringify(notificationIds));
}

export async function loadReadNotifications() {
  const raw = await SecureStore.getItemAsync(READ_NOTIFICATIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}
