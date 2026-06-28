/**
 * Tender Insight Service Worker
 *
 * Enables CORS-free fetching from the user's browser — used to reach
 * government tender sites that are geo-restricted from the server.
 *
 * The main page posts { type: "FETCH", url, requestId } and the SW
 * responds with { requestId, ok, status, body, error }.
 */
self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== "FETCH" || !data.url || data.requestId === undefined) {
    return;
  }

  var client = event.source;

  fetch(data.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    }
  })
    .then(function (response) {
      return response.text().then(function (body) {
        client.postMessage({
          requestId: data.requestId,
          ok: response.ok,
          status: response.status,
          finalUrl: response.url,
          body: body
        });
      });
    })
    .catch(function (error) {
      client.postMessage({
        requestId: data.requestId,
        ok: false,
        status: 0,
        error: String(error)
      });
    });
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});
