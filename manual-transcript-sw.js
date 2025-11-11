self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const sendMessageToClients = async (message) => {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST') {
    return;
  }
  const url = new URL(request.url);
  if (url.pathname !== '/manual-transcript-callback') {
    return;
  }

  event.respondWith((async () => {
    try {
      const cloned = request.clone();
      const text = await cloned.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        payload = { raw: text };
      }

      await sendMessageToClients({
        type: 'manual-transcript-result',
        payload,
      });

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      console.error('[Manual Transcript SW] Error handling callback', err);
      return new Response(JSON.stringify({ received: false, error: 'Service worker error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  })());
});
