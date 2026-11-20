'use strict';

/**
 * Service Framework integration for the external Fulfilment (delivery estimation) service.
 *
 * Endpoint contract:
 *   GET {{ENDPOINT}}/fulfillment?sku={sku}&country={country}
 *   Authorization: Basic {{base64(username:password)}}
 *
 * Success (200): { "sku": "...", "country": "...", "tier": "SAME_DAY|NEXT_DAY|STANDARD" }
 * Error (400/401/500): { "error": "error_type", "message": "error_message" }
 *
 * Service configuration (URL, timeout, Basic Auth credential, mock-mode flag) is owned by
 * Business Manager (Administration > Operations > Services > fulfillment.http.get) and is
 * not hardcoded here, so ops can repoint to the real fulfilment provider, rotate credentials, or
 * flip Mock Mode without a code deployment. See docs/DELIVERY-ESTIMATION.md.
 */

var RestService = require('*/cartridge/scripts/services/RestService');
var StringUtils = require('dw/util/StringUtils');
var Logger = require('dw/system/Logger').getLogger('plugin_fulfillment', 'fulfillmentService');

var SERVICE_ID = 'fulfillment.http.get';

/**
 * Deterministically derives a "pretend tier" for a sku+country, so the offline mock is
 * repeatable across test runs (same sku always yields the same tier) while still exercising
 * all three tiers across a real catalog. Two reserved demo skus simulate failure modes that are
 * hard to otherwise reproduce on demand: a 3-5s delay and an intermittent 500.
 * @param {string} sku - product id / sku
 * @returns {string} one of SAME_DAY | NEXT_DAY | STANDARD
 */
function deterministicTier(sku) {
    var tiers = ['SAME_DAY', 'NEXT_DAY', 'STANDARD'];
    var sum = 0;
    for (var i = 0; i < sku.length; i += 1) {
        sum += sku.charCodeAt(i);
    }
    return tiers[sum % tiers.length];
}

/**
 * Cartridge-relative folder holding one JSON fixture per mock scenario. Add a new
 * `<SCENARIO_KEY>.json` file here to add a scenario - no code change or deployment of service
 * code required. Each fixture is either `{ "statusCode": 200, "tier": "SAME_DAY" }` or
 * `{ "statusCode": <4xx|5xx>, "error": "...", "message": "..." }`.
 */
var MOCK_FIXTURES_PATH = '*/cartridge/scripts/services/mocks/fulfillment';

/**
 * @description Builds the final { success, tier } / { success: false, ... } result straight from
 * a loaded fixture, in the same shape FulfillmentRestService#parseResponse would otherwise
 * produce (mockFull bypasses parseResponse entirely, so this duplicates its result contract).
 * @param {Object} fixture - Parsed fixture content (see MOCK_FIXTURES_PATH doc above)
 * @returns {Object} { success, tier } on success, or { success: false, statusCode, error }
 */
function buildMockResult(fixture) {
    if (fixture.tier) {
        return { success: true, tier: fixture.tier };
    }

    return {
        success: false,
        statusCode: fixture.statusCode,
        error: fixture.error || fixture.message || 'unexpected_response'
    };
}

/**
 * @category plugin_fulfillment
 * @subcategory services
 * @class FulfillmentRestService
 * @classdesc RestService wrapper for the external Fulfilment (delivery estimation) HTTP service.
 */
function FulfillmentRestService() {
    var object = require('*/cartridge/scripts/util/object');

    RestService.apply(this, arguments);

    var self = this;

    this.callbacks = object.assign(this.callbacks, {
        createRequest: function (svc, params) {
            return self.createRequest(svc, params);
        },
        parseResponse: function (svc, httpClient) {
            return self.parseResponse(svc, httpClient);
        },
        filterLogMessage: function (msg) {
            // Strip the Authorization header from service communication logs.
            return msg.replace(/Authorization:\s*Basic\s+\S+/gi, 'Authorization: Basic ***');
        },
        mockFull: function (svc, params) {
            return self.mockFull(svc, params);
        }
    });
}

FulfillmentRestService.prototype = Object.create(RestService.prototype);

