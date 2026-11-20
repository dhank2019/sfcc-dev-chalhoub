'use strict';

/**
 * @description Safely parses a JSON string, returning a fallback value instead of throwing
 * @param {string} text - JSON text to parse
 * @param {*} [fallback] - Value to return when text is empty or not valid JSON
 * @returns {*} Parsed value, or fallback when parsing fails
 */
function parse(text, fallback) {
    if (!text) {
        return fallback;
    }

    try {
        var parsed = JSON.parse(text);
        return parsed;
    } catch (e) {
        return fallback;
    }
}

module.exports = {
    parse: parse
};
