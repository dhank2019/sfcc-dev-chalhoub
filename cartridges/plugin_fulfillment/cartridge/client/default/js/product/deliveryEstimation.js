'use strict';

/**
 * PDP delivery estimation (fulfilment tier) widget.
 *
 * Design goals:
 *  - Never blocks/slows down the initial PDP render: this script only fires after the
 *    availability block is already on the page, and only for in-stock/orderable variants.
 *  - Never breaks the page: every failure path (timeout, http error, malformed json) results in
 *    the block staying hidden - no thrown errors, no console noise, no visible broken state.
 *  - No layout shift: the block is `display:none` until content is ready to paint; a skeleton
 *    of the same footprint as the final content is shown first so there is no secondary jump.
 *  - Repeat views don't re-hit the external fulfilment service directly: the server already
 *    caches resolved sku+country tiers (CacheMgr, shared across sessions), so this widget has
 *    no client-side cache of its own - every request here still reaches the ajax endpoint.
 */

var REQUEST_TIMEOUT_MS = 4000;

/**
 * Reads a parameter from the current page's URL query string (e.g. a PDP opened as
 * `...html?mockScenario=DELIVERY-TEST-ERROR`), so a mock scenario can be forced end-to-end
 * through the real widget/AJAX flow just by changing the browser URL - no template or markup
 * changes needed.
 * @param {string} name - query string parameter name to read
 * @returns {string|null} decoded parameter value, or null if not present
 */
function getQueryParam(name) {
    var match = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
}

/**
 * Hides the widget and clears any previously rendered content.
 * @param {jQuery} $widget - the .js-delivery-estimation element
 * @returns {void}
 */
function hide($widget) {
    $widget.addClass('d-none').removeClass('is-loading');
    $widget.find('.delivery-estimation__content').empty();
}

/**
 * Paints the resolved tier's business-managed content into the widget.
 * @param {jQuery} $widget - the .js-delivery-estimation element
 * @param {string} contentHtml - sanitized-by-BM-authoring HTML for the tier
 * @returns {void}
 */
function render($widget, contentHtml) {
    $widget.find('.delivery-estimation__content').empty().html(contentHtml);
    $widget.removeClass('is-loading d-none');
}

/**
 * Requests the delivery tier for the given widget's product.
 * @param {jQuery} $widget - the .js-delivery-estimation element
 * @returns {void}
 */
function requestTier($widget) {
    var pid = $widget.data('pid');
    var url = $widget.data('url');

    if (!pid || !url) {
        return;
    }

    // An explicit mockScenario on the page URL always forces that fixture (see mockLoader.js /
    // scripts/services/mocks/fulfillment/), bypassing the server-side cache too, so testers
    // reliably see it.
    var mockScenario = getQueryParam('mockScenario');

    var pendingXhr = $widget.data('xhr');
    if (pendingXhr && pendingXhr.abort) {
        pendingXhr.abort();
    }

    $widget.removeClass('d-none').addClass('is-loading');

    var ajaxData = { pid: pid };
    if (mockScenario) {
        ajaxData.mockScenario = mockScenario;
    }

    var xhr = $.ajax({
        url: url,
        type: 'GET',
        data: ajaxData,
        dataType: 'json',
        timeout: REQUEST_TIMEOUT_MS
    }).done(function (data) {
        if (data && data.success && data.tier && data.contentHtml) {
            render($widget, data.contentHtml);
        } else {
            hide($widget);
        }
    }).fail(function () {
        // Timeout, abort (superseded by a newer variant selection), or service/HTTP error.
        // Fail silently - the PDP must never show a broken/error state for this feature.
        hide($widget);
    });

    $widget.data('xhr', xhr);
}

/**
 * @param {jQuery} $productContainer - container to look the widget up within
 * @returns {jQuery} the delivery estimation widget for this product container
 */
function getWidget($productContainer) {
    return $('.js-delivery-estimation', $productContainer);
}

/**
 * Evaluates whether the currently selected variant is orderable and, if so, (re)requests its
 * delivery tier; otherwise hides the widget.
 * @param {jQuery} $widget - the .js-delivery-estimation element
 * @param {boolean} readyToOrder - whether all required variation attributes are selected
 * @param {boolean} available - whether the selected variant is orderable/in stock
 * @returns {void}
 */
function evaluate($widget, readyToOrder, available) {
    if (!$widget.length) {
        return;
    }

    if (readyToOrder && available) {
        requestTier($widget);
    } else {
        hide($widget);
    }
}

$(document).ready(function () {
    // Initial page load: evaluate the variant that is already selected/rendered server-side.
    $('.js-delivery-estimation').each(function () {
        var $widget = $(this);
        evaluate(
            $widget,
            $widget.data('ready-to-order') === true,
            $widget.data('available') === true
        );
    });

    // Subsequent variant selections (color/size swatches, bonus product picker, quick view, etc).
    $('body').on('product:updateAvailability', function (e, response) {
        var $widget = getWidget(response.$productContainer);
        evaluate($widget, response.product.readyToOrder, response.product.available);
    });
});
