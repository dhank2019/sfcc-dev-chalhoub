'use strict';

/**
 * Compiles the plugin_fulfillment cartridge's client-side assets (JS + SCSS).
 *
 * sgmf-scripts' `--compile js` / `--compile css` commands only ever build the single cartridge
 * named as "packageName" in the repo's root package.json (app_storefront_base here), by design -
 * SFRA's tooling assumes one buildable storefront cartridge per repo. Since plugin_fulfillment is
 * an additional plugin cartridge living in the same repo, this script builds it via the same
 * webpack.config.js (entries named "plugin_fulfillment-js" / "plugin_fulfillment-scss"),
 * mirroring what a real multi-cartridge project would wire up in its own build pipeline.
 */

var webpack = require('webpack');
var path = require('path');

var configs = require(path.resolve(__dirname, '../webpack.config.js'))
    .filter(function (config) {
        return config.name.indexOf('plugin_fulfillment-') === 0;
    });

webpack(configs, function (err, stats) {
    if (err) {
        console.error(err);
        process.exitCode = 1;
        return;
    }

    console.log(stats.toString({ chunks: false, colors: true }));
    process.exitCode = stats.hasErrors() ? 1 : 0;
});
