const CACHE = "teska-baje-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (
    req.method !== "GET" ||
    new URL(req.url).origin !== self.location.origin ||
    req.headers.has("range")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(req);
        if (response.ok && response.type === "basic")
          await cache.put(req, response.clone());
        return response;
      } catch {
        return (
          (await cache.match(req)) ||
          (req.mode === "navigate" ? await cache.match("/") : null) ||
          Response.error()
        );
      }
    })(),
  );
});
