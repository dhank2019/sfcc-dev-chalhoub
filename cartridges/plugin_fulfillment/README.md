# plugin_fulfillment - PDP Delivery Estimation

A plugin cartridge (layered in front of `app_storefront_base`, never editing it) that adds a
business-managed "delivery estimation" message to the Product Detail Page, resolved from an
external fulfilment service.

>This README stays at the
> workflow level: what the feature does, how data flows through it, and how to test it.

---

## 1. What's implemented (functional overview)

On a product's PDP, directly below the existing "Availability" line, shoppers who select an
**in-stock, fully-specified variant** (e.g. a specific color/size) see a short message telling
them how fast that item can be delivered:

| Tier | Example shopper-facing meaning |
| --- | --- |
| `SAME_DAY` | "Order in the next few hours and get it delivered today." |
| `NEXT_DAY` | "Order today and receive it tomorrow." |
| `STANDARD` | "Estimated delivery in 3-5 business days." |

Key behaviors a shopper/merchandiser would notice:

- **Appears only when relevant.** No message is shown until a variant is selected and confirmed
  in stock; switching to an out-of-stock or incomplete variant hides it again.
- **Business-editable copy, no code deployment.** Every tier's message (and any image/markup a
  merchandiser adds) lives in a Business Manager Content Asset. Marketing can rewrite the copy or
  restyle it at any time; the code only ever decides *which* tier's content to show.
- **Never breaks or slows down the page.** The PDP itself never waits on the fulfilment service.
  If that service is slow, down, or returns garbage, the shopper simply never sees the message -
  no error banners, no broken layout, no console errors, no delayed page load.
- **Doesn't nag the fulfilment service repeatedly.** Re-selecting a variant you already resolved
  in this browsing session is instant (no new network call at all); even across different
  shoppers/sessions, the same sku+country combination is only re-resolved periodically.
- **One master switch.** A single Business Manager setting (`fulfillmentEnabled`) turns the
  entire feature on/off per site - markup, JS, CSS, and the service call all disappear together
  when it's off, with zero deployment.
