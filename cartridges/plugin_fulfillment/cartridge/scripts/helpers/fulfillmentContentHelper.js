'use strict';

/**
 * Resolves the business-managed Content Asset for each delivery tier. Content (copy, image,
 * markup/styling hooks) lives entirely in Business Manager Content Assets, so merchandising can
 * change messaging/imagery per tier with zero code deployment - only the tier -> content asset
 * ID mapping below is a code concern, and it rarely changes.
 */

var ContentMgr = require('dw/content/ContentMgr');
var Logger = require('dw/system/Logger').getLogger('plugin_fulfillment', 'fulfillmentContentHelper');

var TIER_CONTENT_ASSET_IDS = {
    SAME_DAY: 'delivery-same-day',
    NEXT_DAY: 'delivery-next-day',
    STANDARD: 'delivery-standard'
};

/**
 * @param {string} tier - SAME_DAY | NEXT_DAY | STANDARD
 * @returns {{id: string, body: string}|null} the online content asset's body markup, or null if
 *     the tier is unknown, the content asset doesn't exist yet, or it is offline
 */
function getTierContent(tier) {
    var contentAssetId = TIER_CONTENT_ASSET_IDS[tier];
    if (!contentAssetId) {
        return null;
    }

    try {
        var content = ContentMgr.getContent(contentAssetId);
        if (!content || !content.online || !content.custom || !content.custom.body) {
            Logger.warn('Delivery content asset "{0}" is missing or offline for tier {1}', contentAssetId, tier);
            return null;
        }

        return { id: contentAssetId, body: content.custom.body };
    } catch (e) {
        Logger.error('Unable to resolve content asset "{0}" for tier {1}: {2}', contentAssetId, tier, e.message);
        return null;
    }
}

module.exports = {
    getTierContent: getTierContent,
    TIER_CONTENT_ASSET_IDS: TIER_CONTENT_ASSET_IDS
};
