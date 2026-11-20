'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

/**
 * @category plugin_fulfillment
 * @subcategory services
 * @class Service
 * @classdesc Base wrapper around dw/svc/LocalServiceRegistry. Concrete service classes
 * (e.g. RestService) extend `this.callbacks` with the handlers LocalServiceRegistry expects
 * (createRequest, parseResponse, mockFull, filterLogMessage, etc.).
 * @param {string} serviceId - Service ID as configured in Business Manager
 */
function Service(serviceId) {
    this.serviceId = serviceId;
    this.service = null;
    this.callbacks = {};
}

/**
 * @description Lazily creates (and caches) the underlying dw.svc.Service instance
 * @returns {dw.svc.HTTPService|dw.svc.Service} Configured service instance
 */
Service.prototype.getService = function () {
    if (!this.service) {
        this.service = LocalServiceRegistry.createService(this.serviceId, this.callbacks);
    }

    return this.service;
};

/**
 * @description Executes the underlying service call
 * @returns {dw.svc.Result} Service call result
 */
Service.prototype.call = function () {
    var service = this.getService();

    return service.call.apply(service, arguments);
};

module.exports = Service;