- **Which tiers are valid is itself configurable.** The set of recognized tier values
  (`SAME_DAY`/`NEXT_DAY`/`STANDARD` by default) is a Business Manager setting, not a hardcoded
  list - so a tier can be added, renamed, or retired without a code change (paired with a
  matching Content Asset for the new tier's copy).

## 2. How it works (technical workflow)

Nothing in this feature is hardcoded where it doesn't need to be: the service endpoint/credential,
the cache lifetime, the set of valid tiers, the per-tier copy, and even the mock-response
scenarios are all externalized to Business Manager config, Content Assets, or small JSON files -
see the callouts below.

```
PDP renders normally (server never calls the fulfilment service during page render)
        |
        v
Availability block template adds a hidden placeholder <div> (one per variant's PDP)
   - carries the product id, whether it's ready-to-order/available, and the ajax endpoint URL
   - the whole block (markup + its JS/CSS) only exists on the page at all when the
     "fulfillmentEnabled" Business Manager setting is on
        |
        v
Client widget (runs after the PDP/variant JSON is already on the page)
   - fires on initial load (if already in stock) and again whenever the shopper picks a new
     variant
   - calls the plugin's ajax endpoint with a short client-side timeout, so a stuck request can
     never hang the page
        |
        v
Ajax endpoint (server)
   - re-checks the master feature flag
   - resolves country (from geolocation, falling back to locale) - no UI change needed
   - delegates to a helper that:
       1. checks a server-side cache for this sku+country (hit = skip the external call
          entirely); the cache lifetime is a Business Manager setting, not a constant
       2. on a miss, calls the fulfilment service through the Service Framework, wrapped so that
          ANY failure (timeout, bad response, service down) is caught and degrades to "no result"
          - it is designed to never let an exception escape to the controller
       3. validates the returned tier against the configurable set of valid tiers before
          trusting/caching it
   - looks up the resolved tier's Business Manager Content Asset and returns its HTML body as
     part of the JSON response
        |
        v
Client widget renders that HTML into the placeholder (or leaves it hidden on any failure)
```

**Service Framework integration.** The call to the external fulfilment endpoint goes through a
small, reusable REST-service wrapper (`scripts/services/RestService.js` + `Service.js`) built on
top of B2C Commerce's `dw.svc.LocalServiceRegistry`, so the endpoint URL, credentials, timeout,
and retry/circuit-breaker behavior are all Business Manager Service configuration - never
hardcoded in the cartridge - and can be repointed to a real provider with zero code changes.

**Mocking, fully dynamic.** The same wrapper also supports Business Manager's "Mocked" Service
mode. When mocked, the response is resolved from small JSON fixture files
(`scripts/services/mocks/fulfillment/*.json`) keyed by a scenario name - adding a brand-new mock
scenario (a new error code, a new tier combination, etc.) is just adding a new JSON file, never a
code change. Which scenario fires is itself a runtime parameter (see Testing below), not a
hardcoded sku check.

**One cache layer, on the server.** Every ajax request is answered by a server-side cache keyed
by sku+country (TTL from a Site Preference), so repeated lookups for the same product - across
all shoppers, not just one browser session - skip the external fulfilment service entirely
instead of re-calling it. There's no client-side cache: it would only ever save a round-trip to
the app's own server, which the server-side cache already answers fast. A forced mock scenario
always bypasses this cache, so a tester always sees the scenario they asked for.

## 3. Configuration reference

Nothing here is hardcoded - it all lives in Business Manager config, Content Assets, or a small
JSON fixture per mock scenario. Full step-by-step setup is in `docs/DELIVERY-ESTIMATION.md`
section 3; this is the short version.

**Site Preferences** (custom attribute group `Fulfillment` on `SitePreferences`):

| ID | Type | Default | Purpose |
| --- | --- | --- | --- |
| `fulfillmentEnabled` | Boolean | `false` | Master on/off switch for the whole feature (markup, JS/CSS, service call), per site |
| `fulfillmentCacheTTLMinutes` | Integer | `15` | How long a resolved sku+country tier is trusted before it's re-resolved |
| `fulfillmentValidTiers` | Set of String | `SAME_DAY`, `NEXT_DAY`, `STANDARD` | Whitelist of tier values accepted from the service; anything else is treated as a failed lookup |

**Service configuration** (Administration > Operations > Services):

| Setting | Value |
| --- | --- |
| Service ID | `fulfillment.http.get` (Type: HTTP) |
| Credential | `fulfillment.http.get.cred` - URL + Basic Auth user/password |
| Profile | `fulfillment.http.get.profile` - 5000 ms timeout |
| Mode | **Live** (calls the real/Beeceptor URL) or **Mocked** (uses the JSON fixtures below) |

**Content Assets** (Merchandising > Content > Content Assets) - one per tier, Online = Yes, Body
field holds the shopper-facing copy:

| Content Asset ID | Tier |
| --- | --- |
| `delivery-same-day` | `SAME_DAY` |
| `delivery-next-day` | `NEXT_DAY` |
| `delivery-standard` | `STANDARD` |

**Mock scenario fixtures** - one JSON file per scenario, no code change to add a new one:
`cartridge/scripts/services/mocks/fulfillment/<SCENARIO_KEY>.json` (see the scenario table in
section 4.3 below).

**Custom cache**: `fulfillment-tier-cache`, registered declaratively via
`cartridges/plugin_fulfillment/caches.json` (referenced from `package.json`), not through a BM
screen. `expireAfterSeconds: 900` is the platform's hard ceiling; the dynamic
`fulfillmentCacheTTLMinutes` preference above controls the effective TTL underneath that ceiling
(`fulfillmentHelper.js` stores its own `expiresAt` timestamp and checks it on read, since
`Cache#put` itself takes no TTL argument).

## 4. How to test it

### 4.1 Prerequisites (one-time Business Manager setup)

See `docs/DELIVERY-ESTIMATION.md` section 3 for exact steps. In short, you need:

1. `fulfillmentEnabled = true` (Site Preference) for the site you're testing on.
2. The `fulfillment.http.get` Service configured (credential + profile), in either **Live** mode
   (calls a real/Beeceptor endpoint) or **Mocked** mode (uses the JSON fixtures - recommended for
   day-to-day/demo testing, since it has zero external dependency and zero rate limits).
3. The three `delivery-same-day` / `delivery-next-day` / `delivery-standard` Content Assets
   created and online, each with body copy authored.

### 4.2 Basic functional test (no mocking)

1. Open any in-stock product's PDP and select a fully-specified variant.
2. Confirm the delivery message appears under "Availability" within about a second, with no
   layout jump.
3. Switch to a different variant - the message should update (or disappear, if that variant is
   out of stock/incomplete).
4. Re-select a variant you already viewed this session - open the browser's Network tab. A new
   `Product-Fulfillment` request is still made (there's no client cache), but it should resolve
   quickly, served from the server-side cache (`cached: true` in the JSON response) instead of
   re-calling the external fulfilment service.
5. Turn `fulfillmentEnabled` off and reload the PDP - confirm the block, and its JS/CSS, are
   completely absent from the page (view source).

### 4.3 Testing specific scenarios with `mockScenario` (recommended)

Every scenario is forceable end-to-end through the real widget, purely via a URL query parameter -
no sku juggling, no template changes. For example:

```
https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/womens/clothing/outfits/in-store-setM.html?lang=en_US&mockScenario=DELIVERY-TEST-SAME-DAY
```

**This only takes effect when the `fulfillment.http.get` Service is in Mocked mode** (Business
Manager > Administration > Operations > Services). In Live mode, `mockScenario` is read but never
consulted - the real HTTP call is made instead, using the page's actual product sku. If you add
`?mockScenario=...` to a PDP URL and don't see the expected scenario, check the Service's mode
first.

How it works once Mocked mode is on: the client widget reads `mockScenario` straight from the
page URL, sends it as an extra ajax parameter, and the server-side cache is bypassed for that
request - so the forced scenario is always honored, even on repeat views of the same product in
the same session.

Available scenario keys (`scripts/services/mocks/fulfillment/<KEY>.json`) you can substitute for
`DELIVERY-TEST-SLOW` in the URL above:

| Scenario key | Simulates | Expected widget behavior |
| --- | --- | --- |
| `DELIVERY-TEST-SAME-DAY` | Successful `SAME_DAY` response | Message renders with the `SAME_DAY` Content Asset's copy |
| `DELIVERY-TEST-NEXT-DAY` | Successful `NEXT_DAY` response | Message renders with the `NEXT_DAY` Content Asset's copy |
| `DELIVERY-TEST-STANDARD` | Successful `STANDARD` response | Message renders with the `STANDARD` Content Asset's copy |
| `DELIVERY-TEST-ERROR` | Upstream `500` error | Block stays hidden; no console/JS error |
| `DELIVERY-TEST-UNAUTHORIZED` | Upstream `401` (bad credentials) | Block stays hidden; no console/JS error |
| `DELIVERY-TEST-SLOW` | A slow upstream response | In **Mocked** mode this resolves immediately as `STANDARD` (sandboxed scripts can't simulate a real network delay); to see the actual ~4s delay/timeout behavior, test against the **Live**/Beeceptor endpoint instead (section 4 of `docs/DELIVERY-ESTIMATION.md`) |

You can also omit `mockScenario` and instead pass any arbitrary sku - a deterministic (but
sku-dependent) tier is computed on the fly when mocked, so every product still shows one of the
three tiers without needing a dedicated fixture per sku.

### 4.4 Edge cases worth confirming

- **Slow/down service, Live mode:** with the Service pointed at an unreachable/slow URL, confirm
  the PDP still loads instantly and the block simply never appears (check the client-side request
  times out after a few seconds rather than hanging indefinitely).
- **Unrecognized tier:** if the upstream response returns a tier outside the configured
  `fulfillmentValidTiers` Site Preference, confirm the block stays hidden (treated the same as a
  failed lookup) rather than showing blank/broken content.
- **Repeat variant reselection across tiers:** switch between two variants that resolve to
  different tiers a few times - confirm the correct message is shown each time and no stale tier
  "leaks" from the previous selection.
