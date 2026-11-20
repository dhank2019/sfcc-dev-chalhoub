'use strict';

var Service = require('*/cartridge/scripts/services/Service');
var CONTENT_TYPE_HEADER_NAME = 'Content-Type';

/**
 * @typedef {object} Authentication
 * @property {string} type
 * @property {string} credentials
 */

/**
 * @typedef {object} callParams
 * @property {string} method
 * @property {Authentication} auth
 * @property {Object<string, string>} queryParams
 * @property {Object<string, string>} headers
 * @property {('form'|'json'|'xml')} dataType
 * @property {Object<string, string> | XML} data
 */

/**
 * @description Filter sensitive data from text data
 * @param {object} serviceConfigurations - Service configurations
 * @param {string} textData - Text data to filter
 * @param {('request'|'response')} filterType - Filter type
 * @returns {string} Filtered text data
 */
function filterSensetiveData(serviceConfigurations, textData, filterType) {
    if (textData && serviceConfigurations && serviceConfigurations.filteringRules && serviceConfigurations.filteringRules[filterType]) {
        var filteringRules = serviceConfigurations.filteringRules[filterType];

        filteringRules.fields.forEach(function (field) {
            var regExp = filteringRules[field] && filteringRules[field].regExp
                ? new RegExp(filteringRules[field].regExp, 'g')
                : new RegExp('("' + field + '"\\s*:\\s*")[^"]+(")', 'g');
            var replacement = filteringRules[field] && filteringRules[field].replacement
                ? filteringRules[field].replacement
                : '$1*************$2';

            textData = textData.replace(regExp, replacement);
        });
    }

    return textData;
}

/**
 * @category plugin_fulfillment
 * @subcategory services
 * @class RestService
 * @classdesc Class for REST services
 */
function RestService() {
    var object = require('*/cartridge/scripts/util/object');

    Service.apply(this, arguments);

    var self = this;

    this.serviceConfigurations = null;

    this.callbacks = object.assign(this.callbacks, {
        /**
         * @this RestService
         * @description Prepare body, params, headers for call
         * @param {dw.svc.HTTPService} svc - Service instance
         * @param {callParams} params - Call parameters
         * @returns {string} Call body
         */
        createRequest: function (svc, params) {
            return self.createRequest(svc, params);
        },
        /**
         * @this RestService
         * @description Escape sensitive request information for log files
         * @param {string} requestString - Request string
         * @returns {string} Request string as is (should be overridden where need)
         */
        getRequestLogMessage: function (requestString) {
            var serviceConfigurations = this.getServiceConfigurations();

            return filterSensetiveData(serviceConfigurations, requestString, 'request');
        },
        /**
         * @this RestService
         * @description Escape sensitive response information for log files
         * @param {object} response - Response object
         * @returns {string} Response text
         */
        getResponseLogMessage: function (response) {
            var serviceConfigurations = this.getServiceConfigurations();

            return response && filterSensetiveData(serviceConfigurations, response.text, 'response');
        },
        /**
         * @this RestService
         * @description Parse service response
         * @param {dw.svc.HTTPService} svc - Service instance
         * @param {object} response - Response object
         * @returns {string|object} Parsed response
         */
        parseResponse: function (svc, response) {
            return self.parseResponse(svc, response);
        }
    });
}

RestService.prototype = Object.create(Service.prototype);

/**
 * @description Get service credentials
 * @param {dw.svc.HTTPService} svc - Service instance
 * @returns {dw.svc.ServiceCredential} Service credentials
 */
RestService.prototype.getCredentials = function (svc) {
    return svc.getConfiguration().getCredential();
};

/**
 * @description Add authorization header
 * @param {Authentication} auth - Auth object
 * @param {dw.svc.HTTPService} svc - Service instance
 * @returns {void}
 */
RestService.prototype.addAuthorization = function (auth, svc) {
    svc.addHeader('Authorization', auth.type + ' ' + auth.credentials);
};

/**
 * @description Prepare call body for json type
 * @param {object} data - Request data object
 * @returns {string} Stringified object
 */
