self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("gathertray-v1").then((cache) =>
      cache.addAll([
        "/",
        "/index.html",
        "/marketplace.html",
        "/order.html",
        "/restaurant-signup.html",
        "/restaurant-portal.html",
        "/restaurant-dashboard.html",
        "/admin-dashboard.html",
        "/account.html",
        "/styles.css",
        "/app.js",
        "/manifest.json"
      ])
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
