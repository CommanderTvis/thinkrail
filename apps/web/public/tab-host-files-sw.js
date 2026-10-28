// Serves /files/ and /blob/ from the host running in this browser tab: asks the page that made the
// request, which relays to its tab-host worker. Registered only while ThinkRail runs in the tab.
const ROUTES = ["files/", "blob/"].map((route) => new URL(route, self.registration.scope).pathname);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (
		url.origin !== self.location.origin ||
		!ROUTES.some((route) => url.pathname.startsWith(route))
	)
		return;
	event.respondWith(fromTab(event, url.pathname));
});

async function fromTab(event, pathname) {
	const client =
		(event.clientId && (await self.clients.get(event.clientId))) ||
		(await self.clients.matchAll({ type: "window" }))[0];
	if (!client) return new Response("No ThinkRail tab to read from", { status: 503 });
	const channel = new MessageChannel();
	const reply = new Promise((resolve) => {
		channel.port1.onmessage = (message) => resolve(message.data);
	});
	client.postMessage({ type: "thinkrail-tab-host-bytes", pathname }, [channel.port2]);
	const result = await reply;
	if (!result.ok) return new Response(result.error, { status: 404 });
	return new Response(result.bytes, { headers: { "content-type": result.mime } });
}
