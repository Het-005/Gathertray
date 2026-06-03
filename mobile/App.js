import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import {
  bootstrap,
  clearAuthToken,
  createOrder,
  createIssue,
  createReview,
  getAccount,
  getAccountOrders,
  getBaseUrl,
  getFavorites,
  getIssues,
  getNotifications,
  getReviews,
  getSavedSearches,
  login,
  setAuthToken,
  toggleFavorite,
  updateAccountPassword,
  updateAccountProfile,
  updateOrderStatus,
  createSavedSearch,
  deleteSavedSearch
} from "./src/api";
import {
  clearSession,
  loadFilters,
  loadOrderDraft,
  loadReadNotifications,
  loadSession,
  saveFilters,
  saveOrderDraft,
  saveReadNotifications,
  saveSession
} from "./src/sessionStore";
import { theme } from "./src/theme";

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getServiceFee(subtotal) {
  if (subtotal < 250) return 9;
  if (subtotal < 600) return 12;
  if (subtotal < 1200) return 19;
  return 29;
}

function Pill({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Card({ children }) {
  return <View style={styles.card}>{children}</View>;
}

function SectionTitle({ eyebrow, title, body }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionHeading}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

function EmptyState({ title, body }) {
  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </Card>
  );
}

function buildTimelineEvents(order, issues, review, notifications) {
  if (!order) return [];

  const events = [
    {
      id: `${order.id}-created`,
      title: "Order created",
      detail: `${order.customer || "Customer"} submitted the request.`,
      at: order.createdAt || order.eventDate
    },
    {
      id: `${order.id}-status`,
      title: `Status: ${order.status}`,
      detail: `Latest order state for ${order.restaurantName}.`,
      at: order.updatedAt || order.createdAt || order.eventDate
    },
    {
      id: `${order.id}-event`,
      title: "Event scheduled",
      detail: `${order.eventDate || "Date TBD"}${order.eventTime ? ` at ${order.eventTime}` : ""}`,
      at: order.eventDate
    }
  ];

  issues.forEach((issue) => {
    events.push({
      id: issue.id,
      title: `Support ticket ${issue.id}`,
      detail: `${issue.status} • ${issue.priority} • ${issue.issue}`,
      at: issue.updatedAt || issue.createdAt
    });
  });

  if (review) {
    events.push({
      id: review.id,
      title: "Customer review submitted",
      detail: `${review.rating} / 5${review.comment ? ` • ${review.comment}` : ""}`,
      at: review.createdAt
    });
  }

  notifications
    .filter((item) => notificationMatchesOrder(item, order.id))
    .forEach((item) => {
      events.push({
        id: item.id,
        title: item.title,
        detail: item.body,
        at: item.createdAt
      });
    });

  return events
    .sort((a, b) => {
      const aTime = new Date(a.at || 0).getTime();
      const bTime = new Date(b.at || 0).getTime();
      return bTime - aTime;
    });
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

export default function App() {
  const [activeTab, setActiveTab] = useState("marketplace");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [session, setSession] = useState(null);
  const [bootstrapData, setBootstrapData] = useState({ restaurants: [], orders: [] });
  const [accountOrders, setAccountOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [readNotificationIds, setReadNotificationIds] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [issues, setIssues] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [filters, setFilters] = useState({
    zip: "",
    cuisine: "all",
    guests: "24",
    budgetMode: "total",
    budgetAmount: "375"
  });
  const [form, setForm] = useState({
    email: "buyer@gathertray.local",
    password: "buyer123"
  });
  const [profileForm, setProfileForm] = useState({
    name: ""
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [savedSearchName, setSavedSearchName] = useState("");
  const [issueForm, setIssueForm] = useState({
    priority: "Medium",
    issue: ""
  });
  const [reviewForm, setReviewForm] = useState({
    rating: "5",
    comment: ""
  });
  const [orderForm, setOrderForm] = useState({
    restaurantSlug: "",
    guests: "24",
    budgetMode: "total",
    budgetAmount: "375",
    eventDate: "2026-04-29",
    eventTime: "12:00",
    eventType: "Office lunch",
    deliveryType: "delivery",
    customerName: "Buyer User",
    customerEmail: "buyer@gathertray.local",
    dietaryNotes: ""
  });

  async function loadBootstrap(options = {}) {
    const setLoadState = options.background ? setRefreshing : setLoading;
    setLoadState(true);
    setError("");
    try {
      const data = await bootstrap();
      setBootstrapData(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadState(false);
    }
  }

  async function restoreSession() {
    setLoading(true);
    setError("");
    try {
      const storedSession = await loadSession();
      const storedFilters = await loadFilters();
      const storedOrderDraft = await loadOrderDraft();
      const storedReadNotifications = await loadReadNotifications();
      if (storedFilters) setFilters((current) => ({ ...current, ...storedFilters }));
      if (storedOrderDraft) setOrderForm((current) => ({ ...current, ...storedOrderDraft }));
      setReadNotificationIds(storedReadNotifications);
      if (!storedSession?.token) {
        await loadBootstrap();
        return;
      }

      setAuthToken(storedSession.token);
      const account = await getAccount();
      const restoredSession = {
        token: storedSession.token,
        user: account
      };
      setSession(restoredSession);
      setProfileForm({ name: account.name || "" });
      await saveSession(restoredSession);
      await loadBootstrap();
      await loadAccountData(account);
    } catch (requestError) {
      clearAuthToken();
      await clearSession();
      setSession(null);
      await loadBootstrap();
      setError("Saved mobile session expired. Please sign in again.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAccountData(user) {
    if (!user) {
      setAccountOrders([]);
      setNotifications([]);
      setFavorites([]);
      setIssues([]);
      setReviews([]);
      return;
    }

    try {
      const [inbox, visibleIssues] = await Promise.all([
        getNotifications(),
        getIssues()
      ]);
      setNotifications(inbox);
      setIssues(visibleIssues);

      if (user.role === "customer") {
        const [orders, savedFavorites, remoteSavedSearches] = await Promise.all([
          getAccountOrders(user.email),
          getFavorites(),
          getSavedSearches()
        ]);
        setAccountOrders(orders);
        setFavorites(savedFavorites);
        setSavedSearches(remoteSavedSearches);
      } else {
        setAccountOrders([]);
        setFavorites([]);
        setSavedSearches([]);
      }

    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function refreshAll(options = {}) {
    await loadBootstrap(options);
    if (session?.user) {
      await loadAccountData(session.user);
    }
  }

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    if (session?.user) {
      loadAccountData(session.user);
      setOrderForm((current) => ({
        ...current,
        customerName: session.user.name || current.customerName,
        customerEmail: session.user.email || current.customerEmail
      }));
      setProfileForm({ name: session.user.name || "" });
    }
  }, [session]);

  useEffect(() => {
    if (!selectedOrder?.restaurantSlug) {
      setReviews([]);
      return;
    }

    getReviews(selectedOrder.restaurantSlug)
      .then((items) => setReviews(items))
      .catch(() => {});
  }, [selectedOrder?.restaurantSlug]);

  useEffect(() => {
    saveFilters(filters).catch(() => {});
  }, [filters]);

  useEffect(() => {
    saveOrderDraft(orderForm).catch(() => {});
  }, [orderForm]);

  useEffect(() => {
    saveReadNotifications(readNotificationIds).catch(() => {});
  }, [readNotificationIds]);

  useEffect(() => {
    if (!orderForm.restaurantSlug && bootstrapData.restaurants?.length) {
      setOrderForm((current) => ({
        ...current,
        restaurantSlug: bootstrapData.restaurants[0].slug
      }));
    }
  }, [bootstrapData.restaurants, orderForm.restaurantSlug]);

  const cuisineOptions = useMemo(() => {
    const cuisines = (bootstrapData.restaurants || []).map((restaurant) => restaurant.cuisine).filter(Boolean);
    return ["all", ...new Set(cuisines)];
  }, [bootstrapData.restaurants]);

  const filteredRestaurants = useMemo(() => {
    const guests = Math.max(Number(filters.guests) || 0, 1);
    const budgetAmount = Number(filters.budgetAmount) || 0;
    const budgetTarget = budgetAmount
      ? filters.budgetMode === "total"
        ? budgetAmount
        : budgetAmount * guests
      : 0;

    return (bootstrapData.restaurants || [])
      .filter((restaurant) => {
        const zipMatch = !filters.zip.trim() || (restaurant.zipCodes || []).includes(filters.zip.trim());
        const cuisineMatch = filters.cuisine === "all" || restaurant.cuisine === filters.cuisine;
        const budgetMatch = !budgetTarget || (restaurant.perPerson * guests) <= (budgetTarget * 1.15);
        return zipMatch && cuisineMatch && budgetMatch;
      })
      .sort((a, b) => {
        const aFit = Math.abs((a.perPerson * guests) - (budgetTarget || a.perPerson * guests));
        const bFit = Math.abs((b.perPerson * guests) - (budgetTarget || b.perPerson * guests));
        return aFit - bFit;
      });
  }, [bootstrapData.restaurants, filters]);

  const orderRestaurants = useMemo(() => {
    const preferred = filteredRestaurants.length ? filteredRestaurants : (bootstrapData.restaurants || []);
    return preferred.slice(0, 8);
  }, [bootstrapData.restaurants, filteredRestaurants]);

  const favoriteSlugs = useMemo(
    () => new Set((favorites || []).map((restaurant) => restaurant.slug)),
    [favorites]
  );

  const dashboardMetrics = useMemo(() => {
    if (session?.user?.role === "restaurant") {
      return bootstrapData.restaurantDashboard?.metrics || null;
    }
    if (session?.user?.role === "admin") {
      return bootstrapData.adminDashboard?.metrics || null;
    }
    return null;
  }, [bootstrapData, session]);

  const scopedOrders = useMemo(() => {
    if (session?.user?.role === "restaurant" || session?.user?.role === "admin") {
      return bootstrapData.orders || [];
    }
    return [];
  }, [bootstrapData.orders, session]);

  const visibleOrders = useMemo(() => {
    if (session?.user?.role === "customer") return accountOrders;
    if (session?.user?.role === "restaurant" || session?.user?.role === "admin") return scopedOrders;
    return [];
  }, [accountOrders, scopedOrders, session]);

  const selectedOrder = useMemo(
    () => visibleOrders.find((order) => order.id === selectedOrderId) || null,
    [selectedOrderId, visibleOrders]
  );

  const selectedOrderIssues = useMemo(
    () => issues.filter((issue) => issue.order === selectedOrderId),
    [issues, selectedOrderId]
  );

  const selectedOrderReview = useMemo(
    () => reviews.find((review) => review.orderId === selectedOrderId) || null,
    [reviews, selectedOrderId]
  );

  const selectedOrderTimeline = useMemo(
    () => buildTimelineEvents(selectedOrder, selectedOrderIssues, selectedOrderReview, notifications),
    [selectedOrder, selectedOrderIssues, selectedOrderReview, notifications]
  );

  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !readNotificationIds.includes(item.id)),
    [notifications, readNotificationIds]
  );

  const selectedRestaurant = useMemo(
    () => (bootstrapData.restaurants || []).find((restaurant) => restaurant.slug === orderForm.restaurantSlug) || (bootstrapData.restaurants || [])[0] || null,
    [bootstrapData.restaurants, orderForm.restaurantSlug]
  );

  const liveQuote = useMemo(() => {
    if (!selectedRestaurant) {
      return null;
    }

    const guests = Math.max(Number(orderForm.guests) || 0, 1);
    const budgetAmount = Math.max(Number(orderForm.budgetAmount) || 0, 0);
    const derivedPerPerson = orderForm.budgetMode === "total"
      ? (guests ? budgetAmount / guests : selectedRestaurant.perPerson)
      : budgetAmount;
    const perPerson = Math.max(derivedPerPerson || selectedRestaurant.perPerson || 0, 0);
    const subtotal = Number((guests * perPerson).toFixed(2));
    const deliveryFee = orderForm.deliveryType === "delivery" ? Number(selectedRestaurant.deliveryFee || 0) : 0;
    const serviceFee = getServiceFee(subtotal);
    const processingFee = Number((subtotal * 0.029 + 0.3).toFixed(2));
    const customerTotal = Number((subtotal + deliveryFee + serviceFee + processingFee).toFixed(2));
    const payout = Number((subtotal - subtotal * Number(selectedRestaurant.commission || 0)).toFixed(2));
    const budgetTarget = orderForm.budgetMode === "total" ? budgetAmount : budgetAmount * guests;

    return {
      guests,
      perPerson,
      subtotal,
      deliveryFee,
      serviceFee,
      processingFee,
      customerTotal,
      payout,
      budgetTarget
    };
  }, [orderForm, selectedRestaurant]);

  async function handleLogin() {
    setError("");
    setLoading(true);
    try {
      const nextSession = await login(form.email, form.password);
      setAuthToken(nextSession.token);
      await saveSession(nextSession);
      setSession(nextSession);
      setProfileForm({ name: nextSession.user.name || "" });
      await refreshAll();
      setActiveTab("account");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    clearAuthToken();
    await clearSession();
    setSession(null);
    setAccountOrders([]);
    setNotifications([]);
    setFavorites([]);
    setOrderStatus("");
    setAccountStatus("");
    setActiveTab("marketplace");
  }

  async function handleFavoriteToggle(slug) {
    if (session?.user?.role !== "customer") {
      setError("Sign in with a customer account to save restaurants.");
      return;
    }

    try {
      await toggleFavorite(slug);
      const savedFavorites = await getFavorites();
      setFavorites(savedFavorites);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleCreateOrder() {
    if (session?.user?.role !== "customer") {
      setError("Sign in with a customer account before creating a mobile order request.");
      return;
    }
    if (!selectedRestaurant || !liveQuote) {
      setError("Select a restaurant before creating an order.");
      return;
    }

    setSubmittingOrder(true);
    setError("");
    setOrderStatus("");
    try {
      const order = await createOrder({
        restaurantSlug: selectedRestaurant.slug,
        customer: orderForm.customerName,
        customerEmail: orderForm.customerEmail,
        eventDate: orderForm.eventDate,
        eventTime: orderForm.eventTime,
        eventType: orderForm.eventType,
        guests: liveQuote.guests,
        perPerson: Number(liveQuote.perPerson.toFixed(2)),
        budgetMode: orderForm.budgetMode,
        budgetAmount: Number(orderForm.budgetAmount || 0),
        budgetTarget: Number(liveQuote.budgetTarget.toFixed(2)),
        deliveryType: orderForm.deliveryType,
        dietaryNotes: orderForm.dietaryNotes
      });
      setOrderStatus(`Saved mobile order ${order.id} for ${order.restaurantName}. Total ${money(order.customerTotal)}.`);
      await refreshAll({ background: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmittingOrder(false);
    }
  }

  async function handleOrderStatusUpdate(orderId, status) {
    if (!session?.user || !["restaurant", "admin"].includes(session.user.role)) {
      setError("Restaurant or admin access is required to update orders.");
      return;
    }

    setUpdatingOrderId(orderId);
    setError("");
    setOrderStatus("");
    try {
      const order = await updateOrderStatus(orderId, status);
      setOrderStatus(`${order.id} updated to ${order.status}.`);
      await refreshAll({ background: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingOrderId("");
    }
  }

  async function handleProfileSave() {
    if (!session?.user) {
      setError("Sign in before updating your profile.");
      return;
    }

    setSavingProfile(true);
    setError("");
    setAccountStatus("");
    try {
      const user = await updateAccountProfile({ name: profileForm.name });
      const nextSession = {
        ...session,
        user
      };
      setSession(nextSession);
      await saveSession(nextSession);
      setAccountStatus("Profile updated.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordUpdate() {
    if (!session?.user) {
      setError("Sign in before updating your password.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirmation must match.");
      return;
    }

    setSavingProfile(true);
    setError("");
    setAccountStatus("");
    try {
      const result = await updateAccountPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      const nextSession = {
        ...session,
        user: result.user
      };
      setSession(nextSession);
      await saveSession(nextSession);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      });
      setAccountStatus("Password updated.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSavedSearchCreate() {
    if (session?.user?.role !== "customer") {
      setError("Customer sign-in is required to save searches.");
      return;
    }

    setSavingProfile(true);
    setError("");
    setAccountStatus("");
    try {
      const search = await createSavedSearch({
        name: savedSearchName || "Mobile saved search",
        zip: filters.zip,
        cuisine: filters.cuisine,
        guests: filters.guests,
        budgetMode: filters.budgetMode,
        budgetAmount: filters.budgetAmount,
        deliveryMode: "all",
        occasion: "all",
        minimum: "1000",
        sort: "recommended"
      });
      setSavedSearches((current) => [search, ...current]);
      setSavedSearchName("");
      setAccountStatus("Saved search added.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSavedSearchDelete(searchId) {
    setSavingProfile(true);
    setError("");
    setAccountStatus("");
    try {
      await deleteSavedSearch(searchId);
      setSavedSearches((current) => current.filter((item) => item.id !== searchId));
      setAccountStatus("Saved search removed.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  function applySavedSearch(search) {
    setFilters((current) => ({
      ...current,
      zip: search.zip || "",
      cuisine: search.cuisine || "all",
      guests: String(search.guests || current.guests),
      budgetMode: search.budgetMode || "total",
      budgetAmount: String(search.budgetAmount || current.budgetAmount)
    }));
    setActiveTab("marketplace");
  }

  async function handleIssueCreate() {
    if (!selectedOrder) {
      setError("Select an order before opening a support ticket.");
      return;
    }

    setSavingProfile(true);
    setError("");
    setAccountStatus("");
    try {
      const issue = await createIssue({
        order: selectedOrder.id,
        priority: issueForm.priority,
        issue: issueForm.issue
      });
      setIssues((current) => [issue, ...current]);
      setIssueForm({
        priority: "Medium",
        issue: ""
      });
      setAccountStatus(`Support ticket ${issue.id} created for ${selectedOrder.id}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleReviewSubmit() {
    if (!selectedOrder) {
      setError("Select an order before submitting a review.");
      return;
    }

    setSavingProfile(true);
    setError("");
    setAccountStatus("");
    try {
      const review = await createReview({
        orderId: selectedOrder.id,
        rating: reviewForm.rating,
        comment: reviewForm.comment
      });
      setReviews((current) => [review, ...current.filter((item) => item.orderId !== selectedOrder.id)]);
      setReviewForm({
        rating: "5",
        comment: ""
      });
      setAccountStatus(`Review submitted for ${selectedOrder.restaurantName}.`);
      await refreshAll({ background: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  function markNotificationRead(notificationId) {
    setReadNotificationIds((current) => current.includes(notificationId) ? current : [...current, notificationId]);
  }

  function markAllNotificationsRead() {
    setReadNotificationIds(notifications.map((item) => item.id));
    setAccountStatus("All notifications marked as read.");
  }

  function handleNotificationOpen(notification) {
    markNotificationRead(notification.id);
    const orderId = extractOrderIdFromNotification(notification);
    if (orderId) {
      setSelectedOrderId(orderId);
      setActiveTab("orders");
      setAccountStatus(`Opened order ${orderId} from notifications.`);
      return;
    }
    setAccountStatus(`${notification.title} opened in your notifications feed.`);
  }

  const guestCount = Math.max(Number(filters.guests) || 24, 1);

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" />
      <View style={styles.appShell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>GatherTray</Text>
            <Text style={styles.subtitle}>mobile beta for iOS and Android</Text>
          </View>
          <Text style={styles.baseUrl}>{getBaseUrl()}</Text>
        </View>

        <View style={styles.tabs}>
          <Pill label="Marketplace" active={activeTab === "marketplace"} onPress={() => setActiveTab("marketplace")} />
          <Pill label="Orders" active={activeTab === "orders"} onPress={() => setActiveTab("orders")} />
          <Pill label="Account" active={activeTab === "account"} onPress={() => setActiveTab("account")} />
        </View>

        <View style={styles.refreshRow}>
          <Text style={styles.refreshLabel}>{refreshing ? "Refreshing..." : "Live local API"}</Text>
          <Pressable onPress={() => refreshAll({ background: true })} style={styles.refreshButton}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={theme.brand} />
            <Text style={styles.body}>Loading GatherTray...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {error ? (
              <Card>
                <Text style={styles.errorText}>{error}</Text>
              </Card>
            ) : null}

            {orderStatus ? (
              <Card>
                <Text style={styles.successText}>{orderStatus}</Text>
              </Card>
            ) : null}

            {accountStatus ? (
              <Card>
                <Text style={styles.successText}>{accountStatus}</Text>
              </Card>
            ) : null}

            {activeTab === "marketplace" ? (
              <View style={styles.stack}>
                <SectionTitle
                  eyebrow="Marketplace"
                  title="Search by budget first"
                  body="This mobile beta mirrors GatherTray's budget-first positioning: set the event size and spend target, then compare restaurants by budget fit."
                />

                <Card>
                  <Text style={styles.inputLabel}>Delivery ZIP</Text>
                  <TextInput
                    inputMode="numeric"
                    onChangeText={(value) => setFilters((current) => ({ ...current, zip: value }))}
                    style={styles.input}
                    value={filters.zip}
                    placeholder="21117"
                  />

                  <Text style={styles.inputLabel}>Cuisine</Text>
                  <View style={styles.pillWrap}>
                    {cuisineOptions.map((option) => (
                      <Pill
                        key={option}
                        label={option === "all" ? "All" : option}
                        active={filters.cuisine === option}
                        onPress={() => setFilters((current) => ({ ...current, cuisine: option }))}
                      />
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>Guest count</Text>
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setFilters((current) => ({ ...current, guests: value }))}
                    style={styles.input}
                    value={filters.guests}
                  />

                  <Text style={styles.inputLabel}>Budget mode</Text>
                  <View style={styles.pillWrap}>
                    <Pill
                      label="Total"
                      active={filters.budgetMode === "total"}
                      onPress={() => setFilters((current) => ({ ...current, budgetMode: "total" }))}
                    />
                    <Pill
                      label="Per person"
                      active={filters.budgetMode === "per-person"}
                      onPress={() => setFilters((current) => ({ ...current, budgetMode: "per-person" }))}
                    />
                  </View>

                  <Text style={styles.inputLabel}>Budget amount</Text>
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={(value) => setFilters((current) => ({ ...current, budgetAmount: value }))}
                    style={styles.input}
                    value={filters.budgetAmount}
                  />

                  {session?.user?.role === "customer" ? (
                    <>
                      <Text style={styles.inputLabel}>Saved search name</Text>
                      <TextInput
                        onChangeText={setSavedSearchName}
                        style={styles.input}
                        value={savedSearchName}
                        placeholder="Owings Mills lunch"
                      />
                      <Pressable onPress={handleSavedSearchCreate} style={styles.secondaryButton} disabled={savingProfile}>
                        <Text style={styles.secondaryButtonText}>{savingProfile ? "Saving..." : "Save this search"}</Text>
                      </Pressable>
                    </>
                  ) : null}
                </Card>

                <SectionTitle
                  eyebrow="Results"
                  title={`${filteredRestaurants.length} restaurant${filteredRestaurants.length === 1 ? "" : "s"} matched`}
                  body={filters.budgetAmount
                    ? `Showing restaurants that fit close to ${money(filters.budgetAmount)} ${filters.budgetMode === "total" ? "total" : "per person"} for ${guestCount} guests.`
                    : "Add a budget to rank restaurants by fit."}
                />

                {filteredRestaurants.length ? filteredRestaurants.map((restaurant) => {
                  const estimatedFood = restaurant.perPerson * guestCount;
                  const budgetTarget = filters.budgetMode === "total"
                    ? (Number(filters.budgetAmount) || 0)
                    : (Number(filters.budgetAmount) || 0) * guestCount;
                  const budgetDelta = budgetTarget ? budgetTarget - estimatedFood : 0;
                  const isSaved = favoriteSlugs.has(restaurant.slug);
                  return (
                    <Card key={restaurant.slug}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.cardTitle}>{restaurant.name}</Text>
                        <Text style={styles.chip}>{restaurant.cuisine}</Text>
                      </View>
                      <Text style={styles.body}>{restaurant.description}</Text>
                      <Text style={styles.meta}>
                        Est. food {money(estimatedFood)} • {money(restaurant.minimum)} minimum • {restaurant.neighborhood}
                      </Text>
                      <Text style={styles.meta}>
                        Rating {restaurant.rating} • {restaurant.deliveryModes.join(", ")}
                      </Text>
                      <Text style={styles.meta}>
                        {budgetTarget
                          ? budgetDelta >= 0
                            ? `Fits budget by ${money(budgetDelta)}`
                            : `Over budget by ${money(Math.abs(budgetDelta))}`
                          : "Set a budget target to compare fit"}
                      </Text>
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={() => {
                            setOrderForm((current) => ({
                              ...current,
                              restaurantSlug: restaurant.slug,
                              guests: filters.guests || current.guests,
                              budgetMode: filters.budgetMode,
                              budgetAmount: filters.budgetAmount || current.budgetAmount
                            }));
                            setActiveTab("orders");
                          }}
                          style={[styles.primaryButton, styles.inlineButton]}
                        >
                          <Text style={styles.primaryButtonText}>Order</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleFavoriteToggle(restaurant.slug)}
                          style={[styles.secondaryButton, styles.inlineButton]}
                        >
                          <Text style={styles.secondaryButtonText}>{isSaved ? "Saved" : "Save"}</Text>
                        </Pressable>
                      </View>
                    </Card>
                  );
                }) : (
                  <EmptyState
                    title="No restaurants matched"
                    body="Try widening your ZIP search, changing cuisine, or increasing the budget target."
                  />
                )}
              </View>
            ) : null}

            {activeTab === "orders" ? (
              <View style={styles.stack}>
                <SectionTitle
                  eyebrow="Orders"
                  title={
                    session?.user?.role === "restaurant"
                      ? "Restaurant order queue"
                      : session?.user?.role === "admin"
                      ? "Marketplace order queue"
                      : "Create a mobile catering request"
                  }
                  body={session?.user
                    ? session.user.role === "customer"
                      ? "This mobile beta now submits live order requests into the same GatherTray backend used by the web app."
                      : session.user.role === "restaurant"
                      ? "Restaurant users can now monitor their scoped incoming orders and marketplace performance from mobile."
                      : "Admin users can now review marketplace-wide orders and top-line metrics from mobile."
                    : "Sign in with a GatherTray account to unlock the role-specific mobile orders view."}
                />

                {session?.user?.role === "customer" ? (
                  <>
                    <Card>
                      <Text style={styles.inputLabel}>Restaurant</Text>
                      <View style={styles.pillWrap}>
                        {orderRestaurants.map((restaurant) => (
                          <Pill
                            key={restaurant.slug}
                            label={restaurant.name}
                            active={orderForm.restaurantSlug === restaurant.slug}
                            onPress={() => setOrderForm((current) => ({ ...current, restaurantSlug: restaurant.slug }))}
                          />
                        ))}
                      </View>

                      <Text style={styles.inputLabel}>Guest count</Text>
                      <TextInput
                        keyboardType="numeric"
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, guests: value }))}
                        style={styles.input}
                        value={orderForm.guests}
                      />

                      <Text style={styles.inputLabel}>Budget mode</Text>
                      <View style={styles.pillWrap}>
                        <Pill
                          label="Total"
                          active={orderForm.budgetMode === "total"}
                          onPress={() => setOrderForm((current) => ({ ...current, budgetMode: "total" }))}
                        />
                        <Pill
                          label="Per person"
                          active={orderForm.budgetMode === "per-person"}
                          onPress={() => setOrderForm((current) => ({ ...current, budgetMode: "per-person" }))}
                        />
                      </View>

                      <Text style={styles.inputLabel}>Budget amount</Text>
                      <TextInput
                        keyboardType="numeric"
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, budgetAmount: value }))}
                        style={styles.input}
                        value={orderForm.budgetAmount}
                      />

                      <Text style={styles.inputLabel}>Event date</Text>
                      <TextInput
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, eventDate: value }))}
                        style={styles.input}
                        value={orderForm.eventDate}
                        placeholder="YYYY-MM-DD"
                      />

                      <Text style={styles.inputLabel}>Event time</Text>
                      <TextInput
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, eventTime: value }))}
                        style={styles.input}
                        value={orderForm.eventTime}
                        placeholder="12:00"
                      />

                      <Text style={styles.inputLabel}>Event type</Text>
                      <TextInput
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, eventType: value }))}
                        style={styles.input}
                        value={orderForm.eventType}
                      />

                      <Text style={styles.inputLabel}>Delivery type</Text>
                      <View style={styles.pillWrap}>
                        <Pill
                          label="Delivery"
                          active={orderForm.deliveryType === "delivery"}
                          onPress={() => setOrderForm((current) => ({ ...current, deliveryType: "delivery" }))}
                        />
                        <Pill
                          label="Pickup"
                          active={orderForm.deliveryType === "pickup"}
                          onPress={() => setOrderForm((current) => ({ ...current, deliveryType: "pickup" }))}
                        />
                      </View>

                      <Text style={styles.inputLabel}>Customer name</Text>
                      <TextInput
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, customerName: value }))}
                        style={styles.input}
                        value={orderForm.customerName}
                      />

                      <Text style={styles.inputLabel}>Customer email</Text>
                      <TextInput
                        autoCapitalize="none"
                        keyboardType="email-address"
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, customerEmail: value }))}
                        style={styles.input}
                        value={orderForm.customerEmail}
                      />

                      <Text style={styles.inputLabel}>Dietary notes</Text>
                      <TextInput
                        multiline
                        onChangeText={(value) => setOrderForm((current) => ({ ...current, dietaryNotes: value }))}
                        style={[styles.input, styles.multilineInput]}
                        value={orderForm.dietaryNotes}
                        placeholder="Vegetarian, gluten-free, setup needs, boxed lunches..."
                      />
                    </Card>

                    {selectedRestaurant && liveQuote ? (
                      <Card>
                        <Text style={styles.cardTitle}>Live mobile quote</Text>
                        <Text style={styles.meta}>Draft saved on this device while you work.</Text>
                        <Text style={styles.meta}>{selectedRestaurant.name} • {selectedRestaurant.neighborhood}</Text>
                        <Text style={styles.meta}>
                          Budget {orderForm.budgetMode === "total" ? `${money(orderForm.budgetAmount)} total` : `${money(orderForm.budgetAmount)} / guest`}
                        </Text>
                        <Text style={styles.meta}>Suggested food spend {money(liveQuote.subtotal)}</Text>
                        <Text style={styles.meta}>Delivery fee {money(liveQuote.deliveryFee)}</Text>
                        <Text style={styles.meta}>Service fee {money(liveQuote.serviceFee)}</Text>
                        <Text style={styles.meta}>Processing {money(liveQuote.processingFee)}</Text>
                        <Text style={styles.quoteTotal}>Customer total {money(liveQuote.customerTotal)}</Text>
                        <Text style={styles.meta}>Restaurant payout {money(liveQuote.payout)}</Text>
                        <Pressable onPress={handleCreateOrder} style={styles.primaryButton} disabled={submittingOrder}>
                          <Text style={styles.primaryButtonText}>{submittingOrder ? "Submitting..." : "Submit mobile order request"}</Text>
                        </Pressable>
                      </Card>
                    ) : null}

                    <SectionTitle
                      eyebrow="History"
                      title="Customer order history"
                      body="New mobile requests will appear here after submission."
                    />

                    {accountOrders.length ? accountOrders.map((order) => (
                      <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)}>
                        <Card>
                          <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>{order.id}</Text>
                            <Text style={styles.chip}>{order.status}</Text>
                          </View>
                          <Text style={styles.body}>{order.restaurantName}</Text>
                          <Text style={styles.meta}>{order.eventDate} • {order.guests} guests</Text>
                          <Text style={styles.meta}>
                            Budget {order.budgetMode === "total" ? `${money(order.budgetAmount)} total` : `${money(order.budgetAmount)} / guest`}
                          </Text>
                          <Text style={styles.meta}>Total {money(order.customerTotal)}</Text>
                        </Card>
                      </Pressable>
                    )) : (
                      <EmptyState
                        title="No customer orders yet"
                        body="Submit your first request from this tab and it will appear here after the API save completes."
                      />
                    )}

                    {selectedOrder ? (
                      <View style={styles.rowBetween}>
                        <SectionTitle
                          eyebrow="Selected order"
                          title={selectedOrder.id}
                          body="Review order details and manage support tickets from mobile."
                        />
                        <Pressable onPress={() => setSelectedOrderId("")} style={[styles.secondaryButton, styles.inlineButton]}>
                          <Text style={styles.secondaryButtonText}>Close</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {selectedOrder ? (
                      <Card>
                        <Text style={styles.cardTitle}>{selectedOrder.restaurantName}</Text>
                        <Text style={styles.meta}>
                          {selectedOrder.eventDate} {selectedOrder.eventTime ? `• ${selectedOrder.eventTime}` : ""} • {selectedOrder.guests} guests
                        </Text>
                        <Text style={styles.meta}>Delivery {selectedOrder.deliveryType || "delivery"}</Text>
                        <Text style={styles.meta}>
                          Budget {selectedOrder.budgetMode === "total" ? `${money(selectedOrder.budgetAmount)} total` : `${money(selectedOrder.budgetAmount)} / guest`}
                        </Text>
                        <Text style={styles.meta}>Food subtotal {money(selectedOrder.subtotal)}</Text>
                        <Text style={styles.meta}>Customer total {money(selectedOrder.customerTotal)}</Text>
                        <Text style={styles.meta}>Dietary notes {selectedOrder.dietaryNotes || "None"}</Text>
                      </Card>
                    ) : null}

                    {selectedOrder ? (
                      <Card>
                        <Text style={styles.cardTitle}>Order timeline</Text>
                        {selectedOrderTimeline.map((event) => (
                          <View key={event.id} style={styles.timelineItem}>
                            <Text style={styles.timelineTitle}>{event.title}</Text>
                            <Text style={styles.meta}>{formatDateTime(event.at)}</Text>
                            <Text style={styles.body}>{event.detail}</Text>
                          </View>
                        ))}
                      </Card>
                    ) : null}

                    {selectedOrder ? (
                      <>
                        <Card>
                          <Text style={styles.cardTitle}>Customer review</Text>
                          {selectedOrderReview ? (
                            <>
                              <Text style={styles.meta}>{selectedOrderReview.rating} / 5</Text>
                              <Text style={styles.body}>{selectedOrderReview.comment || "No written comment."}</Text>
                            </>
                          ) : session?.user?.role === "customer" && selectedOrder.status === "Completed" && selectedOrder.customerEmail === session.user.email ? (
                            <>
                              <Text style={styles.inputLabel}>Rating</Text>
                              <View style={styles.pillWrap}>
                                {["5", "4", "3", "2", "1"].map((value) => (
                                  <Pill
                                    key={value}
                                    label={`${value} star${value === "1" ? "" : "s"}`}
                                    active={reviewForm.rating === value}
                                    onPress={() => setReviewForm((current) => ({ ...current, rating: value }))}
                                  />
                                ))}
                              </View>
                              <Text style={styles.inputLabel}>Comment</Text>
                              <TextInput
                                multiline
                                onChangeText={(value) => setReviewForm((current) => ({ ...current, comment: value }))}
                                style={[styles.input, styles.multilineInput]}
                                value={reviewForm.comment}
                                placeholder="Share what went well and what could improve."
                              />
                              <Pressable onPress={handleReviewSubmit} style={styles.primaryButton} disabled={savingProfile}>
                                <Text style={styles.primaryButtonText}>{savingProfile ? "Submitting..." : "Submit review"}</Text>
                              </Pressable>
                            </>
                          ) : (
                            <Text style={styles.body}>Reviews can be submitted by the customer on a completed order.</Text>
                          )}
                        </Card>

                        <Card>
                          <Text style={styles.cardTitle}>Support tickets</Text>
                          {selectedOrderIssues.length ? selectedOrderIssues.map((issue) => (
                            <View key={issue.id} style={styles.issueItem}>
                              <Text style={styles.meta}>{issue.id} • {issue.status} • {issue.priority}</Text>
                              <Text style={styles.body}>{issue.issue}</Text>
                            </View>
                          )) : (
                            <Text style={styles.body}>No support tickets have been opened for this order yet.</Text>
                          )}
                        </Card>

                        <Card>
                          <Text style={styles.cardTitle}>Open support ticket</Text>
                          <Text style={styles.inputLabel}>Priority</Text>
                          <View style={styles.pillWrap}>
                            {["Low", "Medium", "High"].map((priority) => (
                              <Pill
                                key={priority}
                                label={priority}
                                active={issueForm.priority === priority}
                                onPress={() => setIssueForm((current) => ({ ...current, priority }))}
                              />
                            ))}
                          </View>
                          <Text style={styles.inputLabel}>Issue details</Text>
                          <TextInput
                            multiline
                            onChangeText={(value) => setIssueForm((current) => ({ ...current, issue: value }))}
                            style={[styles.input, styles.multilineInput]}
                            value={issueForm.issue}
                            placeholder="Describe what went wrong or what needs follow-up."
                          />
                          <Pressable onPress={handleIssueCreate} style={styles.primaryButton} disabled={savingProfile}>
                            <Text style={styles.primaryButtonText}>{savingProfile ? "Opening..." : "Open support ticket"}</Text>
                          </Pressable>
                        </Card>
                      </>
                    ) : null}
                  </>
                ) : null}

                {session?.user?.role === "restaurant" || session?.user?.role === "admin" ? (
                  <>
                    {dashboardMetrics ? (
                      <View style={styles.metricGrid}>
                        {Object.entries(dashboardMetrics).map(([key, value]) => (
                          <Card key={key}>
                            <Text style={styles.metricLabel}>{key.replace(/([A-Z])/g, " $1").trim()}</Text>
                            <Text style={styles.metricValue}>
                              {typeof value === "number" ? (key.toLowerCase().includes("revenue") || key.toLowerCase().includes("gmv") || key.toLowerCase().includes("pending") ? money(value) : `${value}`) : `${value}`}
                            </Text>
                          </Card>
                        ))}
                      </View>
                    ) : null}

                    {scopedOrders.length ? scopedOrders.map((order) => (
                      <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)}>
                        <Card>
                          <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>{order.id}</Text>
                            <Text style={styles.chip}>{order.status}</Text>
                          </View>
                          <Text style={styles.body}>{order.restaurantName}</Text>
                          <Text style={styles.meta}>
                            {order.eventDate} {order.eventTime ? `• ${order.eventTime}` : ""} • {order.guests} guests
                          </Text>
                          <Text style={styles.meta}>Customer {order.customer}</Text>
                          <Text style={styles.meta}>Total {money(order.customerTotal)}</Text>
                          {session.user.role === "admin" ? (
                            <Text style={styles.meta}>Payout {money(order.restaurantPayout)}</Text>
                          ) : null}
                          <View style={styles.actionRow}>
                            {["Accepted", "In prep", "Completed"].map((status) => (
                              <Pressable
                                key={`${order.id}-${status}`}
                                disabled={updatingOrderId === order.id || order.status === status}
                                onPress={() => handleOrderStatusUpdate(order.id, status)}
                                style={[
                                  styles.secondaryButton,
                                  styles.inlineButton,
                                  order.status === status && styles.disabledButton
                                ]}
                              >
                                <Text style={styles.secondaryButtonText}>
                                  {updatingOrderId === order.id ? "Updating..." : status}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </Card>
                      </Pressable>
                    )) : (
                      <EmptyState
                        title="No scoped orders yet"
                        body={session.user.role === "restaurant"
                          ? "Incoming restaurant orders will appear here as customers submit requests."
                          : "Marketplace orders will appear here once customers submit requests."}
                      />
                    )}

                    {selectedOrder ? (
                      <Card>
                        <Text style={styles.cardTitle}>Order details</Text>
                        <Text style={styles.meta}>{selectedOrder.id} • {selectedOrder.status}</Text>
                        <Text style={styles.meta}>{selectedOrder.restaurantName}</Text>
                        <Text style={styles.meta}>Customer {selectedOrder.customer} • {selectedOrder.customerEmail}</Text>
                        <Text style={styles.meta}>
                          {selectedOrder.eventDate} {selectedOrder.eventTime ? `• ${selectedOrder.eventTime}` : ""} • {selectedOrder.guests} guests
                        </Text>
                        <Text style={styles.meta}>Delivery {selectedOrder.deliveryType || "delivery"}</Text>
                        <Text style={styles.meta}>Food subtotal {money(selectedOrder.subtotal)}</Text>
                        <Text style={styles.meta}>Customer total {money(selectedOrder.customerTotal)}</Text>
                        <Text style={styles.meta}>Dietary notes {selectedOrder.dietaryNotes || "None"}</Text>
                        {selectedOrderIssues.length ? (
                          <>
                            <Text style={styles.cardTitle}>Related support tickets</Text>
                            {selectedOrderIssues.map((issue) => (
                              <View key={issue.id} style={styles.issueItem}>
                                <Text style={styles.meta}>{issue.id} • {issue.status} • {issue.priority}</Text>
                                <Text style={styles.body}>{issue.issue}</Text>
                              </View>
                            ))}
                          </>
                        ) : (
                          <Text style={styles.body}>No support tickets linked to this order yet.</Text>
                        )}
                      </Card>
                    ) : null}

                    {selectedOrder ? (
                      <Card>
                        <Text style={styles.cardTitle}>Order timeline</Text>
                        {selectedOrderTimeline.map((event) => (
                          <View key={event.id} style={styles.timelineItem}>
                            <Text style={styles.timelineTitle}>{event.title}</Text>
                            <Text style={styles.meta}>{formatDateTime(event.at)}</Text>
                            <Text style={styles.body}>{event.detail}</Text>
                          </View>
                        ))}
                      </Card>
                    ) : null}
                  </>
                ) : null}

                {!session?.user ? (
                  <EmptyState
                    title="Sign-in required"
                    body="Use a GatherTray customer, restaurant, or admin account to preview the mobile orders experience for that role."
                  />
                ) : null}
              </View>
            ) : null}

            {activeTab === "account" ? (
              <View style={styles.stack}>
                <SectionTitle
                  eyebrow="Account"
                  title={session?.user ? `${session.user.name}` : "Sign in to GatherTray"}
                  body={session?.user
                    ? `${session.user.email} • ${session.user.role}`
                    : "This mobile beta includes customer favorites, notifications, and live ordering on top of mobile sign-in."}
                />
                {!session?.user ? (
                  <Card>
                    <Text style={styles.inputLabel}>Email</Text>
                    <TextInput
                      autoCapitalize="none"
                      keyboardType="email-address"
                      onChangeText={(value) => setForm((current) => ({ ...current, email: value }))}
                      style={styles.input}
                      value={form.email}
                    />
                    <Text style={styles.inputLabel}>Password</Text>
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={(value) => setForm((current) => ({ ...current, password: value }))}
                      secureTextEntry
                      style={styles.input}
                      value={form.password}
                    />
                    <Pressable onPress={handleLogin} style={styles.primaryButton}>
                      <Text style={styles.primaryButtonText}>Sign in</Text>
                    </Pressable>
                  </Card>
                ) : (
                  <Card>
                    <Text style={styles.body}>Signed in and connected to the live API.</Text>
                    <Text style={styles.meta}>Role: {session.user.role}</Text>
                    <Text style={styles.meta}>Favorites saved: {favorites.length}</Text>
                    <Text style={styles.meta}>Notifications: {notifications.length}</Text>
                    <Text style={styles.meta}>Unread alerts: {unreadNotifications.length}</Text>
                    <Pressable onPress={handleLogout} style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonText}>Log out</Text>
                    </Pressable>
                  </Card>
                )}

                {session?.user ? (
                  <>
                    <Card>
                      <Text style={styles.cardTitle}>Profile</Text>
                      <Text style={styles.inputLabel}>Full name</Text>
                      <TextInput
                        onChangeText={(value) => setProfileForm({ name: value })}
                        style={styles.input}
                        value={profileForm.name}
                      />
                      <Pressable onPress={handleProfileSave} style={styles.primaryButton} disabled={savingProfile}>
                        <Text style={styles.primaryButtonText}>{savingProfile ? "Saving..." : "Save profile"}</Text>
                      </Pressable>
                    </Card>

                    <Card>
                      <Text style={styles.cardTitle}>Password</Text>
                      <Text style={styles.inputLabel}>Current password</Text>
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setPasswordForm((current) => ({ ...current, currentPassword: value }))}
                        secureTextEntry
                        style={styles.input}
                        value={passwordForm.currentPassword}
                      />
                      <Text style={styles.inputLabel}>New password</Text>
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setPasswordForm((current) => ({ ...current, newPassword: value }))}
                        secureTextEntry
                        style={styles.input}
                        value={passwordForm.newPassword}
                      />
                      <Text style={styles.inputLabel}>Confirm new password</Text>
                      <TextInput
                        autoCapitalize="none"
                        onChangeText={(value) => setPasswordForm((current) => ({ ...current, confirmPassword: value }))}
                        secureTextEntry
                        style={styles.input}
                        value={passwordForm.confirmPassword}
                      />
                      <Pressable onPress={handlePasswordUpdate} style={styles.primaryButton} disabled={savingProfile}>
                        <Text style={styles.primaryButtonText}>{savingProfile ? "Updating..." : "Update password"}</Text>
                      </Pressable>
                    </Card>
                  </>
                ) : null}

                {session?.user?.role === "customer" ? (
                  <View style={styles.stack}>
                    <SectionTitle
                      eyebrow="Saved searches"
                      title="Marketplace shortcuts"
                      body="Customer search presets sync from the GatherTray backend and can be re-applied on mobile."
                    />
                    {savedSearches.length ? savedSearches.map((search) => (
                      <Card key={search.id}>
                        <View style={styles.rowBetween}>
                          <Text style={styles.cardTitle}>{search.name}</Text>
                          <Text style={styles.chip}>{search.id}</Text>
                        </View>
                        <Text style={styles.meta}>
                          {search.zip ? `ZIP ${search.zip} • ` : ""}{search.cuisine && search.cuisine !== "all" ? `${search.cuisine} • ` : ""}{search.guests ? `${search.guests} guests` : ""}
                        </Text>
                        <Text style={styles.meta}>
                          Budget {search.budgetMode === "total" ? `${money(search.budgetAmount)} total` : `${money(search.budgetAmount)} / guest`}
                        </Text>
                        <View style={styles.actionRow}>
                          <Pressable onPress={() => applySavedSearch(search)} style={[styles.primaryButton, styles.inlineButton]}>
                            <Text style={styles.primaryButtonText}>Apply</Text>
                          </Pressable>
                          <Pressable onPress={() => handleSavedSearchDelete(search.id)} style={[styles.secondaryButton, styles.inlineButton]} disabled={savingProfile}>
                            <Text style={styles.secondaryButtonText}>{savingProfile ? "Working..." : "Delete"}</Text>
                          </Pressable>
                        </View>
                      </Card>
                    )) : (
                      <EmptyState
                        title="No saved searches yet"
                        body="Save a budget-first marketplace search from the Marketplace tab to reuse it later."
                      />
                    )}

                    <SectionTitle
                      eyebrow="Favorites"
                      title="Saved restaurants"
                      body="Customer favorites sync from the same GatherTray backend as the web app."
                    />
                    {favorites.length ? favorites.map((restaurant) => (
                      <Card key={restaurant.slug}>
                        <View style={styles.rowBetween}>
                          <Text style={styles.cardTitle}>{restaurant.name}</Text>
                          <Text style={styles.chip}>{restaurant.cuisine}</Text>
                        </View>
                        <Text style={styles.meta}>{restaurant.neighborhood} • {money(restaurant.minimum)} minimum</Text>
                        <Text style={styles.body}>{restaurant.description}</Text>
                      </Card>
                    )) : (
                      <EmptyState
                        title="No favorites yet"
                        body="Save restaurants from the marketplace tab to build a shortlist on mobile."
                      />
                    )}

                    <SectionTitle
                      eyebrow="Notifications"
                      title="Marketplace updates"
                      body="Approval and order activity can surface here now, with unread tracking to prepare for fuller mobile messaging later."
                    />
                    {notifications.length ? (
                      <Pressable onPress={markAllNotificationsRead} style={styles.secondaryButton}>
                        <Text style={styles.secondaryButtonText}>Mark all read</Text>
                      </Pressable>
                    ) : null}
                    {notifications.length ? notifications.map((item) => (
                      <Pressable key={item.id} onPress={() => handleNotificationOpen(item)}>
                        <Card>
                          <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                            {!readNotificationIds.includes(item.id) ? <Text style={styles.unreadBadge}>Unread</Text> : null}
                          </View>
                          <Text style={styles.body}>{item.body}</Text>
                          <Text style={styles.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
                        </Card>
                      </Pressable>
                    )) : (
                      <EmptyState
                        title="No notifications yet"
                        body="Order updates and approval events will appear here for signed-in users."
                      />
                    )}
                  </View>
                ) : null}

                {session?.user?.role === "restaurant" ? (
                  <View style={styles.stack}>
                    <SectionTitle
                      eyebrow="Restaurant"
                      title="Mobile merchant snapshot"
                      body="This is the first mobile merchant view for tracking orders and activity without opening the web dashboard."
                    />
                    {notifications.length ? (
                      <Pressable onPress={markAllNotificationsRead} style={styles.secondaryButton}>
                        <Text style={styles.secondaryButtonText}>Mark all read</Text>
                      </Pressable>
                    ) : null}
                    {notifications.length ? notifications.map((item) => (
                      <Pressable key={item.id} onPress={() => handleNotificationOpen(item)}>
                        <Card>
                          <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                            {!readNotificationIds.includes(item.id) ? <Text style={styles.unreadBadge}>Unread</Text> : null}
                          </View>
                          <Text style={styles.body}>{item.body}</Text>
                          <Text style={styles.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
                        </Card>
                      </Pressable>
                    )) : (
                      <EmptyState
                        title="No restaurant notifications yet"
                        body="Order updates and ops notices will appear here for signed-in restaurant users."
                      />
                    )}
                  </View>
                ) : null}

                {session?.user?.role === "admin" ? (
                  <View style={styles.stack}>
                    <SectionTitle
                      eyebrow="Admin"
                      title="Ops notifications"
                      body="This gives admins a lightweight mobile operations view while the full web dashboard remains the deepest control surface."
                    />
                    {notifications.length ? (
                      <Pressable onPress={markAllNotificationsRead} style={styles.secondaryButton}>
                        <Text style={styles.secondaryButtonText}>Mark all read</Text>
                      </Pressable>
                    ) : null}
                    {notifications.length ? notifications.map((item) => (
                      <Pressable key={item.id} onPress={() => handleNotificationOpen(item)}>
                        <Card>
                          <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                            {!readNotificationIds.includes(item.id) ? <Text style={styles.unreadBadge}>Unread</Text> : null}
                          </View>
                          <Text style={styles.body}>{item.body}</Text>
                          <Text style={styles.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
                        </Card>
                      </Pressable>
                    )) : (
                      <EmptyState
                        title="No admin notifications yet"
                        body="Operational updates will appear here for signed-in admins."
                      />
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.background
  },
  appShell: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
    gap: 16
  },
  logo: {
    color: theme.ink,
    fontSize: 28,
    fontWeight: "800"
  },
  subtitle: {
    color: theme.muted,
    marginTop: 4
  },
  baseUrl: {
    flexShrink: 1,
    color: theme.muted,
    fontSize: 12,
    textAlign: "right"
  },
  tabs: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12
  },
  pillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 8
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface
  },
  pillActive: {
    backgroundColor: theme.brand,
    borderColor: theme.brand
  },
  pillText: {
    color: theme.ink,
    fontWeight: "600"
  },
  pillTextActive: {
    color: "#fffaf2"
  },
  refreshRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  refreshLabel: {
    color: theme.muted,
    fontSize: 13
  },
  refreshButton: {
    backgroundColor: theme.soft,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  refreshButtonText: {
    color: theme.brandDark,
    fontWeight: "700"
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 10
  },
  scrollContent: {
    paddingBottom: 42
  },
  stack: {
    gap: 14
  },
  sectionTitle: {
    gap: 6,
    marginBottom: 2
  },
  eyebrow: {
    color: theme.brandDark,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontSize: 11,
    fontWeight: "800"
  },
  sectionHeading: {
    color: theme.ink,
    fontSize: 26,
    fontWeight: "800"
  },
  body: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.line,
    padding: 18,
    gap: 8
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center"
  },
  cardTitle: {
    flex: 1,
    color: theme.ink,
    fontSize: 18,
    fontWeight: "700"
  },
  chip: {
    color: theme.green,
    backgroundColor: "#edf4ee",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "700"
  },
  unreadBadge: {
    color: "#fffaf2",
    backgroundColor: theme.brand,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "800"
  },
  meta: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19
  },
  inputLabel: {
    color: theme.ink,
    fontWeight: "700",
    marginTop: 4
  },
  input: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fffdf9",
    color: theme.ink
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: "top"
  },
  primaryButton: {
    backgroundColor: theme.brand,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8
  },
  primaryButtonText: {
    color: "#fffaf2",
    fontWeight: "800"
  },
  secondaryButton: {
    backgroundColor: theme.soft,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8
  },
  secondaryButtonText: {
    color: theme.brandDark,
    fontWeight: "800"
  },
  inlineButton: {
    marginTop: 0,
    paddingHorizontal: 18,
    marginRight: 10
  },
  disabledButton: {
    opacity: 0.56
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    marginTop: 4
  },
  issueItem: {
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    marginTop: 6
  },
  timelineItem: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    marginTop: 8
  },
  timelineTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  metricGrid: {
    gap: 12
  },
  metricLabel: {
    color: theme.muted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1
  },
  metricValue: {
    color: theme.ink,
    fontSize: 22,
    fontWeight: "800"
  },
  quoteTotal: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6
  },
  errorText: {
    color: "#9e2a1f",
    fontWeight: "700"
  },
  successText: {
    color: theme.green,
    fontWeight: "700",
    lineHeight: 20
  }
});
