# Storefront Reference Architecture (SFRA)

This is a repository for the Storefront Reference Architecture reference application.

Storefront Reference Architecture has a base cartridge (`app_storefront_base`) provided by Commerce Cloud that is never directly customized or edited. Instead, customization cartridges are layered on top of the base cartridge. This change is intended to allow for easier adoption of new features and bug fixes.
Storefront Reference Architecture supplies an [plugin_applepay](https://github.com/SalesforceCommerceCloud/plugin-applepay) plugin cartridge to demonstrate how to layer customizations for the reference application.

Your feedback on the ease-of-use and limitations of this new architecture is invaluable during the developer preview. Particularly, feedback on any issues you encounter or workarounds you develop for efficiently customizing the base cartridge without editing it directly.

# The latest version

The latest version of SFRA is 8.0.0

# Getting Started

1. Clone this repository.

2. Run `npm install` to install all of the local dependencies (SFRA has been tested with v24.x)

3. Run `npm run compile:js` from the command line that would compile all client-side JS files. Run `npm run compile:scss` and `npm run compile:fonts` that would do the same for css and fonts.

4. Create `dw.json` file in the root of the project. Providing a [WebDAV access key from BM](https://documentation.b2c.commercecloud.salesforce.com/DOC1/index.jsp?topic=%2Fcom.demandware.dochelp%2Fcontent%2Fb2c_commerce%2Ftopics%2Fadmin%2Fb2c_access_keys_for_business_manager.html) in the `password` field is optional, as you will be prompted if it is not provided.

```json
{
    "hostname": "your-sandbox-hostname.demandware.net",
    "username": "AM username like me.myself@company.com",
    "password": "your_webdav_access_key",
    "code-version": "version_to_upload_to"
}
```

5. Run `npm run uploadCartridge`. It will upload `app_storefront_base`, `modules` and `bm_app_storefront_base` cartridges to the sandbox you specified in `dw.json` file.

6. Use https://github.com/SalesforceCommerceCloud/storefrontdata to zip and import site data on your sandbox.

7. Add the `app_storefront_base` cartridge to your cartridge path in _Administration > Sites > Manage Sites > RefArch - Settings_ (Note: This should already be populated by the sample data in Step 6).

8. You should now be ready to navigate to and use your site.

# PDP Delivery Estimation (Fulfilment Tier) Plugin

The `plugin_fulfillment` cartridge (layered in front of `app_storefront_base`, never editing it)
adds a business-managed "delivery estimation" message to the Product Detail Page, resolved from
an external fulfilment service. Add it to your cartridge path **before** `app_storefront_base`
(e.g. `plugin_fulfillment:app_storefront_base`).


## What's implemented (functional overview)

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
- **Doesn't nag the fulfilment service repeatedly.** The same sku+country combination is only
  re-resolved periodically; repeat lookups within that window are served from a server-side
  cache instead of re-calling the external service.
- **One master switch.** A single Business Manager setting (`fulfillmentEnabled`) turns the
  entire feature on/off per site - markup, JS, CSS, and the service call all disappear together
  when it's off, with zero deployment.
- **Which tiers are valid is itself configurable.** The set of recognized tier values
  (`SAME_DAY`/`NEXT_DAY`/`STANDARD` by default) is a Business Manager setting, not a hardcoded
  list - so a tier can be added, renamed, or retired without a code change (paired with a
  matching Content Asset for the new tier's copy).

## How it works (technical workflow)

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

## Configuration reference

Nothing here is hardcoded - it all lives in Business Manager config, Content Assets, or a small
JSON fixture per mock scenario. 

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

**External service (Beeceptor), direct call:**

```
curl --location 'https://sfcc-fulfillment.free.beeceptor.com/fulfillment?sku=22956726M&country=India' \
--header 'Authorization: Basic sdfasrgadg'
```

> Note: this is a free Beeceptor tier - only 50 requests/day are allowed, so prefer **Mocked**
> mode (above) for day-to-day testing.

**Content Assets** (Merchandising > Content > Content Assets) - one per tier, Online = Yes, Body
field holds the shopper-facing copy:

| Content Asset ID | Tier |
| --- | --- |
| `delivery-same-day` | `SAME_DAY` |
| `delivery-next-day` | `NEXT_DAY` |
| `delivery-standard` | `STANDARD` |

**Mock scenario fixtures** - one JSON file per scenario, no code change to add a new one:
`cartridge/scripts/services/mocks/fulfillment/<SCENARIO_KEY>.json` (see the scenario table under
"Testing specific scenarios" below).

**Custom cache**: `fulfillment-tier-cache`, registered declaratively via
`cartridges/plugin_fulfillment/caches.json` (referenced from `package.json`), not through a BM
screen. `expireAfterSeconds: 900` is the platform's hard ceiling; the dynamic
`fulfillmentCacheTTLMinutes` preference above controls the effective TTL underneath that ceiling
(`fulfillmentHelper.js` stores its own `expiresAt` timestamp and checks it on read, since
`Cache#put` itself takes no TTL argument).

## How to test it

### Prerequisites (one-time Business Manager setup)

In short, you need:

1. `fulfillmentEnabled = true` (Site Preference) for the site you're testing on.
2. The `fulfillment.http.get` Service configured (credential + profile), in either **Live** mode
   (calls a real/Beeceptor endpoint) or **Mocked** mode (uses the JSON fixtures - recommended for
   day-to-day/demo testing, since it has zero external dependency and zero rate limits).
3. The three `delivery-same-day` / `delivery-next-day` / `delivery-standard` Content Assets
   created and online, each with body copy authored.

### Basic functional test (no mocking)

With the `fulfillment.http.get` Service in **Live** mode, it's currently configured to return
`SAME_DAY`/`NEXT_DAY` for a couple of specific SKUs only - every other product falls back to
`STANDARD`:

| Storefront URL | Tier shown |
| --- | --- |
| [platinum-v-neck-suit-dress/22956726M](https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/platinum-v-neck-suit-dress/22956726M.html?lang=en_US) | Same Day Delivery |
| [black-flat-front-wool-suit/25686544M](https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/black-flat-front-wool-suit/25686544M.html?lang=en_US) | Next Day Delivery |
| Any other product, e.g. [sleeveless-sheath-dress/25589481M](https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/sleeveless-sheath-dress/25589481M.html?lang=en_US) | Standard Delivery |

To see the ~4s slow-response/timeout path against the live endpoint:
[Delay in API (4 seconds)](https://bdcl-002.dx.commercecloud.salesforce.com/on/demandware.store/Sites-Site/default%3bsite%3dRefArch/ViewStorefrontToolkit-Start?StartURL=https%3a%2f%2fbdcl-002%2emy%2ecommercecloud%2esalesforce%2ecom%2fs%2fRefArch%2fDELIVERY-TEST-SLOW%2ehtml%3flang%3ddefault%26__previewID%3dclVno9qdABIX3Q05otIDXZvrqy4cQ2PfCEpWpcYHl58)

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

### Testing specific scenarios with `mockScenario` (recommended)

Every scenario is forceable end-to-end through the real widget, purely via a URL query parameter -
no sku juggling, no template changes. First, switch the `fulfillment.http.get` Service to Mocked
mode (Business Manager > Administration > Operations > Services). For example:

```
https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/womens/clothing/outfits/in-store-setM.html?lang=en_US&mockScenario=DELIVERY-TEST-SAME-DAY
```

Ready-to-use links against a real product (once Mocked mode is on):

| Scenario | URL |
| --- | --- |
| Error | `https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/sleeveless-sheath-dress/25589481M.html?lang=en_US&mockScenario=DELIVERY-TEST-ERROR` |
| Same Day Delivery | `https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/sleeveless-sheath-dress/25589481M.html?lang=en_US&mockScenario=DELIVERY-TEST-SAME-DAY` |
| Next Day Delivery | `https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/sleeveless-sheath-dress/25589481M.html?lang=en_US&mockScenario=DELIVERY-TEST-NEXT-DAY` |
| Standard Delivery | `https://bdcl-002.my.commercecloud.salesforce.com/s/RefArch/sleeveless-sheath-dress/25589481M.html?lang=en_US&mockScenario=DELIVERY-TEST-STANDARD` |

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
| `DELIVERY-TEST-SLOW` | A slow upstream response | In **Mocked** mode this resolves immediately as `STANDARD` (sandboxed scripts can't simulate a real network delay); to see the actual ~4s delay/timeout behavior, test against the **Live**/Beeceptor endpoint instead 
You can also omit `mockScenario` and instead pass any arbitrary sku - a deterministic (but
sku-dependent) tier is computed on the fly when mocked, so every product still shows one of the
three tiers without needing a dedicated fixture per sku.

### Edge cases worth confirming

- **Slow/down service, Live mode:** with the Service pointed at an unreachable/slow URL, confirm
  the PDP still loads instantly and the block simply never appears (check the client-side request
  times out after a few seconds rather than hanging indefinitely).
- **Unrecognized tier:** if the upstream response returns a tier outside the configured
  `fulfillmentValidTiers` Site Preference, confirm the block stays hidden (treated the same as a
  failed lookup) rather than showing blank/broken content.
- **Repeat variant reselection across tiers:** switch between two variants that resolve to
  different tiers a few times - confirm the correct message is shown each time and no stale tier
  "leaks" from the previous selection.

# NPM scripts

Use the provided NPM scripts to compile and upload changes to your Sandbox.

## Compiling your application

-   `npm run compile:scss` - Compiles all .scss files into CSS.
-   `npm run compile:js` - Compiles all .js files and aggregates them.
-   `npm run compile:fonts` - Copies all needed font files. Usually, this only has to be run once.

Both `compile:js` and `compile:scss` also compile the `plugin_fulfillment` cartridge's client
assets (see `bin/compilePlugin.js`). `npm run watch` only watches `app_storefront_base`; after
editing `plugin_fulfillment`'s client JS/SCSS, re-run the relevant `compile:*` command and
`npm run uploadCartridge` (or upload just that cartridge).

If you are having an issue compiling scss files, try running 'npm rebuild node-sass' from within your local repo.

## Linting your code

`npm run lint` - Execute linting for all JavaScript and SCSS files in the project. You should run this command before committing your code.

## Watching for changes and uploading

`npm run watch` - Watches everything and recompiles (if necessary) and uploads to the sandbox. Requires a valid `dw.json` file at the root that is configured for the sandbox to upload.

## Uploading

`npm run uploadCartridge` - Will upload `app_storefront_base`, `modules` and `bm_app_storefront_base` to the server. Requires a valid `dw.json` file at the root that is configured for the sandbox to upload.

`npm run upload <filepath>` - Will upload a given file to the server. Requires a valid `dw.json` file.

# Testing

## Running unit tests

You can run `npm test` to execute all unit tests in the project. Run `npm run cover` to get coverage information. Coverage will be available in `coverage` folder under root directory.

-   UNIT test code coverage:

1. Open a terminal and navigate to the root directory of the mfsg repository.
2. Enter the command: `npm run cover`.
3. Examine the report that is generated. For example: `Writing coverage reports at [/Users/yourusername/SCC/sfra/coverage]`
4. Navigate to this directory on your local machine, open up the index.html file. This file contains a detailed report.

## Running integration tests

Integration tests are located in the `storefront-reference-architecture/test/integration` directory.

To run integration tests you can use the following command:

```
npm run test:integration
```

**Note:** Please note that short form of this command will try to locate URL of your sandbox by reading `dw.json` file in the root directory of your project. If you don't have `dw.json` file, integration tests will fail.
sample `dw.json` file (this file needs to be in the root of your project)

```json
{
    "hostname": "devxx-sitegenesis-dw.demandware.net"
}
```

You can also supply URL of the sandbox on the command line:

```
npm run test:integration -- --baseUrl devxx-sitegenesis-dw.demandware.net
```

## Running acceptance tests

**Prerequisite:** The Java Runtime Environment (JRE 8+) is required to run Selenium and the acceptance tests. If you have not done so, install Java on your machine.

Acceptance tests are located in the `storefront-reference-architecture/test/acceptance` directory.

The acceptance tests will run against the site specified in the hostname property of `dw.json`. ie. To run the tests on `abcd-123.dx.commercecloud.salesforce.com`, in your dw.json set the following:

```
"hostname": "abcd-123.dx.commercecloud.salesforce.com"
```

There are several NPM scripts available for running the acceptance tests.

Tests will generally run on Chrome, Safari, and Firefox. To change the browser the tests are run in, add `-- --profile=safari` ie. `npm run test:acceptance:smoke -- --profile=safari`

To run the tests in chrome headless mode, set a HEADLESS environment to true before starting the npm run. ie. `HEADLESS=true && npm run test:acceptance:smoke -- --profile=chrome`

-   `test:acceptance:custom` - runs all tests (Note: some tests will fail as the browser size defaults to desktop)
-   `test:acceptance:deep` - runs all storefront tests
-   `test:acceptance:smoke` - runs happy path tests
-   `test:acceptance:pagedesigner` - runs page designer tests
-   `test:acceptance:desktop` - runs storefront desktop tests
-   `test:acceptance:mobile` - runs storefront mobile tests
-   `test:acceptance:tablet` - runs storefront tablet tests

### Notes

-   Selenium can be finicky to start. If the tests fail to start, simply rerun the command again until the tests start.
-   If you see version compatibility issues between browser and the driver, try configuring specific version of the driver in the [codecept config file](./codecept.conf.js). See the resolved [github issue](https://github.com/codeceptjs/CodeceptJS/issues/2885) for details.

#### Running the tests in Safari

After every test, Webdriverio's automated drivers will close and start a new safaridriver instance. Sometimes, the existing safaridriver does not close before webdriverio attempts to start a new instance and the test execution will error out because the selected port is still in use.

To workaround this:
-   In a separate terminal manually start the safaridriver: `safaridriver -p 4444`
-   In codecept.conf.js, update the Webdriver helper to point to `port: 4444,`. This will [force webdriverio to use your safaridriver instance for every test.](https://webdriver.io/docs/driverbinaries#safaridriver)
-   Start the tests: `npm run test:acceptance:smoke -- --profile=safari`

# [Contributing to SFRA](./CONTRIBUTING.md)

# Page Designer Components for Storefront Reference Architecture

See: [Page Designer Components](./page-designer-components.md)

# Bootstrap 5 Migration

See: [Bootstrap 5 Migration Guide](./bootstrap-5-migration.md)