RestService.prototype.prepareJSONBody = function (data) {
    return JSON.stringify(data);
};

/**
 * @description Prepare call body for xml type
 * @param {string} data - Request data string
 * @returns {string} Request xml string as is
 */
RestService.prototype.prepareXMLBody = function (data) {
    return data;
};

/**
 * @description Prepare call body for form type
 * @param {object} data - Request data object
 * @returns {string} Encoded form body
 */
RestService.prototype.prepareFormBody = function (data) {
    var SecureEncoder = require('dw/util/SecureEncoder');

    return Object.keys(data).map(function (key) {
        return [
            SecureEncoder.forUriComponentStrict(key),
            SecureEncoder.forUriComponentStrict(data[key])
        ].join('=');
    }, this).join('&');
};

/**
 * @description Parse service response
 * @param {dw.svc.HTTPService} svc - Service instance
 * @param {object} response - Response object
 * @returns {string|object} Parsed response
 */
RestService.prototype.parseResponse = function (svc, response) {
    var contentType = svc.client.getResponseHeader(CONTENT_TYPE_HEADER_NAME);

    switch (contentType) {
        case 'application/xml':
            return response.text;
        default:
            return require('*/cartridge/scripts/util/json').parse(response.text, null);
    }
};

/**
 * @description Create service request
 * @param {dw.svc.HTTPService} svc - Service instance
 * @param {object} params Object with request params
 * @returns {string} Request body
 */
RestService.prototype.createRequest = function (svc, params) {
    var queryParams = params.queryParams || {};
    var headers = params.headers || {};
    var method = params.method || 'GET';
    var body = '';

    svc.setRequestMethod(method);

    if (params.auth) {
        this.addAuthorization(params.auth, svc);
    }

    if (params.path) {
        svc.setURL(svc.URL + params.path);
    }

    Object.keys(queryParams).forEach(function (paramName) {
        svc.addParam(paramName, queryParams[paramName]);
    });

    Object.keys(headers).forEach(function (headerName) {
        svc.addHeader(headerName, headers[headerName]);
    });

    if (['GET', 'OPTIONS'].indexOf(method) > -1) {
        return body;
    }

    switch (params.dataType) {
        case 'form':
            svc.addHeader(CONTENT_TYPE_HEADER_NAME, 'application/x-www-form-urlencoded');
            body = this.prepareFormBody(params.data);
            break;
        case 'json':
            svc.addHeader(CONTENT_TYPE_HEADER_NAME, 'application/json');
            body = this.prepareJSONBody(params.data);
            break;
        case 'xml':
            svc.addHeader(CONTENT_TYPE_HEADER_NAME, 'application/xml');
            body = this.prepareXMLBody(params.data);
            break;
        default:
            body = this.prepareJSONBody(params.data);
            break;
    }

    return body;
};

/**
 * Retrieves and parses service configurations from the given service object.
 *
 * @returns {object} The parsed service configurations as an object. Returns an empty object if configurations are missing or invalid.
 *
 * @throws {Error} Logs an error if JSON parsing fails or if the configuration retrieval encounters an issue.
 */
RestService.prototype.getServiceConfigurations = function () {
    var service = this.getService();

    try {
        if (service && service.configuration) {
            var configurations = service.configuration;
            var serviceCredentials = configurations.getCredential();

            if (serviceCredentials && serviceCredentials.custom) {
                var configString = serviceCredentials.custom.serviceConfigurations;

                if (configString) {
                    this.serviceConfigurations = JSON.parse(configString);
                }
            }
        }
    } catch (error) {
        var Logger = require('dw/system/Logger');
        var serviceID = service.configuration.ID;
        var customServiceLog = Logger.getLogger('ref-service', serviceID);

        customServiceLog.error(
            '[getServiceConfigurations] Service with ID: {0}, Error while fetching service configurations {1}',
            serviceID,
            error.message
        );
    }

    return this.serviceConfigurations;
};

module.exports = RestService;
