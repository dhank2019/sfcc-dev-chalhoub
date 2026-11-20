'use strict';

/**
 * @namespace Product
 */

var server = require('server');

server.extend(module.superModule);

/**
 * Product-Fulfillment : Ajax-only endpoint called from the PDP, after an in-stock variant is
 * selected, to resolve the delivery tier (SAME_DAY | NEXT_DAY | STANDARD) for that sku/country
 * combination and return the business-managed content block to render below availability.
 *
 * This endpoint is intentionally decoupled from Product-Show/Product-Variation: it is called
 * asynchronously by the client only after the PDP has already fully rendered, so a slow or
 * failing fulfilment service can never block or break the initial PDP load. Any failure here
 * degrades to `success:false`, which the client treats as "render nothing" - never an error.
 *
 * @name Base/Product-Fulfillment
 * @function
 * @memberof Product
 * @param {querystringparameter} - pid - Product ID / sku
 * @param {querystringparameter} - country - ISO country code (optional, defaults to the
 *     current request's geolocation/locale country)
 * @param {querystringparameter} - mockScenario - Optional mock-mode fixture key (see
 *     plugin_fulfillment/cartridge/scripts/services/mocks/fulfillment/) to force a specific
 *     scenario for testing; only consulted when the service's Mock Mode is enabled in Business
 *     Manager, ignored otherwise
 * @param {category} - non-sensitive
 * @param {returns} - json
 * @param {serverfunction} - get
 */
server.get('Fulfillment', function (req, res, next) {
    var Locale = require('dw/util/Locale');
    var fulfillmentHelper = require('*/cartridge/scripts/helpers/fulfillmentHelper');
    var contentHelper = require('*/cartridge/scripts/helpers/fulfillmentContentHelper');

    if (!fulfillmentHelper.isFulfillmentEnabled()) {
        res.setStatusCode(404);
        res.json({ success: false });
        return next();
    }

    var pid = req.querystring.pid;
    var country = req.querystring.country;

    if (!country) {
        var currentLocale = Locale.getLocale(req.locale.id);
        country = (req.geolocation && req.geolocation.countryCode) || currentLocale.country;
    }

    if (!pid) {
        res.setStatusCode(400);
        res.json({ success: false });
        return next();
    }

    var mockScenario = req.querystring.mockScenario;
    var result = fulfillmentHelper.getDeliveryTier(pid, country, mockScenario);

    if (!result.success) {
        res.json({ success: false });
        return next();
    }

    var tierContent = contentHelper.getTierContent(result.tier);

    res.json({
        success: true,
        tier: result.tier,
        cached: result.cached,
        contentHtml: tierContent ? tierContent.body.toString() : null
    });

    return next();
});

module.exports = server.exports();