/**
 * @override
 * @description Builds the GET request (sku/country query params + HTTP Basic Auth). The query
 * string is built manually because dw.svc.HTTPService#addParam only substitutes {placeholder}
 * tokens declared in the service URL template, and this endpoint's URL has none.
 * @param {dw.svc.HTTPService} svc - Service instance
 * @param {Object} params - Call parameters, expects { sku, country }
 * @returns {null} No request body for GET
 */
FulfillmentRestService.prototype.createRequest = function (svc, params) {
    svc.setRequestMethod('GET');

    var baseUrl = svc.getURL();
    var queryString = 'sku=' + encodeURIComponent(params.sku) + '&country=' + encodeURIComponent(params.country);
    var separator = baseUrl.indexOf('?') === -1 ? '?' : '&';
    svc.setURL(baseUrl + separator + queryString);

    // HTTP Basic Authentication, per the service contract. Username/password live on the
    // Service Credential in Business Manager - never hardcoded in source.
    var credential = svc.getConfiguration().getCredential();
    if (credential && credential.getUser()) {
        this.addAuthorization({
            type: 'Basic',
            credentials: StringUtils.encodeBase64(credential.getUser() + ':' + credential.getPassword())
        }, svc);
    }

    svc.addHeader('Accept', 'application/json');

    return null;
};

/**
 * @override
 * @description Maps the fulfilment endpoint's JSON contract to a simple success/tier result
 * @param {dw.svc.HTTPService} svc - Service instance
 * @param {Object} httpClient - Response object (statusCode/text)
 * @returns {Object} { success, tier } on success, or { success: false, statusCode, error }
 */
FulfillmentRestService.prototype.parseResponse = function (svc, httpClient) {
    var statusCode = httpClient.statusCode;
    var raw = httpClient.text;
    var parsed = null;

    try {
        parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {
        Logger.warn('Fulfillment service returned non-JSON payload: {0}', e.message);
    }

    if (statusCode === 200 && parsed && parsed.tier) {
        return { success: true, tier: parsed.tier };
    }

    return {
        success: false,
        statusCode: statusCode,
        error: (parsed && (parsed.error || parsed.message)) || 'unexpected_response'
    };
};

/**
 * @override
 * @description Offline safety net used only when the Service's "Mode" is set to Mocked in
 * Business Manager (e.g. the real/Beeceptor endpoint is unreachable or not yet configured). Lets
 * the whole feature be demoed/tested with zero external dependency.
 *
 * mockFull (rather than mockCall) is used deliberately: mockCall only receives createRequest's
 * return value (always null for this GET service), losing access to sku/country/mockScenario,
 * whereas mockFull receives the original call params - the same shape createRequest gets - and
 * replaces parseResponse too, so it can return the final { success, tier } result directly.
 *
 * Scenario resolution is fully dynamic/file-driven (no hardcoded sku checks): an explicit
 * `params.mockScenario` always wins, so any scenario fixture can be forced regardless of sku -
 * otherwise the sku itself doubles as the fixture lookup key. Add a new
 * `<KEY>.json` file under `scripts/services/mocks/fulfillment/` to add a scenario. If no fixture
 * matches, a deterministic (but still sku-dependent) tier is computed so arbitrary/untagged skus
 * still exercise all three tiers in mock mode without needing a fixture file each.
 * @param {dw.svc.HTTPService} svc - Service instance
 * @param {Object} params - Call parameters, expects { sku, country, mockScenario (optional) }
 * @returns {Object} { success, tier } on success, or { success: false, statusCode, error }
 */
FulfillmentRestService.prototype.mockFull = function (svc, params) {
    var mockLoader = require('*/cartridge/scripts/util/mockLoader');
    var scenarioKey = params.mockScenario || params.sku;
    var fixture = mockLoader.load(MOCK_FIXTURES_PATH, scenarioKey);

    if (fixture) {
        return buildMockResult(fixture);
    }

    return { success: true, tier: deterministicTier(params.sku) };
};

/**
 * @returns {dw.svc.HTTPService} configured fulfilment HTTP service
 */
function getFulfillmentService() {
    var fulfillmentRestService = new FulfillmentRestService(SERVICE_ID);

    return fulfillmentRestService.getService();
}

module.exports = {
    getFulfillmentService: getFulfillmentService
};
