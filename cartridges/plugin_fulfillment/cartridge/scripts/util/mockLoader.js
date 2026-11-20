'use strict';

/**
 * @category plugin_fulfillment
 * @subcategory util
 * @description Dynamically loads a JSON mock fixture bundled with a cartridge, keyed by name, so
 * new offline/mock-mode scenarios can be added by simply dropping a new JSON file under the
 * mocks folder - no code change or deployment of service code required.
 * @param {string} mocksPath - Cartridge-relative folder path, e.g.
 *     '*\/cartridge/scripts/services/mocks/fulfillment'
 * @param {string} key - Fixture file name (case-sensitive), without the .json extension
 * @returns {Object|null} Parsed fixture content, or null when no fixture exists for key
 */
function load(mocksPath, key) {
    if (!mocksPath || !key) {
        return null;
    }

    try {
        return require(mocksPath + '/' + key + '.json');
    } catch (e) {
        return null;
    }
}

module.exports = {
    load: load
};
