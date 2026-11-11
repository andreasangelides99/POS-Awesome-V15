// Cake Zone: v2 clears every till's cached copy of the old item worker, which
// dropped is_stock_item (event cakes read as stock). Bump it whenever a file in
// the install list below changes under the SAME url.
// v3 (10 Nov 2026, offline till): the till's page is now refreshed on every online visit (see
// the navigate handler), so this bump also replaces every till's install-time copy once.
// v4 (11 Nov 2026): who-is-logged-in and logout are never answered from the cache (below); the
// bump throws away the copies of them every till had kept, which said "still logged in" for ever.
const CACHE_NAME = "posawesome-cache-v4";
const MAX_CACHE_ITEMS = 1000;

async function enforceCacheLimit(cache) {
	const keys = await cache.keys();
	if (keys.length > MAX_CACHE_ITEMS) {
		const excess = keys.length - MAX_CACHE_ITEMS;
		for (let i = 0; i < excess; i++) {
			await cache.delete(keys[i]);
		}
	}
}

self.addEventListener("install", (event) => {
	self.skipWaiting();
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			const resources = [
				"/app/posapp",
                                "/assets/posawesome/dist/js/posawesome.umd.js",

                                "/assets/posawesome/dist/js/offline/index.js",

                                "/assets/posawesome/dist/js/posapp/workers/itemWorker-v2.js",
                                "/assets/posawesome/dist/js/libs/dexie.min.js",

				"/manifest.json",
				"/offline.html",
			];
			await Promise.all(
				resources.map(async (url) => {
					try {
						const resp = await fetch(url, { cache: "reload" });
						// Never keep a redirect: a worker installed while logged out stored the
						// LOGIN redirect as the till page, and offline Chrome refused it (ERR_FAILED).
						if (resp && resp.ok && !resp.redirected) {
							await cache.put(url, resp.clone());
						}
					} catch (err) {
						console.warn("SW install failed to fetch", url, err);
					}
				}),
			);
			await enforceCacheLimit(cache);
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
			const cache = await caches.open(CACHE_NAME);
			await enforceCacheLimit(cache);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;

	const url = new URL(event.request.url);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;

	if (event.request.url.includes("socket.io")) return;

	// Login state must come from ERP itself. A kept copy of get_logged_user said the old person was
	// still logged in, and a kept copy of logout "logged out" without ever reaching ERP.
	if (url.pathname === "/api/method/logout" || url.pathname.startsWith("/api/method/frappe.auth.")) return;

	if (event.request.mode === "navigate") {
		event.respondWith(
			(async () => {
                                try {
                                        const resp = await fetch(event.request);
                                        // Keep the till's page current. Until 10 Nov 2026 the copy used
                                        // offline was the one fetched when this worker INSTALLED, so it
                                        // carried that day's program versions and settings for ever: a
                                        // till reloaded offline weeks later could ask for files it no
                                        // longer had. A redirect (to /login) is never stored.
                                        try {
                                                const path = new URL(event.request.url).pathname;
                                                if (resp && resp.ok && !resp.redirected && path.startsWith("/app/posapp")) {
                                                        const cache = await caches.open(CACHE_NAME);
                                                        await cache.put("/app/posapp", resp.clone());
                                                }
                                        } catch (e) {
                                                console.warn("SW could not refresh the till page", e);
                                        }
                                        return resp;
                                } catch (err) {
                                        const cached = await caches.match(event.request, { ignoreSearch: true });
                                        if (cached) {
                                                return cached;
                                        }

                                        const appShell = await caches.match("/app/posapp");
                                        if (appShell) {
                                                return appShell;
                                        }

                                        const offlinePage = await caches.match("/offline.html");
                                        if (offlinePage) {
                                                return offlinePage;
                                        }

                                        return Response.error();
                                }
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			try {
				const cached = await caches.match(event.request);
				if (cached) {
					return cached;
				}
				const resp = await fetch(event.request);
				if (resp && resp.ok && resp.status === 200) {
					try {
						const clone = resp.clone();
						const cache = await caches.open(CACHE_NAME);
						await cache.put(event.request, clone);
						await enforceCacheLimit(cache);
					} catch (e) {
						console.warn("SW cache put failed", e);
					}
				}
				return resp;
			} catch (err) {
				try {
					const fallback = await caches.match(event.request);
					return fallback || Response.error();
				} catch (e) {
					return Response.error();
				}
			}
		})(),
	);
});
