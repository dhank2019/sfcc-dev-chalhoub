'use strict';

/**
 * Helper orchestrating the PDP "delivery estimation" (fulfilment tier) feature:
 *  - feature flag gating (Site Preference)
 *  - server-side response caching (CacheMgr) so repeat requests for the same sku+country
 *    never re-hit the external service
 *  - resilient call to the fulfilment Service Framework service (never throws)
 */

var CacheMgr = require('dw/system/CacheMgr');
var Logger = require('dw/system/Logger').getLogger('plugin_fulfillment', 'fulfillmentHelper');
var Site = require('dw/system/Site');

var CACHE_ID = 'fulfillment-tier-cache';
var DEFAULT_VALID_TIERS = ['SAME_DAY', 'NEXT_DAY', 'STANDARD'];
var DEFAULT_CACHE_TTL_MINUTES = 15;

/**
 * @returns {boolean} whether the feature is turned on for the current site
 */
function isFulfillmentEnabled() {
    var prefValue = Site.getCurrent().getCustomPreferenceValue('fulfillmentEnabled');
    // Default to disabled when the preference has not been configured yet, so the feature is
    // opt-in and can never surface an unfinished/un-reviewed integration in production.
    return prefValue === true;
}

/**
 * Reads the set of recognized delivery tier values from the `fulfillmentValidTiers` Site
 * Preference (type: Set of Strings). Falls back to the built-in default set when unconfigured.
 * @returns {string[]} valid tier values for the current site
 */
function getValidTiers() {
    var configured = Site.getCurrent().getCustomPreferenceValue('fulfillmentValidTiers');

    // Set-of-string preferences come back as a Collection, not a native Array.
    if (configured && configured.length > 0) {
        return Array.prototype.slice.call(configured);
    }

    return DEFAULT_VALID_TIERS;
}

/**
 * @param {string} tier - candidate delivery tier value
 * @returns {boolean} whether tier is one of the site's currently configured valid tiers
 */
function isValidTier(tier) {
    return getValidTiers().indexOf(tier) > -1;
}

/**
 * @returns {number} cache TTL, in seconds, read from Site Preferences (minutes) with a safe default
 */
function getCacheTTLSeconds() {
    var minutes = Site.getCurrent().getCustomPreferenceValue('fulfillmentCacheTTLMinutes');
    var safeMinutes = (typeof minutes === 'number' && minutes > 0) ? minutes : DEFAULT_CACHE_TTL_MINUTES;
    return safeMinutes * 60;
}

/**
 * @param {string} sku - product id
 * @param {string} country - ISO country code
 * @returns {string} normalized cache key
 */
function buildCacheKey(sku, country) {
    // String(...) avoids a Rhino ConsString, which Cache#get/#put's Java overload resolution
    // won't accept as a String argument.
    return String((sku || '').toUpperCase() + '_' + (country || '').toUpperCase());
}

/**
 * Looks up a previously cached tier for this sku+country. Entries past their dynamic
 * expiresAt (see cacheTier below) are treated as a miss even though the underlying platform
 * cache entry still exists until caches.json's expireAfterSeconds ceiling.
 * @param {string} sku - product id
 * @param {string} country - ISO country code
 * @returns {string|null} cached tier, or null on cache miss/expiry
 */
function getCachedTier(sku, country) {
    var cache = CacheMgr.getCache(CACHE_ID);
    var key = buildCacheKey(sku, country);
    var entry = cache.get(key, function () {
        return null;
    });

    if (!entry || (entry.expiresAt && Date.now() > entry.expiresAt)) {
        return null;
    }

    return entry.tier;
}

/**
 * Caches a resolved tier for this sku+country for the configured TTL. Only successful,
 * recognized tiers are cached - errors/timeouts are never cached so the next request retries
 * the live service instead of being stuck with a failure.
 *
 * dw.system.Cache#put only accepts (key, value); there's no per-call TTL argument. Storing an
 * `expiresAt` timestamp alongside the tier lets the `fulfillmentCacheTTLMinutes` Site
 * Preference control the effective TTL at runtime (checked in getCachedTier above).
 * @param {string} sku - product id
 * @param {string} country - ISO country code
 * @param {string} tier - resolved delivery tier
 * @returns {void}
 */
function cacheTier(sku, country, tier) {
    var cache = CacheMgr.getCache(CACHE_ID);
    var key = buildCacheKey(sku, country);
    cache.put(key, { tier: tier, expiresAt: Date.now() + (getCacheTTLSeconds() * 1000) });
}

/**
 * Resolves the delivery tier for a given sku + country via the Service Framework. Never
 * throws: any service error, timeout, or unexpected payload results in a graceful
 * "unavailable" result so the PDP never breaks or blocks on fulfilment data.
 *
 * @param {string} sku - product id / sku
 * @param {string} country - ISO country code
 * @param {string} [mockScenario] - Optional mock fixture key (see
 *     scripts/services/mocks/fulfillment/) to force a specific scenario regardless of sku. Only
 *     consulted by the service's mockFull callback when the Service's Mode is Mocked in
 *     Business Manager; ignored for real HTTP calls.
 * @returns {{success: boolean, tier: (string|null), cached: boolean}} resolution result
 */
function getDeliveryTier(sku, country, mockScenario) {
    if (!isFulfillmentEnabled() || !sku || !country) {
        return { success: false, tier: null, cached: false };
    }

    // A forced mock scenario bypasses the cache so testers reliably see the requested
    // fixture instead of a previously cached tier for that sku+country.
    if (!mockScenario) {
        var cached = getCachedTier(sku, country);
        if (cached) {
            return { success: true, tier: cached, cached: true };
        }
    }

    try {
        var fulfillmentService = require('*/cartridge/scripts/services/fulfillmentService');
        var service = fulfillmentService.getFulfillmentService();
        var result = service.call({ sku: sku, country: country, mockScenario: mockScenario });

        if (result.status === 'OK' && result.object && result.object.success && isValidTier(result.object.tier)) {
            cacheTier(sku, country, result.object.tier);
            return { success: true, tier: result.object.tier, cached: false };
        }

        if (result.status === 'OK' && result.object && result.object.success) {
            Logger.warn(
                'Fulfilment service returned an unrecognized tier "{0}" for sku={1} country={2}',
                result.object.tier,
                sku,
                country
            );
        } else {
            Logger.warn(
                'Fulfilment lookup failed for sku={0} country={1} status={2} error={3}',
                sku,
                country,
                result.status,
                (result.object && result.object.error) || result.errorMessage || 'n/a'
            );
        }
    } catch (e) {
        var error = JSON.stringify(e);
        Logger.error('Unexpected error resolving delivery tier for sku={0} country={1}: {2}', sku, country, error);
    }

    return { success: false, tier: null, cached: false };
}

module.exports = {
    isFulfillmentEnabled: isFulfillmentEnabled,
    getCacheTTLSeconds: getCacheTTLSeconds,
    getDeliveryTier: getDeliveryTier,
    getValidTiers: getValidTiers,
    isValidTier: isValidTier
};
