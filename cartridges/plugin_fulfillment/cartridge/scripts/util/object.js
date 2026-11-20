'use strict';

/**
 * @description Copies own enumerable properties of source onto target
 * @param {Object} to - Target object to merge properties into
 * @param {Object} source - Source object whose own properties are copied onto target
 * @returns {Object} to, with source's own properties merged in
 */
function assignSource(to, source) {
    var result = to;

    if (source) {
        Object.keys(source).forEach(function (key) {
            result[key] = source[key];
        });
    }

    return result;
}

/**
 * @description Minimal Object.assign-like helper used to merge service callback objects
 * @param {Object} target - Target object to merge properties into
 * @param {...Object} sources - Source objects whose own properties are copied onto target
 * @returns {Object} target, with all source properties merged in
 */
function assign(target) {
    var to = Object(target);

    for (var i = 1; i < arguments.length; i += 1) {
        to = assignSource(to, arguments[i]);
    }

    return to;
}

module.exports = {
    assign: assign
};
